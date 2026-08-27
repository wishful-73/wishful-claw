/**
 * Clipboard Enhancer — ditto-style clipboard history.
 *
 * - Polls clipboard (250ms) for near-instant capture
 * - Stores history with expiry (configurable days)
 * - Popup via configurable global shortcut
 * - Click an item to paste into the previously focused app
 * - Independent config file (not in settings-store)
 */

import { app, BrowserWindow, clipboard, screen } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { pasteToForegroundWindow, registerPriorityShortcut, unregisterPriorityShortcut } from './priority-shortcuts'
import { safeSendMessagePackToWindow } from './window-ipc'

let clipboardWindow: BrowserWindow | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastClipboardText = ''
let history: ClipboardEntry[] = []
let config: ClipboardConfig
let previousForegroundWindow: string | null = null
let previousFocusWindow: string | null = null
// Whether the accelerator that opened the panel contains Alt. A bare Alt press
// leaks to the target app (low-level hooks can't block the modifier itself)
// and Chrome answers by focusing its menu button — the restore path then
// injects Escape to clear that state.
let openedWithAlt = false

const DATA_DIR = join(app.getPath('home'), '.wishful-claw')
const HISTORY_FILE = join(DATA_DIR, 'clipboard-history.json')
const CONFIG_FILE = join(DATA_DIR, 'clipboard-config.json')

const DEFAULT_CONFIG: ClipboardConfig = {
  enabled: true,
  maxDays: 7,
  maxItems: 100,
  accelerators: ['Ctrl+Shift+V'],
  hideOnBlur: true
}

interface ClipboardEntry {
  id: string
  text: string
  timestamp: number
  preview: string
  lastUsed?: number
  pinned?: boolean
}

interface ClipboardConfig {
  enabled: boolean
  maxDays: number
  maxItems: number
  accelerators: string[]
  hideOnBlur: boolean
}

// ── Config persistence ──

function loadConfig(): ClipboardConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      const accelerators = Array.isArray(parsed.accelerators)
        ? parsed.accelerators
            .filter((value: unknown): value is string => typeof value === 'string')
            .filter((value: string, index: number, values: string[]) => values.indexOf(value) === index)
        : typeof parsed.accelerator === 'string'
          ? [parsed.accelerator]
          : DEFAULT_CONFIG.accelerators
      return {
        enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
        maxDays: typeof parsed.maxDays === 'number' ? parsed.maxDays : DEFAULT_CONFIG.maxDays,
        maxItems: typeof parsed.maxItems === 'number' ? parsed.maxItems : DEFAULT_CONFIG.maxItems,
        accelerators: accelerators.length > 0 ? accelerators : DEFAULT_CONFIG.accelerators,
        hideOnBlur: typeof parsed.hideOnBlur === 'boolean' ? parsed.hideOnBlur : DEFAULT_CONFIG.hideOnBlur
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG }
}

function saveConfig(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // ignore
  }
}

// ── History persistence ──

function loadHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        history = parsed.slice(0, config.maxItems)
        lastClipboardText = history[0]?.text ?? ''
        purgeExpired()
      }
    }
  } catch {
    // ignore
  }
}

function saveHistory(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, config.maxItems), null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // ignore
  }
}

/** Remove entries older than maxDays. Pinned items are never purged.
 *  Expiry is based on lastUsed (or timestamp if never used), not creation time.
 */
function purgeExpired(): void {
  if (config.maxDays <= 0) return
  const cutoff = Date.now() - config.maxDays * 24 * 60 * 60 * 1000
  const before = history.length
  history = history.filter((entry) => {
    if (entry.pinned) return true
    const refTime = entry.lastUsed ?? entry.timestamp
    return refTime >= cutoff
  })
  if (history.length !== before) {
    saveHistory()
  }
}

// ── Clipboard polling ──

function pushHistoryUpdate(): void {
  if (clipboardWindow?.isVisible()) {
    safeSendMessagePackToWindow(clipboardWindow, 'clipboard:history-updated', history)
  }
}

