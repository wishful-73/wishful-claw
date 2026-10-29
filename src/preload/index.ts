import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  decodeMessagePackPayload,
  encodeMessagePackPayload,
  toMessagePackChannel
} from '../shared/messagepack/binary-ipc'

async function invokeMessagePackBinary<T>(channel: string, payload: unknown): Promise<T> {
  const response = await ipcRenderer.invoke(
    toMessagePackChannel(channel),
    encodeMessagePackPayload(payload)
  )
  return decodeMessagePackPayload<T>(response as ArrayBuffer | ArrayBufferView)
}

/**
 * Listen for a MessagePack-encoded event from the main process.
 * Returns an unsubscribe function.
 */
function onMessagePackEvent<T = unknown>(
  channel: string,
  callback: (payload: T) => void
): () => void {
  const binaryChannel = toMessagePackChannel(channel)
  const handler = (_event: unknown, bytes: ArrayBuffer | ArrayBufferView): void => {
    callback(decodeMessagePackPayload<T>(bytes))
  }
  ipcRenderer.on(binaryChannel, handler)
  return () => {
    ipcRenderer.removeListener(binaryChannel, handler)
  }
}

const PROJECT_DIR_ARG_PREFIX = '--wishful-project-dir='

/**
 * 项目级数据目录名由主进程算好后经 additionalArguments 传下来（S-223）。
 * 解析不到就是 undefined —— 兜底只在 renderer 的 project-data-dir.ts 做一次，
 * 因为快速启动、剪贴板增强这两个辅助窗口不带该参数。
 */
function readProjectDirName(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(PROJECT_DIR_ARG_PREFIX))
  const value = arg?.slice(PROJECT_DIR_ARG_PREFIX.length).trim()
  return value ? value : undefined
}

const api = {
  /** 项目级数据目录名（S-223）：打包版 .wishful-claw，dev 实例 .wishful-claw-dev。 */
  projectDirName: readProjectDirName(),
  ping: () => invokeMessagePackBinary<{ ok: boolean; pid: number }>('worker/ping', {}),

  // Generic IPC invoke — used by IPC state storage for provider persistence
  invoke: <T = unknown>(channel: string, payload: unknown): Promise<T> =>
    invokeMessagePackBinary<T>(channel, payload),

  // Worker request forwarder — main process forwards to worker via named pipe
  workerRequest: <T = unknown>(method: string, params?: unknown): Promise<T> =>
    invokeMessagePackBinary<T>('worker:request', { method, params: params ?? {} }),

  // Worker request forwarder that registers the in-flight request under a
  // caller-supplied cancelId, so it can be cancelled while still running.
  workerRequestWithId: <T = unknown>(
    method: string,
    params?: unknown,
    cancelId?: string
  ): Promise<T> =>
    invokeMessagePackBinary<T>('worker:request:with-id', {
      method,
      params: params ?? {},
      cancelId
    }),

  // Cancel an in-flight worker request previously registered with cancelId
  cancelWorkerRequest: (cancelId: string): Promise<{ cancelled: boolean }> =>
    invokeMessagePackBinary<{ cancelled: boolean }>('worker:request:cancel', { cancelId }),

  // Listen for main → renderer push events (e.g. window:maximized)
  on: <T = unknown>(channel: string, callback: (payload: T) => void): (() => void) =>
    onMessagePackEvent<T>(channel, callback),

  // Listen for agent stream events (agent/stream channel)
  onAgentStream: (callback: (payload: unknown) => void): (() => void) =>
    onMessagePackEvent('agent/stream', callback),

  // Open native folder selection dialog
  openFolderDialog: (): Promise<{ folderPath: string | null; canceled: boolean }> =>
    invokeMessagePackBinary<{ folderPath: string | null; canceled: boolean }>('dialog:openFolder', {}),

  // Write a log entry to the log file (renderer -> main forwarding)
  log: (payload: { level: string; message: string; stack?: string; extra?: Record<string, unknown> }): Promise<void> =>
    invokeMessagePackBinary<void>('log:write', payload),

  // Read recent log lines from today's log file
  readLogs: (maxLines?: number): Promise<string> =>
    invokeMessagePackBinary<string>('log:read', { maxLines: maxLines ?? 500 }),

  /**
   * S-224：把聊天图片落盘到 `{dataRoot}/images/{yyyy-MM}/`，返回磁盘路径。
   * 落库只留 `filePath`，字节不再进 DB。失败时返回 `error`，调用方降级为内联 base64。
   */
  persistChatImage: (args: {
    data: string
    mediaType?: string
  }): Promise<{ filePath?: string; mediaType?: string; error?: string }> =>
    invokeMessagePackBinary('image:persist-chat', args),

  /**
   * S-243：录音采集。采集与重采样都在渲染端做完（`AudioContext({ sampleRate,
   * channelCount })` 由浏览器做，不引入 resampler 依赖），主进程只负责按段写 wav。
   * 段落落盘进度走 `on('plugin-audio:segment')`。
   */
  audio: {
    sources: (): Promise<{ id: string; name: string; kind: 'system' }[]> =>
      invokeMessagePackBinary('plugin-audio:sources', {}),
    start: (options: {
      format: { sampleRate: number; channels: number }
      segmentSeconds?: number
    }): Promise<{ sessionId: string; directory: string }> =>
      invokeMessagePackBinary('plugin-audio:start', options),
    append: (sessionId: string, bytes: Uint8Array): Promise<{ segments: string[] }> =>
      invokeMessagePackBinary('plugin-audio:append', { sessionId, bytes }),
    stop: (sessionId: string): Promise<{ wavPaths: string[] }> =>
      invokeMessagePackBinary('plugin-audio:stop', { sessionId })
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
