/*
 * 插件基座（4/5）· 录音采集的 electron 侧（S-243）。
 *
 * 这里只做三件主进程才能做的事：
 *   1. 系统内录的 loopback 授权（`setDisplayMediaRequestHandler`）——
 *      Windows 上渲染端自己 `getDisplayMedia` 拿不到干净的 loopback 音频。
 *   2. 系统声音源枚举（`desktopCapturer.getSources`）。麦克风列表拿不到，
 *      那是渲染端 `enumerateDevices()` 的事。
 *   3. 把渲染端送来的 PCM 落成按段切好的 wav（写盘逻辑在 `plugin-audio-wav.ts`）。
 *
 * 实测结论（v3-iter-4 第 0 刀，Electron 43.2.0 / Windows）：
 *   · 纯音频 `getDisplayMedia({ audio: true })` 抛 `AbortError: Invalid capture
 *     constraints` ⇒ 必须先要 video 再让渲染端丢掉 video track；
 *   · `callback({ video, audio: 'loopback' })` 通，48 kHz / 1 ch，label `System audio`；
 *   · 本程序自己的播放也必然被采进来 —— 已定案接受（无 per-process 排除 API）。
 */

import { desktopCapturer, session as electronSession } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDataPath } from '../lib/data-dir'
import {
  SegmentingWriter,
  type AudioPcmFormat
} from './plugin-audio-wav'

export interface AudioSourceInfo {
  /** `desktopCapturer` 的 source id；渲染端原样带回即可。 */
  id: string
  name: string
  kind: 'system'
}

export interface AudioSessionStartOptions {
  format: AudioPcmFormat
  segmentSeconds?: number
}

export interface AudioSessionStartResult {
  sessionId: string
  directory: string
}

interface AudioSession {
  id: string
  directory: string
  writer: SegmentingWriter
  paths: string[]
}

const DEFAULT_SEGMENT_SECONDS = 30

/** 系统声音源列表。屏幕源就是 loopback 的来源（Windows 上 audio 跟着 video 源走）。 */
export async function listAudioSources(): Promise<AudioSourceInfo[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources.map((source) => ({ id: source.id, name: source.name, kind: 'system' as const }))
}

let displayMediaInstalled = false

/**
 * 授权 loopback 内录。整个进程只需装一次；重复调用是空操作。
 *
 * `callback({})` 是拒绝语义 —— 拿不到屏幕源时宁可明确失败，也不要给一个静音流
 * 让插件以为录上了。
 */
export function installDisplayMediaHandler(): void {
  if (displayMediaInstalled) return
  displayMediaInstalled = true

  electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void (async (): Promise<void> => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        const screen = sources[0]
        if (!screen) {
          callback({})
          return
        }
        callback({ video: screen, audio: 'loopback' })
      } catch {
        callback({})
      }
    })()
  })
}

/**
 * 录音会话注册表：每个会话一个目录，目录里按段落出 `part-001.wav`、`part-002.wav`…
 *
 * 落盘根 `{dataRoot}/audio/{sessionId}/` —— 在数据目录里，不进项目目录，也不进 DB。
 */
export class AudioRecorderRegistry {
  private readonly sessions = new Map<string, AudioSession>()

  constructor(
    private readonly rootDir: string = resolveDataPath('audio'),
    /** 每落满一段回调一次；IPC 层用它广播 `plugin-audio:segment`。 */
    private readonly onSegment?: (sessionId: string, filePath: string) => void
  ) {}

  start(options: AudioSessionStartOptions): AudioSessionStartResult {
    const sessionId = randomUUID()
    const directory = join(this.rootDir, sessionId)
    mkdirSync(directory, { recursive: true })

    const paths: string[] = []
    const writer = new SegmentingWriter({
      directory,
      format: options.format,
      segmentSeconds: options.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS,
      onSegment: (filePath) => {
        paths.push(filePath)
        this.onSegment?.(sessionId, filePath)
      }
    })

    this.sessions.set(sessionId, { id: sessionId, directory, writer, paths })
    return { sessionId, directory }
  }

  /** 喂一块 PCM；返回这一块新落满的段落文件（通常为空）。 */
  append(sessionId: string, bytes: Uint8Array): { segments: string[] } {
    const audioSession = this.sessions.get(sessionId)
    if (!audioSession) throw new Error(`unknown audio session: ${sessionId}`)
    return { segments: audioSession.writer.append(bytes) }
  }

  /** 收尾：关掉正在写的那一段，返回会话全部文件（按时间顺序）。 */
  stop(sessionId: string): { wavPaths: string[] } {
    const audioSession = this.sessions.get(sessionId)
    if (!audioSession) return { wavPaths: [] }
    // close() 里收尾的那一段也会走 onSegment，所以 paths 已经包含它 —— 不要再拼一次。
    audioSession.writer.close()
    this.sessions.delete(sessionId)
    return { wavPaths: [...audioSession.paths] }
  }
}