/** Tell the renderer to re-sync theme from main app settings. */
function pushThemeRefresh(): void {
  if (clipboardWindow) {
    safeSendMessagePackToWindow(clipboardWindow, 'clipboard:theme-refresh', null)
  }
}

function startClipboardPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (!config.enabled) return
    const text = clipboard.readText()
    if (text && text !== lastClipboardText) {
      lastClipboardText = text
      const entry: ClipboardEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        timestamp: Date.now(),
        preview: text.slice(0, 200).replace(/\n/g, ' ')
      }
      // Deduplicate
      history = history.filter((item) => item.text !== text)
      history.unshift(entry)
      history = history.slice(0, config.maxItems)
      saveHistory()
      pushHistoryUpdate()
    }
  }, 250)
}

// ── Shortcut registration ──

const registeredShortcutIds: string[] = []

function unregisterShortcut(): void {
  for (const id of registeredShortcutIds) {
    unregisterPriorityShortcut(id)
  }
  registeredShortcutIds.length = 0
}

function registerShortcut(): boolean {
  unregisterShortcut()
  if (!config.enabled) return false
  let allRegistered = true
  for (let index = 0; index < config.accelerators.length; index++) {
    const id = `clipboard-enhancer-${index}`
    const accelerator = config.accelerators[index]
    const registered = registerPriorityShortcut(id, accelerator, ({ foregroundWindow, focusWindow }) => {
      openedWithAlt = accelerator.toLowerCase().includes('alt')
      createClipboardWindow(foregroundWindow, focusWindow)
    })
    registeredShortcutIds.push(id)
    if (!registered) allRegistered = false
  }
  return allRegistered
}

// ── IPC ──

let ipcRegistered = false

function registerClipboardIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  registerMessagePackHandler<void, ClipboardEntry[]>('clipboard:get-history', () => history)

  // Copy + paste into the app that was active before the panel opened.
  registerMessagePackHandler<string, boolean>('clipboard:copy', (text) => {
    const targetWindow = previousForegroundWindow
    const targetFocus = previousFocusWindow
    const clearMenu = openedWithAlt
    previousForegroundWindow = null
    previousFocusWindow = null
    clipboard.writeText(text)
    lastClipboardText = text
    // Move the used entry to top and update lastUsed
    const now = Date.now()
    const existing = history.find((item) => item.text === text)
    if (existing) {
      existing.lastUsed = now
      existing.timestamp = now
      history = history.filter((item) => item.id !== existing.id)
      history.unshift(existing)
      saveHistory()
    }
    clipboardWindow?.hide()
    return pasteToForegroundWindow(targetWindow, targetFocus, true, clearMenu)
  })

  registerMessagePackHandler<string, ClipboardEntry[]>('clipboard:delete', (id) => {
    history = history.filter((item) => item.id !== id)
    saveHistory()
    return history
  })

  registerMessagePackHandler<string, ClipboardEntry[]>('clipboard:toggle-pin', (id) => {
    const entry = history.find((item) => item.id === id)
    if (entry) {
      entry.pinned = !entry.pinned
      if (entry.pinned) {
        entry.lastUsed = Date.now()
      }
      saveHistory()
    }
    return history
  })

  registerMessagePackHandler<void, ClipboardEntry[]>('clipboard:clear', () => {
    history = []
    saveHistory()
    return []
  })

  // ── Config IPC ──

  registerMessagePackHandler<void, ClipboardConfig>('clipboard:get-config', () => config)

  registerMessagePackHandler<void, void>('clipboard:hide', () => {
    hideClipboardWindow()
  })

  registerMessagePackHandler<Partial<ClipboardConfig>, ClipboardConfig & { shortcutRegistered: boolean }>('clipboard:update-config', (patch) => {
    const oldAccelerators = config.accelerators
    const wasEnabled = config.enabled
    config = { ...config, ...patch }
    saveConfig()

    let shortcutRegistered = true
    // Apply changes
    if (patch.maxDays !== undefined) {
      purgeExpired()
    }
    if (patch.maxItems !== undefined && history.length > config.maxItems) {
      history = history.slice(0, config.maxItems)
      saveHistory()
    }
    if (patch.enabled !== undefined || patch.accelerators !== undefined) {
      if (!config.enabled) {
        unregisterShortcut()
      } else if (config.accelerators !== oldAccelerators || !wasEnabled) {
        shortcutRegistered = registerShortcut()
      }
    }

    pushHistoryUpdate()
    return { ...config, shortcutRegistered }
  })
}

