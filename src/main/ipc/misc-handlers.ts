import { BrowserWindow, Notification, dialog, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { getNativeWorker } from '../lib/native-worker'
import { registerMessagePackHandler } from './messagepack-handler'
import { safeSendMessagePackToWindow } from '../window-ipc'
import { resolveCodeGraphDataRoot } from './codegraph-handlers'

/**
 * Register miscellaneous IPC handlers:
 * - Desktop notifications
 * - Worker ping/request forwarders
 * - Shell open/showItemInFolder/openWithApp
 * - File selection dialog
 * - File watch/unwatch
 * - Browser emulation status stub
 * - Image persistence (browser screenshots, generated images)
 */
export function registerMiscHandlers(getMainWindow: () => BrowserWindow | null): void {
  // Desktop notification handler — renderer calls this when agent loop ends
  // and the window is NOT focused (user is away from the app).
  registerMessagePackHandler<{ title: string; body: string; type?: string }, { success: boolean }>(
    'notification:show',
    async (args) => {
      if (!Notification.isSupported()) {
        return { success: false }
      }
      const notification = new Notification({
        title: args.title,
        body: args.body,
        urgency: args.type === 'error' ? 'critical' : 'normal'
      })
      notification.show()
      return { success: true }
    }
  )

  // Register IPC handler: forward ping to worker
  registerMessagePackHandler<Record<string, unknown>, { ok: boolean; pid: number }>(
    'worker/ping',
    async () => {
      const worker = getNativeWorker()
      const result = await worker.request<{ ok: boolean; pid: number }>('worker/ping', {})
      return result
    }
  )

  // Generic worker request forwarder: renderer calls window.api.workerRequest(method, params)
  // and main forwards to the worker via named pipe IPC. codegraph/* methods get the
  // project-local dataRoot injected here (same routing as the agent reverse path),
  // so every caller — archive page, explore tool, prompt hook — shares one storage.
  registerMessagePackHandler<{ method: string; params?: unknown; timeoutMs?: number }, unknown>(
    'worker:request',
    async (args) => {
      const worker = getNativeWorker()
      const params = (args.params ?? {}) as Record<string, unknown>
      if (args.method.startsWith('codegraph/')) {
        const dataRoot = resolveCodeGraphDataRoot(
          typeof params.workingFolder === 'string'
            ? params.workingFolder
            : typeof params.projectPath === 'string'
              ? params.projectPath
              : undefined,
          params.dataRoot
        )
        if (dataRoot && params.dataRoot === undefined) {
          params.dataRoot = dataRoot
        }
      }
      return worker.request(args.method, args.params ?? {}, args.timeoutMs)
    }
  )

  // Same forwarder but registers the in-flight request under a caller-supplied
  // cancelKey inside the worker manager, so the renderer can cancel it via
  // worker:request:cancel while it is still running.
  registerMessagePackHandler<
    { method: string; params?: unknown; timeoutMs?: number; cancelId?: string },
    unknown
  >('worker:request:with-id', async (args) => {
    const worker = getNativeWorker()
    const params = (args.params ?? {}) as Record<string, unknown>
    if (args.method.startsWith('codegraph/')) {
      const dataRoot = resolveCodeGraphDataRoot(
        typeof params.workingFolder === 'string'
          ? params.workingFolder
          : typeof params.projectPath === 'string'
            ? params.projectPath
            : undefined,
        params.dataRoot
      )
      if (dataRoot && params.dataRoot === undefined) {
        params.dataRoot = dataRoot
      }
    }
    return worker.request(args.method, args.params ?? {}, args.timeoutMs, args.cancelId)
  })

  // Cancel an in-flight worker request by its cancelKey (registered when the
  // request was dispatched). Sends worker/cancel to the native worker.
  registerMessagePackHandler<{ cancelId: string }, { cancelled: boolean }>(
    'worker:request:cancel',
    async (args) => {
      const cancelled = getNativeWorker().cancelByKey(args.cancelId)
      if (!cancelled) {
        console.warn('[Worker] cancel requested but no in-flight match:', args.cancelId)
      }
      return { cancelled }
    }
  )

  // -- Shell handlers --
  registerMessagePackHandler<string, void>(
    'shell:openExternal',
    async (args) => {
      await shell.openExternal(args)
    }
  )

  registerMessagePackHandler<{ path: string }, void>(
    'shell:openPath',
    async (args) => {
      await shell.openPath(args.path)
    }
  )

  registerMessagePackHandler<{ path: string }, void>(
    'shell:showItemInFolder',
    async (args) => {
      shell.showItemInFolder(args.path)
    }
  )

  registerMessagePackHandler<string, void>(
    'shell:trashPath',
    async (args) => {
      await shell.trashItem(args)
    }
  )

  registerMessagePackHandler<{ path: string; appId?: string }, void>(
    'shell:openWithApp',
    async (args) => {
      // Open file with default app (appId ignored for now, uses OS default)
      await shell.openPath(args.path)
    }
  )

  // -- File selection dialog --
  registerMessagePackHandler<{ multiSelections?: boolean }, { canceled: boolean; path: string; paths: string[] }>(
    'fs:select-file',
    async (args) => {
      const properties: ('openFile' | 'multiSelections')[] = ['openFile']
      if (args?.multiSelections) properties.push('multiSelections')
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: properties as ('openFile' | 'multiSelections')[]
      })
      return {
        canceled: result.canceled,
        path: result.filePaths[0] ?? '',
        paths: result.filePaths
      }
    }
  )

  // -- File watch handlers --
  const watchedFiles = new Map<string, fs.FSWatcher>()

  registerMessagePackHandler<{ path: string }, { path: string }>(
    'fs:watch-file',
    async (args) => {
      const filePath = args.path
      if (watchedFiles.has(filePath)) {
        return { path: filePath }
      }
      try {
        const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
          if (eventType === 'change') {
            safeSendMessagePackToWindow(getMainWindow()!, 'fs:file-changed', { path: filePath })
          }
        })
        watcher.on('error', () => {
          watchedFiles.delete(filePath)
        })
        watchedFiles.set(filePath, watcher)
        return { path: filePath }
      } catch {
        return { path: filePath }
      }
    }
  )

  registerMessagePackHandler<{ path: string }, void>(
    'fs:unwatch-file',
    async (args) => {
      const watcher = watchedFiles.get(args.path)
      if (watcher) {
        watcher.close()
        watchedFiles.delete(args.path)
      }
    }
  )

  // -- Browser emulation status (stub -- returns defaults) --
  registerMessagePackHandler<void, { success: true; status: { reuseEnabled: boolean; userAgent: string } }>(
    'browser:emulation-status',
    async () => {
      return { success: true, status: { reuseEnabled: false, userAgent: '' } }
    }
  )

  // -- Image persistence (browser screenshots, generated images) --
  const GENERATED_IMAGES_DIR = 'wishful-claw'
  const GENERATED_IMAGES_SUBDIR = 'image'

  function getGeneratedImagesDir(): string {
    const { homedir } = require('os')
    const dir = join(homedir(), GENERATED_IMAGES_DIR, GENERATED_IMAGES_SUBDIR)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function guessExtensionFromMimeType(mediaType?: string): string {
    switch ((mediaType || '').toLowerCase()) {
      case 'image/jpeg':
        return '.jpg'
      case 'image/webp':
        return '.webp'
      case 'image/gif':
        return '.gif'
      case 'image/bmp':
        return '.bmp'
      default:
        return '.png'
    }
  }

  registerMessagePackHandler<{ data?: string; mediaType?: string; url?: string; filePath?: string }, { filePath?: string; mediaType?: string; data?: string; error?: string }>(
    'image:persist-generated',
    async (args) => {
      try {
        let buffer: Buffer
        if (typeof args.data === 'string' && args.data.trim()) {
          buffer = Buffer.from(args.data, 'base64')
        } else {
          return { error: 'Missing image data' }
        }
        const mediaType = args.mediaType || 'image/png'
        const fileExt = guessExtensionFromMimeType(mediaType)
        const { randomUUID } = require('crypto')
        const filePath = join(getGeneratedImagesDir(), `${Date.now()}-${randomUUID()}${fileExt}`)
        fs.writeFileSync(filePath, buffer)
        return {
          filePath,
          mediaType,
          data: args.data
        }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )
}
