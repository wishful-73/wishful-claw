/*
 * 录音采集 IPC（S-243）。四个动作：sources / start / append / stop。
 *
 * 音频数据只往一个方向走：渲染端（WebAudio 图，已重采样成 16 kHz mono PCM16）
 * 把字节推给主进程落盘。主进程不认识音频内容，也不回传任何音频 —— 这样一小时
 * 会议的数据不会在窗口之间来回搬。
 *
 * 段落落盘的进度走推送（`plugin-audio:segment`），广播给所有窗口：录音可能从
 * 插件视图发起、在插件视图里结束，而将来的「能听」面板在主窗口。
 */

import { BrowserWindow } from 'electron'
import {
  encodeMessagePackPayload,
  toMessagePackChannel
} from '../../shared/messagepack/binary-ipc'
import { registerMessagePackHandler } from './messagepack-handler'
import {
  AudioRecorderRegistry,
  listAudioSources,
  type AudioSessionStartOptions,
  type AudioSessionStartResult,
  type AudioSourceInfo
} from '../plugins/plugin-audio'

const SEGMENT_CHANNEL = 'plugin-audio:segment'

let registry: AudioRecorderRegistry | null = null

function broadcastSegment(sessionId: string, filePath: string): void {
  const payload = encodeMessagePackPayload({ sessionId, path: filePath })
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(toMessagePackChannel(SEGMENT_CHANNEL), payload)
    } catch {
      // 窗口正好在关，丢掉这一帧就行
    }
  }
}

function getRegistry(): AudioRecorderRegistry {
  if (!registry) {
    registry = new AudioRecorderRegistry(undefined, broadcastSegment)
  }
  return registry
}

function readSessionId(args: unknown): string {
  if (typeof args === 'string') return args.trim()
  const value = (args as { sessionId?: string } | undefined)?.sessionId
  return typeof value === 'string' ? value.trim() : ''
}

/** MessagePack 解出来可能是 Uint8Array / Buffer / 数字数组，统一成 Uint8Array。 */
function readBytes(args: unknown): Uint8Array {
  const raw = (args as { bytes?: unknown } | undefined)?.bytes
  if (raw instanceof Uint8Array) return raw
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[])
  return new Uint8Array(0)
}

export function registerPluginAudioHandlers(): void {
  registerMessagePackHandler<undefined, AudioSourceInfo[]>('plugin-audio:sources', async () =>
    listAudioSources()
  )

  registerMessagePackHandler<AudioSessionStartOptions, AudioSessionStartResult>(
    'plugin-audio:start',
    async (args) => {
      const format = args?.format
      if (!format || !Number.isFinite(format.sampleRate) || format.sampleRate <= 0) {
        throw new Error('plugin-audio:start requires a positive format.sampleRate')
      }
      if (!Number.isFinite(format.channels) || format.channels <= 0) {
        throw new Error('plugin-audio:start requires a positive format.channels')
      }
      return getRegistry().start({
        format: { sampleRate: Math.round(format.sampleRate), channels: Math.round(format.channels) },
        segmentSeconds: args.segmentSeconds
      })
    }
  )

  registerMessagePackHandler<{ sessionId?: string; bytes?: unknown }, { segments: string[] }>(
    'plugin-audio:append',
    async (args) => {
      const sessionId = readSessionId(args)
      if (!sessionId) throw new Error('plugin-audio:append requires sessionId')
      return getRegistry().append(sessionId, readBytes(args))
    }
  )

  registerMessagePackHandler<{ sessionId?: string }, { wavPaths: string[] }>(
    'plugin-audio:stop',
    async (args) => getRegistry().stop(readSessionId(args))
  )
}
