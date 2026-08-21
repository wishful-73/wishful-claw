import { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

// 用 Vite ?asset 导入图标，构建时自动复制到 out/main/，路径始终正确
// 参考 OpenCowork 的做法（src/main/index.ts 第 28 行）
import appIcon from '../../resources/icon-256.png?asset'

import { getNativeWorker } from './lib/native-worker'
import { logError, logWarn, logInfo, logDebug, installGlobalExceptionHandlers, readRecentLogs } from './lib/logger'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { registerAiProviderHandlers } from './ipc/ai-provider-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerAgentStreamForwarder } from './ipc/agent-stream-handler'
import { registerNativeAgentRuntimeHandlers } from './ipc/native-agent-runtime'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerTerminalHandlers } from './ipc/terminal-handlers'
import { registerAgentChangeHandlers } from './ipc/agent-change-handlers'
import { registerMcpHandlers } from './ipc/mcp-handlers'
import { registerVideoHandlers } from './ipc/video-handlers'
import { registerExtensionHandlers } from './ipc/extension-handlers'
import { registerWebSearchHandlers } from './ipc/web-search-handlers'
import { registerSshHandlers, cleanupSshHandlers } from './ipc/ssh-handlers'
import { registerSkillHandlers } from './ipc/skill-handlers'
import { registerSshFsHandlers } from './ipc/ssh-fs-handlers'
import { ChannelManager } from './channels/channel-manager'
import { registerBuiltInChannelProviders } from './channels/register-providers'
import { registerChannelHandlers, autoStartChannels } from './ipc/channel-handlers'
import { registerQuickLauncher } from './quick-launcher'
import { registerClipboardEnhancer } from './clipboard-enhancer'
import { setPluginManager } from './channels/auto-reply'
import { safeSendMessagePackToWindow } from './window-ipc'
import { setMainWindow } from './main-window-registry'
import { registerLoginItemHandlers, registerWindowControlHandlers } from './ipc/window-handlers'
import { registerMiscHandlers } from './ipc/misc-handlers'

let mainWindow: BrowserWindow | null = null
let channelManager: ChannelManager | null = null
let tray: Tray | null = null
let isQuiting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // macOS: hide title bar but keep traffic lights
    // Windows/Linux: remove frame entirely for custom title bar
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 12 } }
      : { frame: false }),
    autoHideMenuBar: true,
    // 用 Vite ?asset 导入的图标，打包后路径在 out/main/ 中，始终正确
    // 参考 OpenCowork：frame:false 下构造器 icon 用 import 变量即可
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  // Notify renderer when window is maximized/unmaximized
  mainWindow.on('maximize', () => {
    safeSendMessagePackToWindow(mainWindow!, 'window:maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    safeSendMessagePackToWindow(mainWindow!, 'window:maximized', false)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Minimize to tray on close (Exit via tray menu only)
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on("console-message", (_e, level, message, line, src) => {
    const levelStr = ["LOG","WARN","ERROR"][level] ?? "LOG"
    console.log(`[renderer:${levelStr}] ${message} (${src}:${line})`)
    if (level >= 1) {
      logWarn("renderer", `${message} (${src}:${line})`)
    }
  })
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer:CRASH]", details.reason, details.exitCode)
    logError("renderer", `Render process gone: ${details.reason} (exit code: ${details.exitCode})`)
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Register the main window so other modules can send IPC to it reliably.
  // Do NOT use BrowserWindow.getAllWindows()[0] — auxiliary windows (clipboard
  // enhancer, quick launcher) can appear at index [0] and break reverse-requests.
  setMainWindow(mainWindow)
}

// ── Tray ──

function getTrayIcon(): Electron.NativeImage {
  // 用 Vite ?asset 导入的图标路径，开发/打包通用
  return nativeImage.createFromPath(appIcon)
}

function createTray(): void {
  if (tray) return
  tray = new Tray(getTrayIcon())
  tray.setToolTip('Wishful Claw')
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { mainWindow?.show() } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuiting = true; app.quit() } }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

app.setName('WishfulClaw')

