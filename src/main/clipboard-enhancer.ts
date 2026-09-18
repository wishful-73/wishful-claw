/**
 * Clipboard Enhancer — ditto-style clipboard history.
 *
 * - Polls clipboard (250ms) for near-instant capture
 * - Stores history with expiry (configurable days)
 * - Popup via configurable global shortcut
 * - Click an item to paste into the previously focused app
 * - Independent config file (not in settings-store)
 */

import { app, BrowserWindow, clipboard, nativeImage } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import * as fs from 'fs'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import {
  pasteToForegroundWindow,
  registerPriorityShortcut,
  unregisterPriorityShortcut,
  type ShortcutContext
} from './priority-shortcuts'
import { getAuxiliaryWindowBounds } from './aux-window-screen'
import { safeSendMessagePackToWindow } from './window-ipc'
import { resolveDataDir } from './lib/data-dir'

let clipboardWindow: BrowserWindow | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastClipboardText = ''
let lastClipboardImageHash = ''
let lastImagePollAt = 0
let history: ClipboardEntry[] = []
let config: ClipboardConfig
let previousForegroundWindow: string | null = null
let previousFocusWindow: string | null = null
// Whether the accelerator that opened the panel contains Alt. A bare Alt press
// leaks to the target app (low-level hooks can't block the modifier itself)
// and Chrome answers by focusing its menu button — the restore path then
// injects Escape to clear that state.
let openedWithAlt = false

const DATA_DIR = resolveDataDir()
const HISTORY_FILE = join(DATA_DIR, 'clipboard-history.json')
const CONFIG_FILE = join(DATA_DIR, 'clipboard-config.json')
/** 图片内容落盘目录。文件名 = 内容 sha256，天然去重。 */
const IMAGES_DIR = join(DATA_DIR, 'clipboard-images')

/** 图片检测间隔。Ditto 靠 Win32 的剪贴板序列号判变化，Electron 没有这个 API，
 *  只能重新读一次剪贴板 —— 所以让图片检测独立于 250ms 的文本轮询，避免每轮都做
 *  PNG 读取与哈希。代价是复制图片后最多 1s 进历史。 */
const IMAGE_POLL_INTERVAL_MS = 1000

const DEFAULT_CONFIG: ClipboardConfig = {
  enabled: true,
  maxDays: 7,
  maxItems: 100,
  accelerators: ['Ctrl+Shift+V'],
  hideOnBlur: true
}

interface ClipboardEntry {
  id: string
  /** 图片条目为空字符串；历史里这个字段始终是 string，老数据无需迁移。 */
  text: string
  /** 缺省视为 'text' —— 图片支持之前写下的条目没有这个字段。 */
  type?: 'text' | 'image'
  /** 图片条目：IMAGES_DIR 下的文件名（不含路径），文件名本身就是内容 sha256。 */
  imageFile?: string
  imageWidth?: number
  imageHeight?: number
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

/** 按 maxItems 裁剪：置顶项永远保留，其余按「新的在前」取满。
 *  置顶项不受 maxItems 约束是有意的 —— 否则置顶只是「晚一点消失」。 */
function trimToMaxItems(entries: ClipboardEntry[], maxItems: number): ClipboardEntry[] {
  if (maxItems <= 0 || entries.length <= maxItems) return entries
  let remaining = maxItems - entries.filter((entry) => entry.pinned).length
  return entries.filter((entry) => {
    if (entry.pinned) return true
    if (remaining <= 0) return false
    remaining -= 1
    return true
  })
}

/** 图片文件被外部删掉 / 历史文件被手改坏时，条目留着也粘不回来，直接丢掉。 */
function isEntryUsable(entry: ClipboardEntry): boolean {
  if (entry.type !== 'image') return true
  if (!entry.imageFile) return false
  return fs.existsSync(join(IMAGES_DIR, entry.imageFile))
}

function loadHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        history = trimToMaxItems((parsed as ClipboardEntry[]).filter(isEntryUsable), config.maxItems)
        lastClipboardText = history.find((entry) => entry.type !== 'image')?.text ?? ''
        purgeExpired()
      }
    }
  } catch {
    // ignore
  }
}

