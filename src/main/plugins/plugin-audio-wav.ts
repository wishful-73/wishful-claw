/*
 * 插件基座（4/5）· wav 写盘与分段（S-243）。
 *
 * 边界（S-243 §2）：基座只提供「采」，不提供「懂」。它能保证的是「拿到一个干净的
 * 16-bit PCM wav」；切多长、喂给哪个引擎、怎么转写，全在插件项目里。
 *
 * 为什么这个文件不 import electron：采集（getUserMedia / getDisplayMedia）发生在
 * 渲染端的 WebAudio 图里，主进程收到的已经是最终 PCM；采样率转换与声道下混由
 * 浏览器的 `AudioContext({ sampleRate, channelCount })` 完成。所以写盘这层是纯
 * node 逻辑 —— 也正因如此，它能被回归套件直接 import 断言，不需要起 Electron。
 */

import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'

/** PCM 格式：采样率 + 声道数。位深固定 16 bit（QwenASR / sherpa 的原生格式）。 */
export interface AudioPcmFormat {
  sampleRate: number
  channels: number
}

export const WAV_HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16

/** 一帧 = 所有声道各一个 16-bit 采样。切段必须整帧对齐，否则左右声道会错位。 */
export function frameBytes(format: AudioPcmFormat): number {
  return format.channels * (BITS_PER_SAMPLE / 8)
}

/**
 * 单个 wav 文件：先占 44 字节头，收尾时回填 RIFF 与 data 两个长度字段。
 * 边录边写，不在内存里攒整段音频 —— 一小时会议约 110 MB，攒内存会直接把主进程拖死。
 */
export class WavWriter {
  private readonly fd: number
  private dataBytes = 0
  private closed = false

  constructor(
    readonly filePath: string,
    private readonly format: AudioPcmFormat
  ) {
    this.fd = openSync(filePath, 'w')
    writeSync(this.fd, buildHeader(format, 0))
  }

  /** 已写入的 PCM 字节数（不含头）。 */
  get size(): number {
    return this.dataBytes
  }

  get frames(): number {
    return this.dataBytes / frameBytes(this.format)
  }

  append(bytes: Uint8Array): void {
    if (this.closed) throw new Error(`wav writer already closed: ${this.filePath}`)
    if (bytes.length === 0) return
    writeSync(this.fd, bytes)
    this.dataBytes += bytes.length
  }

  /** 回填长度并关文件；重复调用是空操作。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    writeSync(this.fd, buildHeader(this.format, this.dataBytes), 0, WAV_HEADER_BYTES, 0)
    closeSync(this.fd)
  }
}

/**
 * 44 字节 RIFF/WAVE 头。`dataBytes` 为 0 时写的是占位头，close 时按实际长度重写一次。
 */
export function buildHeader(format: AudioPcmFormat, dataBytes: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  const byteRate = format.sampleRate * frameBytes(format)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(frameBytes(format), 32) // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

export interface SegmentingWriterOptions {
  directory: string
  format: AudioPcmFormat
  /** 每段时长；缺省 30 s。0 或负数表示不分段（整个会话一个文件）。 */
  segmentSeconds?: number
  /** 文件名前缀，缺省 `part`。 */
  prefix?: string
  /** 每落满一段就回调（含收尾那段）。 */
  onSegment?: (filePath: string, frames: number) => void
}

/**
 * 按固定时长切段的写盘器。
 *
 * 调用方（渲染端）可以按任意大小的块喂 PCM —— 这里负责攒够一整段再落一个文件，
 * 并把不足一段的尾巴留到下一次。相邻段严格衔接：帧不重不漏。
 */
export class SegmentingWriter {
  private readonly prefix: string
  private readonly segmentFrames: number
  private readonly segments: string[] = []
  private writer: WavWriter | null = null
  private leftover = Buffer.alloc(0)
  private segmentIndex = 0
  private closed = false

  constructor(private readonly options: SegmentingWriterOptions) {
    this.prefix = options.prefix ?? 'part'
    const seconds = options.segmentSeconds ?? 30
    this.segmentFrames = seconds > 0 ? Math.round(seconds * options.format.sampleRate) : 0
    mkdirSync(options.directory, { recursive: true })
  }

  /** 已落盘完成的文件（不含正在写的那一段）。 */
  get completed(): readonly string[] {
    return this.segments
  }

  append(bytes: Uint8Array): string[] {
    if (this.closed) throw new Error('segmenting writer already closed')
    if (bytes.length === 0) return []

    const emitted: string[] = []
    let buffer = this.leftover.length > 0 ? Buffer.concat([this.leftover, Buffer.from(bytes)]) : Buffer.from(bytes)
    this.leftover = Buffer.alloc(0)

    if (this.segmentFrames === 0) {
      this.current().append(buffer)
      return emitted
    }

    const segmentBytes = this.segmentFrames * frameBytes(this.options.format)
    while (buffer.length >= segmentBytes) {
      this.current().append(buffer.subarray(0, segmentBytes))
      const path = this.rotate()
      if (path) emitted.push(path)
      buffer = buffer.subarray(segmentBytes)
    }

    if (buffer.length > 0) {
      // 不整段：留在内存里等下一块 —— 保证下一段的开头永远落在帧边界上。
      this.leftover = buffer
    }
    return emitted
  }

  /** 收尾：把余量写进最后一段并关文件。返回本次新完成的文件。 */
  close(): string[] {
    if (this.closed) return []
    this.closed = true
    const emitted: string[] = []
    if (this.leftover.length > 0) {
      this.current().append(this.leftover)
      this.leftover = Buffer.alloc(0)
    }
    const path = this.rotate()
    if (path) emitted.push(path)
    return emitted
  }

  private current(): WavWriter {
    if (!this.writer) {
      this.segmentIndex += 1
      const name = `${this.prefix}-${String(this.segmentIndex).padStart(3, '0')}.wav`
      this.writer = new WavWriter(join(this.options.directory, name), this.options.format)
    }
    return this.writer
  }

  private rotate(): string | null {
    const writer = this.writer
    if (!writer) return null
    this.writer = null
    const frames = writer.frames
    writer.close()
    this.segments.push(writer.filePath)
    this.options.onSegment?.(writer.filePath, frames)
    return writer.filePath
  }
}
