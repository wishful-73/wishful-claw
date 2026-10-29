/*
 * S-243 回归：wav 头 + 按段切分。
 *
 * 钉住两件事，都是「错了以后要等用户听出来才发现」的那类：
 *   1. 44 字节头的每个字段（采样率 / 声道 / 位深 / 两个长度字段）—— 头写错时
 *      播放器要么不认、要么按错误的时长播。
 *   2. 分段严格整帧对齐、帧不重不漏 —— 错位会让整段音频音调漂移甚至爆音。
 *
 * 采集本身（麦克风 / loopback）只能在真机验，这里不碰 WebAudio。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  SegmentingWriter,
  WavWriter,
  buildHeader,
  frameBytes,
  WAV_HEADER_BYTES
} from '../../src/main/plugins/plugin-audio-wav'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

const ROOT = path.resolve(__dirname, '..', '..', '..')
const OUT = path.join(ROOT, 'tests', 'plugin-audio', 'out', `run-${Date.now()}`)

function readHeader(filePath: string): {
  riff: string
  riffSize: number
  wave: string
  fmt: string
  audioFormat: number
  channels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
  dataTag: string
  dataSize: number
} {
  const buffer = fs.readFileSync(filePath)
  return {
    riff: buffer.toString('ascii', 0, 4),
    riffSize: buffer.readUInt32LE(4),
    wave: buffer.toString('ascii', 8, 12),
    fmt: buffer.toString('ascii', 12, 16),
    audioFormat: buffer.readUInt16LE(20),
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    byteRate: buffer.readUInt32LE(28),
    blockAlign: buffer.readUInt16LE(32),
    bitsPerSample: buffer.readUInt16LE(34),
    dataTag: buffer.toString('ascii', 36, 40),
    dataSize: buffer.readUInt32LE(40)
  }
}

function checkHeaderBitDepthAndLayout(): void {
  const format = { sampleRate: 16_000, channels: 1 }
  const header = buildHeader(format, 32_000)

  assert(header.length === WAV_HEADER_BYTES, 'header is exactly 44 bytes')
  assert(header.toString('ascii', 0, 4) === 'RIFF', 'header starts with RIFF')
  assert(header.readUInt32LE(4) === 36 + 32_000, 'RIFF size covers payload plus the 36-byte tail')
  assert(header.toString('ascii', 8, 12) === 'WAVE', 'header declares WAVE')
  assert(header.toString('ascii', 12, 16) === 'fmt ', 'fmt chunk is declared')
  assert(header.readUInt32LE(16) === 16, 'fmt chunk is the 16-byte PCM variant')
  assert(header.readUInt16LE(20) === 1, 'audio format is PCM')
  assert(header.readUInt16LE(22) === 1, 'channel count is written through')
  assert(header.readUInt32LE(24) === 16_000, 'sample rate is written through')
  assert(header.readUInt32LE(28) === 32_000, 'byte rate is sampleRate * blockAlign')
  assert(header.readUInt16LE(32) === 2, 'block align is channels * 2')
  assert(header.readUInt16LE(34) === 16, 'bit depth is 16')
  assert(header.toString('ascii', 36, 40) === 'data', 'data chunk is declared')
  assert(header.readUInt32LE(40) === 32_000, 'data size matches the payload')

  assert(frameBytes({ sampleRate: 16_000, channels: 2 }) === 4, 'stereo frame is two samples')
  assert(frameBytes({ sampleRate: 48_000, channels: 1 }) === 2, 'mono frame is one sample')
}

function checkWriterBackfillsHeader(): void {
  const directory = path.join(OUT, 'single')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, 'part.wav')
  const writer = new WavWriter(filePath, { sampleRate: 16_000, channels: 1 })
  writer.append(new Uint8Array(6_400))
  assert(writer.frames === 3_200, 'writer counts frames, not bytes')
  writer.close()

  const header = readHeader(filePath)
  assert(header.dataSize === 6_400, 'close backfills the data size')
  assert(header.riffSize === 36 + 6_400, 'close backfills the RIFF size')
  assert(fs.statSync(filePath).size === WAV_HEADER_BYTES + 6_400, 'file length matches header plus payload')
}

function checkSegmentation(): void {
  const directory = path.join(OUT, 'segments')
  fs.mkdirSync(directory, { recursive: true })
  const format = { sampleRate: 16_000, channels: 1 }
  const segments: { filePath: string; frames: number }[] = []
  const writer = new SegmentingWriter({
    directory,
    format,
    segmentSeconds: 5,
    onSegment: (filePath, frames) => segments.push({ filePath, frames })
  })

  // 17 秒 mono PCM16 = 544000 字节；按 32768 字节分块喂，模拟渲染端的 IPC 块。
  const totalBytes = 17 * format.sampleRate * frameBytes(format)
  const chunk = Buffer.alloc(32_768)
  const emitted: string[] = []
  for (let offset = 0; offset < totalBytes; offset += chunk.length) {
    const size = Math.min(chunk.length, totalBytes - offset)
    emitted.push(...writer.append(chunk.subarray(0, size)))
  }
  emitted.push(...writer.close())

  assert(segments.length === 4, `17 s at 5 s per segment yields 4 files, got ${segments.length}`)
  assert(emitted.length === 4, 'every completed segment is reported by append/close')
  const frames = segments.map((segment) => segment.frames)
  assert(frames[0] === 5 * 16_000, 'first segment holds exactly 5 s')
  assert(frames[1] === 5 * 16_000, 'second segment holds exactly 5 s')
  assert(frames[2] === 5 * 16_000, 'third segment holds exactly 5 s')
  assert(frames[3] === 2 * 16_000, 'tail segment holds the remaining 2 s')
  assert(
    frames.reduce((sum, value) => sum + value, 0) === 17 * 16_000,
    'segments neither drop nor duplicate frames'
  )

  for (const segment of segments) {
    const header = readHeader(segment.filePath)
    assert(header.dataSize === segment.frames * 2, 'each segment header matches its own payload')
    assert(header.sampleRate === 16_000, 'each segment keeps the session sample rate')
    assert(header.channels === 1, 'each segment keeps the session channel count')
  }
}

function checkEmptyAndClosedWriters(): void {
  const directory = path.join(OUT, 'empty')
  fs.mkdirSync(directory, { recursive: true })
  const writer = new SegmentingWriter({
    directory,
    format: { sampleRate: 16_000, channels: 1 },
    segmentSeconds: 5
  })
  assert(writer.append(new Uint8Array(0)).length === 0, 'empty chunk yields no segment')
  assert(writer.close().length === 0, 'closing without audio leaves no zero-length file')
  assert(fs.readdirSync(directory).length === 0, 'no files are created when nothing was recorded')

  const partial = new SegmentingWriter({
    directory,
    format: { sampleRate: 16_000, channels: 1 },
    segmentSeconds: 5
  })
  partial.append(new Uint8Array(16_000)) // 0.5 s
  const tail = partial.close()
  assert(tail.length === 1, 'a short recording still produces its one file')
  const header = readHeader(tail[0])
  assert(header.dataSize === 16_000, 'the short file keeps its exact payload size')
}

function checkNoSegmentationMode(): void {
  const directory = path.join(OUT, 'whole')
  fs.mkdirSync(directory, { recursive: true })
  const writer = new SegmentingWriter({
    directory,
    format: { sampleRate: 16_000, channels: 1 },
    segmentSeconds: 0
  })
  writer.append(new Uint8Array(32_000))
  writer.append(new Uint8Array(32_000))
  const files = writer.close()
  assert(files.length === 1, 'segmentSeconds 0 keeps the whole session in one file')
  const header = readHeader(files[0])
  assert(header.dataSize === 64_000, 'the single file carries every byte that was appended')
}

try {
  checkHeaderBitDepthAndLayout()
  checkWriterBackfillsHeader()
  checkSegmentation()
  checkEmptyAndClosedWriters()
  checkNoSegmentationMode()
  console.log(`plugin-audio assertions passed: ${assertions}`)
} finally {
  fs.rmSync(OUT, { recursive: true, force: true })
}