// 单实例锁：双击 exe 时聚焦已有窗口，不启动新进程
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
  installGlobalExceptionHandlers()
  logInfo('main', 'Application started')
  app.setAppUserModelId('com.wishfulclaw.app')

  // Window control handlers (minimize / maximize / close / isMaximized)
  registerWindowControlHandlers()

  // Login item (auto-start) handlers
  registerLoginItemHandlers()

  // Register miscellaneous IPC handlers (notifications, worker forwarders, shell, file watch, image persistence)
  registerMiscHandlers(() => mainWindow)

  // Register AI provider persistence handlers
  registerAiProviderHandlers()
  registerSettingsHandlers()

  // Agent stream event forwarder (worker → renderer)
  registerAgentStreamForwarder()

  // Native agent runtime: handles reverse-request from worker (e.g. browser tool calls)
  registerNativeAgentRuntimeHandlers()

  // Git IPC handlers: forward git:* channels to worker
  registerGitHandlers()


  // Dialog: open folder selector
  registerMessagePackHandler<Record<string, unknown>, { folderPath: string | null; canceled: boolean }>(
    'dialog:openFolder',
    async (_args, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory']
      })
      return {
        folderPath: result.canceled ? null : result.filePaths[0] ?? null,
        canceled: result.canceled
      }
    }
  )

  // Folder picker: returns { canceled, path } for the renderer's fs:select-folder channel
  registerMessagePackHandler<{ defaultPath?: string }, { canceled: boolean; path?: string }>(
    'fs:select-folder',
    async (args, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
      if (args && typeof args.defaultPath === 'string') {
        opts.defaultPath = args.defaultPath
      }
      const result = await dialog.showOpenDialog(win!, opts)
      return {
        canceled: result.canceled,
        path: result.canceled ? undefined : result.filePaths[0]
      }
    }
  )

  // List desktop directories for the working folder selector dialog
  registerMessagePackHandler<void, { desktopPath: string; directories: { name: string; path: string; isDesktop: boolean }[] } | { error: string }>(
    'fs:list-desktop-directories',
    async () => {
      try {
        const desktopPath = app.getPath('desktop')
        const entries = await fs.promises.readdir(desktopPath, { withFileTypes: true })
        const directories = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({
            name: entry.name,
            path: join(desktopPath, entry.name),
            isDesktop: false
          }))
        return { desktopPath, directories }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  // ── File system handlers (extracted to ipc/fs-handlers.ts) ──
  registerFsHandlers()
  registerTerminalHandlers()
  registerAgentChangeHandlers()
  registerMcpHandlers()
  registerVideoHandlers()
  registerExtensionHandlers()
registerWebSearchHandlers()

  // ── Agent history handlers (forwarded to C# Worker SQLite) ──
  registerMessagePackHandler<{ toolUseId: string }, unknown>(
    'agent-history:read-by-tool-use-id',
    async (args) => getNativeWorker().request('db/sub-agent-read-by-tool-use-id', args)
  )
  registerMessagePackHandler<void, { total: number; sessions: unknown[] }>(
    'agent-history:index',
    async () => getNativeWorker().request('db/sub-agent-index', {})
  )
  registerMessagePackHandler<{ sessionId: string }, unknown[]>(
    'agent-history:read',
    async (args) => getNativeWorker().request('db/sub-agent-read-session', args)
  )
  registerMessagePackHandler<{
    upserts?: unknown[]
    removeIds?: string[]
    removeSessionIds?: string[]
  }, void>(
    'agent-history:apply',
    async (args) => { await getNativeWorker().request('db/sub-agent-apply', args) }
  )
  registerMessagePackHandler<{ snapshot: unknown }, void>(
    'agent-history:replace',
    async (args) => { await getNativeWorker().request('db/sub-agent-replace', args) }
  )
  // ── SSH handlers ──
  registerSshHandlers()
  registerSshFsHandlers()

  // ── Skills handlers ──
  registerSkillHandlers()

  // -- Channel system initialization --
  channelManager = new ChannelManager()
  registerBuiltInChannelProviders(channelManager)
  registerChannelHandlers(channelManager)
  setPluginManager(channelManager)
  logInfo('main', 'Channel system initialized')

  registerMessagePackHandler<unknown, unknown[]>(
    'agents:list',
    async () => []
  )
  registerMessagePackHandler<unknown, unknown[]>(
    'commands:list',
    async () => []
  )
  registerMessagePackHandler<unknown, unknown[]>(
    'prompts:list',
    async () => []
  )


  // ── Config stub handlers (key-value store, same pattern as settings) ──
  registerMessagePackHandler<string, unknown | null>(
    'config:get',
    () => null
  )
  registerMessagePackHandler<{ key: string; value: unknown }, { success: boolean }>(
    'config:set',
    () => ({ success: true })
  )

  // ── Input draft stub handlers ──
  registerMessagePackHandler<string, unknown | null>(
    'input-draft:get',
    () => null
  )
  registerMessagePackHandler<unknown, void>(
    'input-draft:set',
    () => undefined
  )
  registerMessagePackHandler<string, void>(
    'input-draft:remove',
    () => undefined
  )
  registerMessagePackHandler<void, unknown[]>(
    'input-draft:list',
    () => []
  )
  registerMessagePackHandler<void, void>(
    'input-draft:cleanup',
    () => undefined
  )

  // ── DB locator (forwarded to Worker) ──
  registerMessagePackHandler<string, unknown[]>(
    'db:messages:list-locator:msgpack',
    async (sessionId) => getNativeWorker().request('db/messages-list-locator', { sessionId })
  )
  // ── Goal DB handlers (forwarded to Worker) ──
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goals:list:msgpack',
    async (args) => getNativeWorker().request('db/goals-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:list-page:msgpack',
    async (args) => getNativeWorker().request('db/goals-list-page', args)
  )
  registerMessagePackHandler<string, unknown | null>(
    'db:goals:get:msgpack',
    async (sessionId) => getNativeWorker().request('db/goals-get', { sessionId })
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:create:msgpack',
    async (args) => getNativeWorker().request('db/goals-create', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:set:msgpack',
    async (args) => getNativeWorker().request('db/goals-set', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:update:msgpack',
    async (args) => getNativeWorker().request('db/goals-update', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:account:msgpack',
    async (args) => getNativeWorker().request('db/goals-account', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-events:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-events:list-page:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-list-page', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-events:add:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-add', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-plan-tasks:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-plan-tasks-list', args)
  )
  // -- Goal plans/tasks/execution-runs handlers --
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-plans:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:get:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-get', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:update-status:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-update-status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:update-retry:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-update-retry', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-tasks:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-tasks:get:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-get', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-tasks:update-status:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-update-status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-execution-runs:insert:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-insert', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-execution-runs:finish:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-finish', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-execution-runs:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-list', args)
  )
  // -- Goal control handlers --
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:pause:msgpack',
    async (args) => getNativeWorker().request('goal/pause', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:resume:msgpack',
    async (args) => getNativeWorker().request('goal/resume', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:abort:msgpack',
    async (args) => getNativeWorker().request('goal/abort', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:status:msgpack',
    async (args) => getNativeWorker().request('goal/status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:confirm:msgpack',
    async (args) => getNativeWorker().request('goal/confirm', args)
  )
  
  // -- Log handlers --
  registerMessagePackHandler<{ level: string; message: string; stack?: string; extra?: Record<string, unknown> }, void>(
    'log:write',
    async (args) => {
      const fn =
        args.level === 'error' ? logError :
        args.level === 'warn' ? logWarn :
        args.level === 'debug' ? logDebug : logInfo
      fn('renderer', args.message, { stack: args.stack, extra: args.extra })
    }
  )

  registerMessagePackHandler<{ maxLines?: number }, string>(
    'log:read',
    async (args) => {
      return readRecentLogs(args.maxLines ?? 500)
    }
  )

  // -- Shell, file watch, image persistence handlers are registered via registerMiscHandlers --

  createWindow()
  createTray()

  // Clipboard Enhancer and Quick Launcher desktop utilities
  registerClipboardEnhancer()
  registerQuickLauncher()

  // Auto-start enabled channels after window is ready
  if (channelManager) {
    void autoStartChannels(channelManager)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
}

app.on('window-all-closed', () => {
  // Don't quit when minimized to tray (isQuiting false + tray active)
  if (process.platform !== 'darwin' && (isQuiting || !tray)) {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupSshHandlers()
  if (channelManager) {
    void channelManager.stopAll()
  }
})
