import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

// 用 Vite ?asset 导入图标，构建时自动复制到 out/main/，路径始终正确
// 参考 OpenCowork 的做法（src/main/index.ts 第 28 行）
import appIcon from '../../resources/icon-256.png?asset'

import { latchNativeWorkerShutdown } from './lib/native-worker'
import { logError, logWarn, logInfo, logDebug, installGlobalExceptionHandlers, readRecentLogs, listLogFiles, readLogFile, cleanupOldLogFiles } from './lib/logger'
import { resolveDataPath } from './lib/data-dir'
import { WISHFUL_CLAW_DISPLAY_NAME, WISHFUL_CLAW_DEV_DISPLAY_NAME } from '../shared/data-dir'
import type { LogCleanupResult, LogFileContent, LogFileInfo } from '../shared/logging'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { registerAiProviderHandlers } from './ipc/ai-provider-handlers'
import { registerSettingsHandlers, initializeLogLevelFromSettings } from './ipc/settings-handlers'
import { registerAgentStreamForwarder } from './ipc/agent-stream-handler'
import { registerNativeAgentRuntimeHandlers } from './ipc/native-agent-runtime'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerTerminalHandlers, killAllTerminalSessions } from './ipc/terminal-handlers'
import { registerAgentChangeHandlers } from './ipc/agent-change-handlers'
import { registerMcpHandlers, shutdownMcp } from './ipc/mcp-handlers'
import { registerVideoHandlers } from './ipc/video-handlers'
import { registerExtensionHandlers } from './ipc/extension-handlers'
import { registerWebFetchHandlers } from './ipc/web-fetch-handlers'
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
import {
  flushPendingReveal,
  notifyHiddenStartup,
  revealMainWindowOrDefer,
  showMainWindow,
  toggleMainWindow
} from './main-window-visibility'
import { shouldShowOnStartup } from './startup-flags'
import {
  applyMainWindowShortcuts,
  reconcileLoginItemOnStartup,
  registerMainWindowHandlers
} from './main-window-config'
import { registerMiscHandlers } from './ipc/misc-handlers'
import { registerDialogHandlers } from './ipc/dialog-handlers'
import { registerInputDraftHandlers } from './ipc/input-draft-handlers'
import { registerWorkerForwardHandlers } from './ipc/worker-forward-handlers'
import { registerCodeGraphHandlers } from './ipc/codegraph-handlers'
import {
  initializeCronScheduler,
  registerCronHandlers,
  releaseCronRunsAfterRendererExit,
  shutdownCronScheduler
} from './ipc/reverse-handlers/cron-reverse-handler'
import {
  installMemoryOrganizationScheduler,
  shutdownMemoryOrganizationScheduler
} from './ipc/memory-organization-scheduler'
import {
  registerSessionFollowUpHandlers,
  shutdownSessionFollowUpScheduler
} from './ipc/session-follow-up-scheduler'
import { readPersistedSettings, writePersistedSettings, clearPersistedSettings } from './lib/settings-store'
import {
  getUpdateStatus,
  initializeUpdater,
  requestUpdateCheck,
  requestUpdateDownload,
  requestUpdateInstall
} from './updater'
import type { UpdateActionResult, UpdateCheckResult, UpdateDownloadStartResult } from '../shared/updater/types'

let mainWindow: BrowserWindow | null = null
let channelManager: ChannelManager | null = null
let tray: Tray | null = null
let isQuiting = false

/**
 * Resolved once: `process.argv` cannot change after boot, so re-reading it in
 * every window callback would just re-derive the same value.
 */
const showOnStartup = shouldShowOnStartup(process.argv)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: appDisplayName,
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
    // Quiet start (`--hidden`, written into the login item): tray only, with
    // `notifyHiddenStartup()` telling the user the app is running. Every other
    // launch shows the window exactly as before.
    if (showOnStartup) mainWindow!.show()
  })
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow?.setTitle(appDisplayName)
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
    releaseCronRunsAfterRendererExit()
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

  // Redeem a reveal request that arrived before this window existed.
  flushPendingReveal()
}

// showMainWindow moved to `main-window-visibility.ts`: the tray, the second
// instance, the toggle shortcut and update details all share that one restore
// path, and it has to be reachable without importing this file.

/**
 * The tray carries no update state: it only brings the window forward and asks the renderer to look,
 * and the renderer answers by re-reading the `update:status` snapshot from Main.
 */
function showUpdateDetails(): void {
  showMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  safeSendMessagePackToWindow(mainWindow, 'update:show-details', null)
}

// ── Tray ──

function getTrayIcon(): Electron.NativeImage {
  // 用 Vite ?asset 导入的图标路径，开发/打包通用
  return nativeImage.createFromPath(appIcon)
}

function createTray(): void {
  if (tray) return
  tray = new Tray(getTrayIcon())
  tray.setToolTip(appDisplayName)
  const contextMenu = Menu.buildFromTemplate([
    // Neutral wording on purpose: a "show …" label would be lying half the time,
    // since the very same item hides the window when it is already visible.
    { label: '显示/隐藏主窗口', click: () => toggleMainWindow() },
    // Permanent entry, not conditional on an update being in flight: with nothing pending it opens
    // the details dialog in its idle state, where the user can re-check.
    { label: '更新详情', click: () => showUpdateDetails() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuiting = true; app.quit() } }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => showMainWindow())
}