/** 删掉没有任何历史条目引用的图片文件。
 *  只在 saveHistory 里做一次，delete / clear / 过期 / 裁剪四条路径就都覆盖到了。 */
function cleanupOrphanImageFiles(): void {
  try {
    if (!fs.existsSync(IMAGES_DIR)) return
    const referenced = new Set(
      history.map((entry) => entry.imageFile).filter((file): file is string => Boolean(file))
    )
    for (const name of fs.readdirSync(IMAGES_DIR)) {
      if (referenced.has(name)) continue
      try {
        fs.unlinkSync(join(IMAGES_DIR, name))
      } catch {
        // 单个文件删不掉不影响历史
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
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimToMaxItems(history, config.maxItems), null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    cleanupOrphanImageFiles()
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

function createEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 从剪贴板取图片的 PNG 字节。优先走 readBuffer —— 直接拿原始 PNG，
 *  省掉一次 nativeImage 解码 + 重编码，且拿到的字节可以直接哈希和落盘。 */
function readClipboardPngBuffer(): Buffer | null {
  for (const format of clipboard.availableFormats()) {
    if (!/png/i.test(format)) continue
    try {
      const buffer = clipboard.readBuffer(format)
      if (buffer && buffer.length > 0) return buffer
    } catch {
      // readBuffer 不接受这个格式名时换下一个候选
    }
  }
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const png = image.toPNG()
  return png && png.length > 0 ? png : null
}

/** PNG 的 IHDR 里直接躺着宽高，不必解码整张图。 */
function readPngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** 返回 true 表示本轮产出了图片条目 —— 调用方据此跳过同一次复制附带的文本。 */
function captureClipboardImage(): boolean {
  const now = Date.now()
  if (now - lastImagePollAt < IMAGE_POLL_INTERVAL_MS) return false
  lastImagePollAt = now

  const png = readClipboardPngBuffer()
  if (!png) return false

  const hash = createHash('sha256').update(png).digest('hex')
  if (hash === lastClipboardImageHash) return false
  lastClipboardImageHash = hash

  const imageFile = `${hash}.png`
  try {
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true, mode: 0o700 })
    }
    if (!fs.existsSync(join(IMAGES_DIR, imageFile))) {
      fs.writeFileSync(join(IMAGES_DIR, imageFile), png, { mode: 0o600 })
    }
  } catch {
    // 落盘失败就不记这条 —— 记了也粘不回来
    return false
  }

  const size = readPngSize(png) ?? nativeImage.createFromBuffer(png).getSize()
  const entry: ClipboardEntry = {
    id: createEntryId(),
    text: '',
    type: 'image',
    imageFile,
    imageWidth: size.width,
    imageHeight: size.height,
    timestamp: now,
    preview: `[图片] ${size.width}×${size.height}`
  }
  history = history.filter((item) => item.imageFile !== imageFile)
  history.unshift(entry)
  history = trimToMaxItems(history, config.maxItems)
  saveHistory()
  pushHistoryUpdate()
  return true
}

function captureClipboardText(): void {
  const text = clipboard.readText()
  if (!text || text === lastClipboardText) return
  lastClipboardText = text
  const entry: ClipboardEntry = {
    id: createEntryId(),
    text,
    timestamp: Date.now(),
    preview: text.slice(0, 200).replace(/\n/g, ' ')
  }
  // Deduplicate
  history = history.filter((item) => item.text !== text)
  history.unshift(entry)
  history = trimToMaxItems(history, config.maxItems)
  saveHistory()
  pushHistoryUpdate()
}

function startClipboardPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (!config.enabled) return
    // 图片优先：复制图片的程序往往同时给出一份文本（路径 / alt 文本），
    // 两个都记就成了两条重复历史。Ditto 同样是 PNG / DIB 优先。
    if (captureClipboardImage()) {
      lastClipboardText = clipboard.readText()
      return
    }
    captureClipboardText()
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
    const registered = registerPriorityShortcut(id, accelerator, (context) => {
      openedWithAlt = accelerator.toLowerCase().includes('alt')
      createClipboardWindow(context)
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
  // 收条目 id；同时兼容旧的「直接传文本」写法，避免剪贴板窗口用到旧渲染端时整体失效。
  registerMessagePackHandler<{ id?: string } | string, boolean>('clipboard:copy', (payload) => {
    const id = typeof payload === 'string' ? payload : (payload?.id ?? '')
    const existing =
      history.find((item) => item.id === id) ?? history.find((item) => item.text === id)
    if (!existing) return false

    const targetWindow = previousForegroundWindow
    const targetFocus = previousFocusWindow
    const clearMenu = openedWithAlt
    previousForegroundWindow = null
    previousFocusWindow = null

    if (existing.type === 'image' && existing.imageFile) {
      const image = nativeImage.createFromPath(join(IMAGES_DIR, existing.imageFile))
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      // 自己写进去的内容不该被轮询再记一遍
      lastClipboardImageHash = existing.imageFile.replace(/\.png$/i, '')
      lastClipboardText = ''
    } else {
      clipboard.writeText(existing.text)
      lastClipboardText = existing.text
    }

    // Move the used entry to top and update lastUsed
    const now = Date.now()
    existing.lastUsed = now
    existing.timestamp = now
    history = history.filter((item) => item.id !== existing.id)
    history.unshift(existing)
    saveHistory()
    clipboardWindow?.hide()
    return pasteToForegroundWindow(targetWindow, targetFocus, true, clearMenu)
  })

  // 渲染端取图片条目的缩略图。传 data URL 而不是文件路径 —— 剪贴板窗口是独立的
  // BrowserWindow，没必要为了读本地图片去放宽它的加载策略。
  registerMessagePackHandler<{ file?: string }, { dataUrl?: string; error?: string }>(
    'clipboard:read-image',
    (payload) => {
      const file = typeof payload?.file === 'string' ? payload.file : ''
      // 只接受本目录下的纯文件名，挡住路径穿越
      if (!file || file !== basename(file)) return { error: 'Invalid image file' }
      try {
        const bytes = fs.readFileSync(join(IMAGES_DIR, file))
        if (bytes.length === 0) return { error: 'Empty image file' }
        return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to read image' }
      }
    }
  )

  // 把 base64 图片写进系统剪贴板。聊天窗的复制按钮与预览面板都走这里 ——
  // 渲染端没有直接写剪贴板的能力，真正的写入只能发生在主进程。
  registerMessagePackHandler<{ data?: string }, { error?: string }>(
    'clipboard:write-image',
    (payload) => {
      const raw = typeof payload?.data === 'string' ? payload.data : ''
      // 容错：调用方可能把整个 data URL 丢进来
      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      if (!base64.trim()) return { error: 'Missing image data' }
      try {
        const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
        if (image.isEmpty()) return { error: 'Unsupported image data' }
        clipboard.writeImage(image)
        return {}
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Failed to write image to clipboard'
        }
      }
    }
  )

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
      history = trimToMaxItems(history, config.maxItems)
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

export function createClipboardWindow(context: ShortcutContext = {
  foregroundWindow: null,
  focusWindow: null,
  foregroundWindowRect: null,
  focusWindowRect: null,
  caretRect: null,
  mousePoint: null
}): void {
  registerClipboardIpc()

  const winWidth = 420
  const winHeight = 560
  const bounds = getAuxiliaryWindowBounds(context, winWidth, winHeight, 'clipboard')

  if (clipboardWindow) {
    if (clipboardWindow.isVisible()) {
      hideClipboardWindow()
    } else {
      previousForegroundWindow = context.foregroundWindow
      previousFocusWindow = context.focusWindow
      clipboardWindow.setBounds(bounds)
      clipboardWindow.show()
      clipboardWindow.focus()
      pushThemeRefresh()
      pushHistoryUpdate()
    }
    return
  }

  clipboardWindow = new BrowserWindow({
    ...bounds,
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

  previousForegroundWindow = context.foregroundWindow
  previousFocusWindow = context.focusWindow
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