// ── Window ──

/** Hide the panel. When the hide is explicit (hotkey toggle / Escape), hand
 *  focus back to the app that opened it (ditto-style). Order matters: activate
 *  the target FIRST, then hide — hiding first races the OS's own window switch
 *  and Chrome loses the page's DOM focus (Ditto does ReleaseFocus before
 *  ShowWindow(SW_HIDE) for the same reason). On blur the focus has already
 *  moved to whatever the user clicked, so leave it alone. */
function hideClipboardWindow(restoreFocus = true): void {
  if (!clipboardWindow || !clipboardWindow.isVisible()) return
  const win = clipboardWindow
  const targetWindow = previousForegroundWindow
  const targetFocus = previousFocusWindow
  const clearMenu = openedWithAlt
  previousForegroundWindow = null
  previousFocusWindow = null
  let focusSent = false
  if (restoreFocus && targetWindow) {
    focusSent = pasteToForegroundWindow(targetWindow, targetFocus, false, clearMenu)
  }
  if (focusSent) {
    // The focus restore is an asynchronous bridge message — hiding in the
    // same tick races it (the bridge may re-activate us after hide, or the
    // OS window switch triggered by hide may beat the activation). Give the
    // message a beat to land before hiding.
    setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible()) win.hide()
    }, 150)
  } else {
    win.hide()
  }
}

export function createClipboardWindow(foregroundWindow: string | null = null, focusWindow: string | null = null): void {
  registerClipboardIpc()

  if (clipboardWindow) {
    if (clipboardWindow.isVisible()) {
      hideClipboardWindow()
    } else {
      previousForegroundWindow = foregroundWindow
      previousFocusWindow = focusWindow
      clipboardWindow.show()
      clipboardWindow.focus()
      pushThemeRefresh()
      pushHistoryUpdate()
    }
    return
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const winWidth = 420
  const winHeight = 560

  clipboardWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round((screenWidth - winWidth) / 2),
    y: Math.round((screenHeight - winHeight) / 2 - 50),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  clipboardWindow.on('blur', () => {
    if (config.hideOnBlur) {
      hideClipboardWindow(false)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    clipboardWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/clipboard.html`)
  } else {
    clipboardWindow.loadFile(join(__dirname, '../renderer/clipboard.html'))
  }

  previousForegroundWindow = foregroundWindow
  previousFocusWindow = focusWindow
  clipboardWindow.show()
  clipboardWindow.focus()
  // Push initial data once the renderer actually loaded — a fixed 200ms
  // timer loses the first paint on slow loads. The fallback covers pages
  // whose load events never fire.
  let initialPushDone = false
  const pushInitialData = (): void => {
    if (initialPushDone) return
    initialPushDone = true
    pushThemeRefresh()
    pushHistoryUpdate()
  }
  clipboardWindow.webContents.once('did-finish-load', () => {
    // Small settle delay so the renderer's IPC listeners are attached.
    setTimeout(pushInitialData, 100)
  })
  setTimeout(pushInitialData, 2000)
}

// ── Init ──

export function registerClipboardEnhancer(): void {
  config = loadConfig()
  registerClipboardIpc()
  loadHistory()
  purgeExpired()
  startClipboardPolling()
  registerShortcut()

  // Periodic purge every 10 minutes
  setInterval(() => purgeExpired(), 10 * 60 * 1000)

  app.on('will-quit', () => {
    unregisterShortcut()
    previousForegroundWindow = null
    previousFocusWindow = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })
}
