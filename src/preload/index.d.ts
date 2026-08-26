import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<{ ok: boolean; pid: number }>
      invoke: <T = unknown>(channel: string, payload: unknown) => Promise<T>
      workerRequest: <T = unknown>(method: string, params?: unknown) => Promise<T>
      workerRequestWithId: <T = unknown>(method: string, params?: unknown, cancelId?: string) => Promise<{ result: T; requestId: number }>
      cancelWorkerRequest: (cancelId: string) => Promise<{ cancelled: boolean }>
      on: <T = unknown>(channel: string, callback: (payload: T) => void) => () => void
      onAgentStream: (callback: (payload: unknown) => void) => () => void
      /** Open a native folder selection dialog. Returns { folderPath, canceled }. */
      openFolderDialog: () => Promise<{ folderPath: string | null; canceled: boolean }>
      /** Write a log entry to the log file (forwarded to main process). */
      log: (payload: { level: string; message: string; stack?: string; extra?: Record<string, unknown> }) => Promise<void>
      /** Read recent log lines from today's log file. */
      readLogs: (maxLines?: number) => Promise<string>
      fetchImageBase64: (url: string | { url: string }) => Promise<{ error?: string; data?: string; mimeType?: string }>
      downloadImage: (url: string | { url: string; defaultName?: string }) => Promise<{ error?: string; canceled?: boolean }>
      writeImageToClipboard: (imageData: string | { data: string }) => Promise<{ error?: string }>
      // Team runtime IPC stubs
      teamRuntimeCreate: <T = unknown>(args: Record<string, unknown>) => Promise<T>
      teamRuntimeDelete: (args: Record<string, unknown>) => Promise<{ success: true }>
      teamRuntimeAppendMessage: (args: Record<string, unknown>) => Promise<{ success: true }>
      teamRuntimeGetSnapshot: <T = unknown>(args: Record<string, unknown>) => Promise<T | null>
      teamRuntimeUpdateMember: (args: Record<string, unknown>) => Promise<{ success: true }>
      teamRuntimeUpdateManifest: (args: Record<string, unknown>) => Promise<{ success: true }>
      shell: { openExternal: (url: string) => Promise<void>; showItemInFolder: (path: string) => Promise<void> }
      teamRuntimeConsumeMessages: <T = unknown[]>(args: Record<string, unknown>) => Promise<T>
    }
  }
}

export {}
