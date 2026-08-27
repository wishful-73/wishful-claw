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

const api = {
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
  ): Promise<{ result: T; requestId: number }> =>
    invokeMessagePackBinary<{ result: T; requestId: number }>('worker:request:with-id', {
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
    invokeMessagePackBinary<string>('log:read', { maxLines: maxLines ?? 500 })
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