const appDisplayName = app.isPackaged ? WISHFUL_CLAW_DISPLAY_NAME : WISHFUL_CLAW_DEV_DISPLAY_NAME
app.setName(appDisplayName)

app.setPath('userData', resolveDataPath('electron-user-data'))

// 单实例锁：双击 exe 时聚焦已有窗口，不启动新进程
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Deferred when the window is not built yet — on a quiet start this is the
    // only way back to a visible window.
    revealMainWindowOrDefer()
  })

  app.whenReady().then(() => {
  installGlobalExceptionHandlers()
  // Seed the log level from the unified settings before anything else logs.
  initializeLogLevelFromSettings()
  logInfo('main', 'Application started')
  app.setAppUserModelId('com.wishfulclaw.app')

  // Window control handlers (minimize / maximize / close / isMaximized)
  registerWindowControlHandlers()

  // Login item (auto-start) handlers
  registerLoginItemHandlers()

  // Main-window shortcut tab endpoints
  registerMainWindowHandlers()

  // Re-assert the login item's command line, so installs predating `--hidden`
  // (and installs whose exe path has moved) self-correct.
  reconcileLoginItemOnStartup()

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


  // ── Folder pickers (extracted to ipc/dialog-handlers.ts) ──
  registerDialogHandlers()

  // ── File system handlers (extracted to ipc/fs-handlers.ts) ──
  registerFsHandlers()
  registerTerminalHandlers()
  registerAgentChangeHandlers()
  registerMcpHandlers()
  registerCronHandlers()
  registerSessionFollowUpHandlers({ getMainWindow: () => mainWindow })
  registerVideoHandlers()
  registerExtensionHandlers()
registerWebFetchHandlers()
registerCodeGraphHandlers()

  // ── Worker forwarders (agent-history / db / goal) ──
  registerWorkerForwardHandlers()
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


  // ── Config handlers (key-value store over the settings file, same pattern
  //    as settings:get/set; backs the renderer's configStorage zustand stores,
  //    e.g. the app-plugin store whose enabled flags gate CodeGraph tools) ──
  registerMessagePackHandler<string, unknown | null>(
    'config:get',
    (key) => readPersistedSettings(key)
  )
  registerMessagePackHandler<{ key: string; value: unknown }, { success: boolean }>(
    'config:set',
    ({ key, value }) => {
      if (value === undefined) {
        clearPersistedSettings(key)
      } else {
        writePersistedSettings(value, key)
      }
      return { success: true }
    }
  )

  // ── Input draft persistence (JSON map under ~/.wishful-claw/) ──
  registerInputDraftHandlers()

  registerMessagePackHandler<unknown, string>('app:global-memory-home', async () => resolveDataPath())
  registerMessagePackHandler<unknown, boolean>('app:is-development', async () => !app.isPackaged)

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

  // -- Log file management (Settings → Logs page) --
  registerMessagePackHandler<Record<string, unknown>, LogFileInfo[]>(
    'log:list-files',
    async () => {
      return listLogFiles()
    }
  )

  registerMessagePackHandler<{ name: string }, LogFileContent | null>(
    'log:read-file',
    async (args) => {
      return readLogFile(args?.name ?? '')
    }
  )

  registerMessagePackHandler<{ days: number }, LogCleanupResult>(
    'log:cleanup',
    async (args) => {
      return cleanupOldLogFiles(Number(args?.days) || 0)
    }
  )

  // -- Shell, file watch, image persistence handlers are registered via registerMiscHandlers --

  registerMessagePackHandler<unknown, UpdateCheckResult>(
    'update:check',
    async () => requestUpdateCheck()
  )
  registerMessagePackHandler<unknown, UpdateDownloadStartResult>(
    'update:download',
    async () => requestUpdateDownload()
  )
  registerMessagePackHandler<unknown, ReturnType<typeof getUpdateStatus>>(
    'update:status',
    () => getUpdateStatus()
  )
  registerMessagePackHandler<unknown, UpdateActionResult>(
    'update:install',
    () => requestUpdateInstall()
  )

  createWindow()
  createTray()
  void initializeUpdater({
    getMainWindow: () => mainWindow,
    markAppWillQuit: () => { isQuiting = true }
  }).catch((error) => {
    logWarn('main', `Updater initialization failed: ${String(error)}`)
  })

  // Clipboard Enhancer and Quick Launcher desktop utilities
  registerClipboardEnhancer()
  registerQuickLauncher()

  // Toggle shortcut (no accelerator by default — see the config module)
  applyMainWindowShortcuts()

  // A quiet start has no window to look at, so say where the app went.
  if (!showOnStartup) notifyHiddenStartup()

  // Restore persisted Cron jobs before auto-starting channels. Session follow-ups
  // restore after the renderer explicitly announces that its listener is ready.
  void initializeCronScheduler()

  // Daily memory organization triggers (startup throttle + nightly crossing).
  installMemoryOrganizationScheduler()

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
  shutdownCronScheduler()
  shutdownSessionFollowUpScheduler()
  shutdownMemoryOrganizationScheduler()
  if (channelManager) {
    void channelManager.stopAll()
  }
  // Terminate every child process class before exit — none of these may
  // survive app quit (worker / MCP stdio servers / pty terminals).
  killAllTerminalSessions()
  latchNativeWorkerShutdown()
  void shutdownMcp().catch((err) => {
    logWarn('main', `MCP shutdown failed: ${String(err)}`)
  })
})
