/**
 * 启动器窗口与全局快捷键。
 *
 * S-249 从 `quick-launcher.ts` 搬出：原文件把「快捷键注册」和「窗口生命周期」隔着上千行分开放，
 * 两者其实是同一件事（快捷键按下就是开窗），合并到这里。
 *
 * 相对原文件的改动：`config.` → `getConfig().`；`registerLauncherIpc()` → `ensureLauncherIpc()`
 * （破环，见 `ipc-registrar.ts`）；补 `export` 与 `getLauncherWindow()`。失焦隐藏的宽容期、
 * Windows 前台锁的激活兜底、窗口参数全部一字未动。
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { getAuxiliaryWindowBounds } from '../aux-window-screen'
import {
  forceActivateWindow,
  registerPriorityShortcut,
  unregisterPriorityShortcut,
  type ShortcutContext
} from '../priority-shortcuts'
import { safeSendMessagePackToWindow } from '../window-ipc'
import { getConfig } from './config'
import { ensureLauncherIpc } from './ipc-registrar'

let launcherWindow: BrowserWindow | null = null
let launcherBlurHideTimer: NodeJS.Timeout | null = null
let launcherActivationTimer: NodeJS.Timeout | null = null
let launcherGraceUntil = 0

// ── Shortcut registration ──

const registeredIds: string[] = []

export function unregisterShortcut(): void {
  for (const id of registeredIds) {
    unregisterPriorityShortcut(id)
  }
  registeredIds.length = 0
}

export function registerShortcut(): boolean {
  unregisterShortcut()
  if (!getConfig().enabled) return false
  let allOk = true
  for (let i = 0; i < getConfig().accelerators.length; i++) {
    const id = `quick-launcher-${i}`
    const ok = registerPriorityShortcut(id, getConfig().accelerators[i], (context) => {
      createLauncherWindow(context)
    })
    registeredIds.push(id)
    if (!ok) allOk = false
  }
  return allOk
}

// ── Window ──

const LAUNCHER_BLUR_CONFIRM_MS = 120
const LAUNCHER_ACTIVATION_GRACE_MS = 250
const LAUNCHER_WIDTH = 600
const LAUNCHER_HEIGHT = 400

function clearLauncherBlurHideTimer(): void {
  if (launcherBlurHideTimer) {
    clearTimeout(launcherBlurHideTimer)
    launcherBlurHideTimer = null
  }
}

function clearLauncherActivationTimer(): void {
  if (launcherActivationTimer) {
    clearTimeout(launcherActivationTimer)
    launcherActivationTimer = null
  }
}

export function clearLauncherTimers(): void {
  clearLauncherBlurHideTimer()
  clearLauncherActivationTimer()
}

export function hideLauncherWindow(): void {
  clearLauncherTimers()
  launcherGraceUntil = 0
  if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
    launcherWindow.hide()
  }
}

function scheduleLauncherBlurHide(): void {
  clearLauncherBlurHideTimer()
  const delay = Math.max(LAUNCHER_BLUR_CONFIRM_MS, launcherGraceUntil - Date.now())
  launcherBlurHideTimer = setTimeout(() => {
    launcherBlurHideTimer = null
    const win = launcherWindow
    if (!win || win.isDestroyed() || !win.isVisible()) return
    if (win.isFocused()) return
    if (Date.now() < launcherGraceUntil) {
      scheduleLauncherBlurHide()
      return
    }
    hideLauncherWindow()
  }, delay)
}

function positionLauncherWindow(context: ShortcutContext): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return
  const bounds = getAuxiliaryWindowBounds(context, LAUNCHER_WIDTH, LAUNCHER_HEIGHT, 'launcher')
  launcherWindow.setBounds(bounds)
}

export function createLauncherWindow(context: ShortcutContext = {
  foregroundWindow: null,
  focusWindow: null,
  foregroundWindowRect: null,
  focusWindowRect: null,
  caretRect: null,
  mousePoint: null
}): void {
  ensureLauncherIpc()

  if (launcherWindow) {
    if (launcherWindow.isVisible()) {
      hideLauncherWindow()
    } else {
      clearLauncherTimers()
      positionLauncherWindow(context)
      launcherGraceUntil = Date.now() + LAUNCHER_ACTIVATION_GRACE_MS
      launcherWindow.show()
      // Windows foreground lock: once a launched app (or an agent window)
      // owns the foreground, plain focus() loses the race — the window shows
      // but the keyboard target stays with the other process. Route through
      // the PowerShell bridge's EnsureForeground chain (timeout reset + Alt
      // workaround) to actually win activation.
      if (!forceActivateWindow(launcherWindow)) {
        launcherWindow.focus()
      }
    }
    return
  }

  const bounds = getAuxiliaryWindowBounds(context, LAUNCHER_WIDTH, LAUNCHER_HEIGHT, 'launcher')
  launcherWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

  launcherWindow.on('blur', () => {
    scheduleLauncherBlurHide()
  })
  launcherWindow.on('focus', () => {
    clearLauncherBlurHideTimer()
    launcherGraceUntil = 0
  })
  launcherWindow.on('close', () => {
    clearLauncherTimers()
  })
  launcherWindow.on('closed', () => {
    clearLauncherTimers()
    launcherWindow = null
    launcherGraceUntil = 0
  })

  // Send reset event after show so renderer clears input and focuses.
  // The bridge-based force activation wins the Windows foreground lock even
  // when another app (just-launched software, an agent window) owns focus;
  // the short delay only covers the initial show/activate settle.
  launcherWindow.on('show', () => {
    launcherGraceUntil = Date.now() + LAUNCHER_ACTIVATION_GRACE_MS
    clearLauncherTimers()
    launcherActivationTimer = setTimeout(() => {
      launcherActivationTimer = null
      const win = launcherWindow
      if (!win || win.isDestroyed() || !win.isVisible()) return
      if (!forceActivateWindow(win)) {
        win.focus()
      }
      safeSendMessagePackToWindow(win, 'launcher:reset', null)
    }, 30)
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    launcherWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/launcher.html`)
  } else {
    launcherWindow.loadFile(join(__dirname, '../renderer/launcher.html'))
  }

  launcherGraceUntil = Date.now() + LAUNCHER_ACTIVATION_GRACE_MS
  launcherWindow.show()
  if (!forceActivateWindow(launcherWindow)) {
    launcherWindow.focus()
  }
}

/** 当前启动器窗口（IPC 里当对话框父窗口用；可能已被销毁，调用方自己判）。 */
export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow
}