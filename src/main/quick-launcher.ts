/**
 * Quick Launcher — configurable global shortcut launcher (utools-style).
 *
 * Scans Windows Start Menu .lnk files, provides fuzzy search,
 * and launches the selected application.
 *
 * Shortcut is stored in ~/.wishful-claw/launcher-config.json and can be
 * modified from both the main settings page and (future) the launcher window.
 */

import { app, BrowserWindow, shell, dialog } from 'electron'
import { execFile, spawn } from 'child_process'
import { join } from 'path'
import * as fs from 'fs'
import { pinyin } from 'pinyin-pro'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { registerPriorityShortcut, unregisterPriorityShortcut, forceActivateWindow, type ShortcutContext } from './priority-shortcuts'
import { getAuxiliaryWindowBounds } from './aux-window-screen'
import { safeSendMessagePackToWindow } from './window-ipc'
import { WINDOWS_SETTINGS } from './launcher-system-settings'
import { extractPeIcon } from './pe-icon-extractor'
import { resolveDataDir } from './lib/data-dir'
import {
  EVERYTHING_DOWNLOAD_URL,
  EVERYTHING_EXE_BASENAMES,
  EVERYTHING_SCAN_MAX_DEPTH,
  buildEverythingSearchArgs,
  extractEverythingRegistryCandidates,
  getKnownInstallCandidates,
  isEverythingExecutableName,
  isEverythingVersionInfoHit,
  isThirdPartyPrivateEverythingPath,
  parseEverythingServiceImagePath,
  parseExecutablePathLines,
  parseRegistryUninstallBlocks,
  pickEverythingExePath,
  sanitizeEverythingCandidates,
  shouldScanIntoDirectory,
  type EverythingExeMatch,
  type EverythingExeSource
} from './lib/everything-search'
import {
  ES_EXE_BASENAME,
  ES_PROCESS_TIMEOUT_MS,
  ES_SEARCH_LIMIT,
  buildEsArgs,
  classifyEsFailure,
  getEsAlongsideCandidates,
  getEsBuiltinPath,
  getEsKnownDirCandidates,
  isEsExecutableName,
  isEsVersionInfoHit,
  parseEsJson,
  parseEsPathLines,
  pickEsCandidate,
  type EsExeMatch,
  type EsExeSource,
  type EsFailure,
  type FileHit
} from './lib/es-search'

let launcherWindow: BrowserWindow | null = null
let launcherBlurHideTimer: NodeJS.Timeout | null = null
let launcherActivationTimer: NodeJS.Timeout | null = null
let launcherGraceUntil = 0
let appListCache: AppShortcut[] | null = null
let cacheTime = 0
let config: LauncherConfig
const iconCache = new Map<string, string | null>()

interface AppShortcut {
  name: string
  path: string
  iconDataUrl?: string
  pinyinFull?: string
  pinyinInitials?: string
  /** Lowercased word/camel initials, e.g. "Wishful Claw" / "wishfulClaw" → "wc". */
  initials?: string
  /** Name with separators removed, lowercased, e.g. "Wishful Claw" → "wishfulclaw". */
  compact?: string
  isHistory?: boolean
  /** System settings/tools entry — renderer shows a "系统" badge. */
  isSystem?: boolean
  /** Pre-extracted icon file (PNG on disk) — used when the path itself
   * can't be resolved by app.getFileIcon (e.g. shell:AppsFolder\...). */
  iconFile?: string
}

interface CustomApp {
  name: string
  path: string
}

interface UwpApp {
  name: string
  appId: string
  /** Absolute path of the icon PNG extracted during the scan (may be missing). */
  iconPath?: string
}

interface UwpCacheFile {
  /** Bump to force a rescan of stale caches written by older builds. */
  version: number
  time: number
  apps: UwpApp[]
}

interface LauncherConfig {
  enabled: boolean
  accelerators: string[]
  customApps: CustomApp[]
  launchHistory: CustomApp[]
  /** S-151：搜索模式。`app` 走开始菜单扫描，`file` 交给 Everything 接管。 */
  searchMode: LauncherSearchMode
  /** S-151：用户手动指定的 Everything.exe。空串 = 未指定，走自动探测。 */
  everythingExePath: string
  /**
   * S-151 二轮：`everythingExePath` 是「本机检测」自动绑定的（true）还是用户手选的（false）。
   *
   * 两者占同一个槽位（用户手选永远最高优先级），只在设置页文案上区分 —— 不然自动绑上的路径
   * 会被标成「手动指定」，用户看着莫名其妙。
   */
  everythingExePathAuto: boolean
  /**
   * S-155：取数用的 es.exe。空串 = 未指定，走自动探测（Everything 同目录 / 常见安装位 / PATH）。
   *
   * 与 `everythingExePath` 是两个槽位 —— 一个指 GUI 本体（投递式降级与索引靠它），一个指命令行版
   * （自渲染取数靠它），两者可以只有一个存在。
   */
  esExePath: string
  /** S-155：`esExePath` 是「本机检测」自动绑定的（true）还是用户手选的（false）。 */
  esExePathAuto: boolean
}

/** S-151：launcher 面板的两种搜索模式。 */
type LauncherSearchMode = 'app' | 'file'

const CACHE_TTL_MS = 5 * 60 * 1000
const UWP_CACHE_TTL_MS = 24 * 60 * 60 * 1000
// v3: alpha-preserving icon extraction (v2 wrote black-background PNGs).
const UWP_CACHE_VERSION = 3

const DATA_DIR = resolveDataDir()
const CONFIG_FILE = join(DATA_DIR, 'launcher-config.json')
const UWP_CACHE_FILE = join(DATA_DIR, 'uwp-apps.json')
const UWP_ICON_DIR = join(DATA_DIR, 'uwp-icons')

const DEFAULT_CONFIG: LauncherConfig = {
  enabled: true,
  accelerators: ['Alt+Space'],
  customApps: [],
  launchHistory: [],
  searchMode: 'app',
  everythingExePath: '',
  everythingExePathAuto: false,
  esExePath: '',
  esExePathAuto: false
}

// ── Config persistence ──

function loadConfig(): LauncherConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      // Migrate old single accelerator to array
      let accelerators = DEFAULT_CONFIG.accelerators
      if (Array.isArray(parsed.accelerators)) {
        accelerators = parsed.accelerators.filter((value: unknown): value is string => typeof value === 'string')
        accelerators = accelerators.filter((value, index) => accelerators.indexOf(value) === index)
      } else if (typeof parsed.accelerator === 'string') {
        accelerators = [parsed.accelerator]
      }
      return {
        enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
        accelerators: accelerators.length > 0 ? accelerators : DEFAULT_CONFIG.accelerators,
        customApps: Array.isArray(parsed.customApps) ? parsed.customApps : [],
        launchHistory: Array.isArray(parsed.launchHistory) ? parsed.launchHistory : [],
        // Anything other than an explicit 'file' falls back to 'app' — a hand-edited
        // config must never leave the launcher in a mode it cannot render.
        searchMode: parsed.searchMode === 'file' ? 'file' : 'app',
        everythingExePath:
          typeof parsed.everythingExePath === 'string' ? parsed.everythingExePath : DEFAULT_CONFIG.everythingExePath,
        everythingExePathAuto: parsed.everythingExePathAuto === true,
        esExePath: typeof parsed.esExePath === 'string' ? parsed.esExePath : DEFAULT_CONFIG.esExePath,
        esExePathAuto: parsed.esExePathAuto === true
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

// ── Shortcut registration ──

const registeredIds: string[] = []

function unregisterShortcut(): void {
  for (const id of registeredIds) {
    unregisterPriorityShortcut(id)
  }
  registeredIds.length = 0
}

function registerShortcut(): boolean {
  unregisterShortcut()
  if (!config.enabled) return false
  let allOk = true
  for (let i = 0; i < config.accelerators.length; i++) {
    const id = `quick-launcher-${i}`
    const ok = registerPriorityShortcut(id, config.accelerators[i], (context) => {
      createLauncherWindow(context)
    })
    registeredIds.push(id)
    if (!ok) allOk = false
  }
  return allOk
}

// ── App scanning ──

// Folder names skipped when recursing the Start Menu (SDK/doc noise, not
// launchable apps). Borrowed from ZTools scanner.
const SKIP_FOLDERS = ['sdk', 'doc', 'docs', 'samples', 'sample', 'examples', 'example', 'demos', 'demo', 'documentation']

// Entry names that are auxiliary rather than launchable apps (uninstallers,
// help/readme/license links). Borrowed from ZTools scanner.
const SKIP_NAME_PATTERN = /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i

/** Scan Windows Start Menu directories for .lnk shortcut files. */
function scanStartMenuApps(): AppShortcut[] {
  const homeDir = app.getPath('home')
  const programs = [
    join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
  ]
  // Desktop shortcuts are a common launch source too; scan them flat (no
  // recursion into folders placed on the desktop).
  const desktops = [app.getPath('desktop'), 'C:\\Users\\Public\\Desktop']

  const shortcuts: AppShortcut[] = []
  const seen = new Set<string>()

  for (const dir of programs) {
    if (!fs.existsSync(dir)) continue
    walkLnkFiles(dir, shortcuts, seen, true)
  }
  for (const dir of desktops) {
    if (!fs.existsSync(dir)) continue
    walkLnkFiles(dir, shortcuts, seen, false)
  }

  shortcuts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // Pre-compute pinyin for Chinese names
  for (const s of shortcuts) {
    if (/[\u4e00-\u9fff]/.test(s.name)) {
      const full = pinyin(s.name, { toneType: 'none', type: 'array' }).join('')
      const initials = pinyin(s.name, { toneType: 'none', pattern: 'first', type: 'array' }).join('')
      s.pinyinFull = full
      s.pinyinInitials = initials
    }
  }

  return shortcuts
}

function walkLnkFiles(dir: string, results: AppShortcut[], seen: Set<string>, recursive: boolean): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!recursive) continue
      if (SKIP_FOLDERS.includes(entry.name.toLowerCase())) continue
      walkLnkFiles(fullPath, results, seen, recursive)
    } else if (entry.name.toLowerCase().endsWith('.lnk')) {
      const name = entry.name.replace(/\.lnk$/i, '')
      if (SKIP_NAME_PATTERN.test(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ name, path: fullPath })
    }
  }
}

/** Resolve the real target of an entry (.lnk → its target exe) as a dedupe key. */
function resolveTargetKey(path: string): string {
  if (path.toLowerCase().endsWith('.lnk')) {
    try {
      const details = shell.readShortcutLink(path)
      if (details.target) return details.target.toLowerCase()
    } catch {
      // fall through to the .lnk path itself
    }
  }
  return path.toLowerCase()
}

function isAppsFolderPath(path: string): boolean {
  return path.toLowerCase().startsWith('shell:appsfolder')
}

/** Marker prefix for system settings/tools entries (not file paths). */
const SYS_CMD_PREFIX = 'syscmd:'

/** spawn with an error listener — without one, ENOENT etc. throw uncaught. */
function spawnHidden(command: string, args: string[]): void {
  const child = spawn(command, args, { windowsHide: true })
  child.on('error', (err) => {
    console.warn(`[QuickLauncher] Failed to spawn ${command}: ${err.message}`)
  })
}

function isSystemCommandPath(path: string): boolean {
  return path.startsWith(SYS_CMD_PREFIX)
}

/** Launch a system settings/tools command (ms-settings URI, exe, .cpl/.msc
 * or rundll32-style command line). */
function launchSystemCommand(command: string): void {
  if (command.startsWith('ms-settings')) {
    void shell.openExternal(command)
    return
  }
  if (command.toLowerCase().startsWith('shell:')) {
    spawnHidden('explorer.exe', [command])
    return
  }
  const space = command.indexOf(' ')
  if (space > 0) {
    // Command line with arguments (rundll32 sysdm.cpl,..., control.exe keyboard)
    spawnHidden(command.slice(0, space), [command.slice(space + 1)])
    return
  }
  const lower = command.toLowerCase()
  if (lower.endsWith('.msc')) {
    spawnHidden('mmc.exe', [command])
    return
  }
  if (lower.endsWith('.cpl')) {
    spawnHidden('control.exe', [command])
    return
  }
  shell.openPath(command)
}

// ── UWP / built-in Windows apps (便签 etc. have no .lnk in Start Menu) ──

let uwpScanRunning = false

/** Parse the PowerShell scanner output into a cache file. */
function writeUwpCache(apps: UwpApp[]): void {
  const payload: UwpCacheFile = { version: UWP_CACHE_VERSION, time: Date.now(), apps }
  try {
    fs.writeFileSync(UWP_CACHE_FILE, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  } catch {
    // ignore
  }
}

/** Decode + parse the PowerShell scanner output into app entries. */
function parseUwpOutput(stdout: Buffer): UwpApp[] {
  // Encoding varies with the console code page (observed: UTF-8 on some
  // hosts, GBK on zh-CN). Decode as UTF-8 first and fall back to GBK when
  // replacement chars appear.
  let text = stdout.toString('utf8')
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(stdout)
    } catch {
      // keep the utf8 attempt
    }
  }
  const apps: UwpApp[] = []
  for (const line of text.split('\r\n')) {
    const first = line.indexOf(' ::: ')
    if (first <= 0) continue
    const name = line.slice(0, first).trim()
    const tail = line.slice(first + 5)
    // Format: name ::: appId [ ::: iconPath ]
    const second = tail.indexOf(' ::: ')
    const appId = (second >= 0 ? tail.slice(0, second) : tail).trim()
    const iconPath = second >= 0 ? tail.slice(second + 5).trim() : ''
    if (!name || !appId) continue
    // Same noise filter as Start Menu .lnk scanning — AppsFolder also lists
    // uninstallers/readme shortcuts (e.g. 卸载阿里云盘), keep them out.
    if (SKIP_NAME_PATTERN.test(name)) continue
    if (iconPath) apps.push({ name, appId, iconPath })
    else apps.push({ name, appId })
  }
  return apps
}

/**
 * Inline C# compiled by the PowerShell scanner: resolves an AppsFolder item
 * (SHParseDisplayName → IShellItem) and renders its icon via
 * IShellItemImageFactory into a PNG on disk. This is the same Windows API
 * route ZTools uses in its native addon — shell: pseudo-paths cannot be read
 * by app.getFileIcon, so icons are extracted at scan time instead.
 *
 * Alpha caveat: Bitmap.FromHbitmap silently drops the alpha channel of the
 * 32bpp premultiplied HBITMAP GetImage returns, painting transparency black.
 * We therefore copy the raw BGRA bits manually (bottom-up DIB → top-down).
 * No apostrophes allowed: the code is embedded in a PS single-quoted literal.
 */
const SHELL_ICON_EXTRACTOR_CS = [
  'using System;',
  'using System.Drawing;',
  'using System.Drawing.Imaging;',
  'using System.Runtime.InteropServices;',
  'public static class ShellIconExtractor {',
  '  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }',
  '  [StructLayout(LayoutKind.Sequential)] public struct BITMAP {',
  '    public int bmType; public int bmWidth; public int bmHeight;',
  '    public int bmWidthBytes; public short bmPlanes; public short bmBitsPixel; public IntPtr bmBits;',
  '  }',
  '  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  public interface IShellItem {',
  '    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);',
  '    void GetParent(out IntPtr ppsi);',
  '    void GetDisplayName(uint sigdnName, out IntPtr ppszName);',
  '    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);',
  '    void Compare(IntPtr psi, uint hint, out int piOrder);',
  '  }',
  '  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  public interface IShellItemImageFactory {',
  '    void GetImage(SIZE size, uint flags, out IntPtr phbm);',
  '  }',
  '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
  '  static extern int SHParseDisplayName(string pszName, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);',
  '  [DllImport("shell32.dll")] static extern int SHCreateItemFromIDList(IntPtr pidl, ref Guid riid, out IShellItem ppv);',
  '  [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr pv);',
  '  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);',
  '  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int c, ref BITMAP bm);',
  '  [DllImport("gdi32.dll")] static extern int GetBitmapBits(IntPtr hbm, int cb, byte[] pv);',
  '  public static string Extract(string parseName, string outPath) {',
  '    IntPtr pidl; uint attrs;',
  '    if (SHParseDisplayName(parseName, IntPtr.Zero, out pidl, 0, out attrs) != 0 || pidl == IntPtr.Zero) return "";',
  '    try {',
  '      Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");',
  '      IShellItem item;',
  '      if (SHCreateItemFromIDList(pidl, ref iid, out item) != 0) return "";',
  '      IShellItemImageFactory factory = (IShellItemImageFactory)item;',
  '      SIZE size = new SIZE(); size.cx = 48; size.cy = 48;',
  '      IntPtr hbm;',
  '      factory.GetImage(size, 0, out hbm);',
  '      if (hbm == IntPtr.Zero) return "";',
  '      Bitmap bmp;',
  '      BITMAP info = new BITMAP();',
  '      GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref info);',
  '      if (info.bmBitsPixel == 32) {',
  '        int w = info.bmWidth, h = info.bmHeight;',
  '        int stride = ((w * 32 + 31) / 32) * 4;',
  '        byte[] raw = new byte[stride * h];',
  '        GetBitmapBits(hbm, raw.Length, raw);',
  '        bool hasAlpha = false;',
  '        for (int i = 3; i < raw.Length; i += 4) { if (raw[i] != 0 && raw[i] != 255) { hasAlpha = true; break; } }',
  // Some icons come back with a zeroed alpha plane — treat those as opaque
  // instead of fully transparent.
  '        if (!hasAlpha) { for (int i = 3; i < raw.Length; i += 4) raw[i] = 255; }',
  '        bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);',
  '        BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);',
  '        byte[] dst = new byte[data.Stride * h];',
  '        for (int y = 0; y < h; y++) {',
  '          int srcOff = (h - 1 - y) * stride;',
  '          int dstOff = y * data.Stride;',
  '          for (int x = 0; x < w * 4; x += 4) {',
  '            dst[dstOff + x] = raw[srcOff + x];',
  '            dst[dstOff + x + 1] = raw[srcOff + x + 1];',
  '            dst[dstOff + x + 2] = raw[srcOff + x + 2];',
  '            dst[dstOff + x + 3] = raw[srcOff + x + 3];',
  '          }',
  '        }',
  '        Marshal.Copy(dst, 0, data.Scan0, dst.Length);',
  '        bmp.UnlockBits(data);',
  '      } else {',
  '        bmp = Bitmap.FromHbitmap(hbm);',
  '      }',
  '      DeleteObject(hbm);',
  '      using (bmp) { bmp.Save(outPath, ImageFormat.Png); }',
  '      return outPath;',
  '    } catch { return ""; } finally { CoTaskMemFree(pidl); }',
  '  }',
  '}'
].join(' ')

/** Enumerate AppsFolder entries (UWP + registered desktop apps) via the shell
 * namespace. Column 0 holds the AppUserModelId/parse name, column 1 the
 * display name (column 2 is empty on this OS). Runs async — a synchronous
 * spawn would freeze the main process (and focus) for the whole scan. */
function scanUwpAppsAsync(): void {
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    `$iconDir='${UWP_ICON_DIR}';`,
    'New-Item -ItemType Directory -Force -Path $iconDir | Out-Null;',
    `$cs='${SHELL_ICON_EXTRACTOR_CS}';`,
    "Add-Type -TypeDefinition $cs -ReferencedAssemblies 'System.Drawing';",
    '$shell=New-Object -ComObject Shell.Application;',
    "$folder=$shell.NameSpace('shell:AppsFolder');",
    'foreach($item in $folder.Items()){',
    '  $id=$folder.GetDetailsOf($item,0);',
    '  $name=$folder.GetDetailsOf($item,1);',
    "  if($id -and $name -and $id -notlike 'http*'){",
    "    $icon='';",
    // Path-like ids are plain executables — their icon resolves via
    // app.getFileIcon, no extraction needed.
    "    if($id -notmatch '^[A-Za-z]:\\\\'){",
    "      $safe=$id -replace '[^A-Za-z0-9._-]','_';",
    "      $icon=[ShellIconExtractor]::Extract(('shell:AppsFolder\\'+$id),(Join-Path $iconDir ($safe+'.png')))",
    '    }',
    "    Write-Output ($name + ' ::: ' + $id + ' ::: ' + $icon)",
    '  }',
    '}'
  ].join(' ')
  // windowsHide: a visible console window would steal focus from whatever
  // the user was doing when the background scan fires.
  const child = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true }
  )
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  // Icon extraction adds ~10-30ms per entry, so the scan can take 10s+.
  const watchdog = setTimeout(() => child.kill(), 60000)
  child.on('close', (code) => {
    clearTimeout(watchdog)
    try {
      if (code === 0) {
        writeUwpCache(parseUwpOutput(Buffer.concat(chunks)))
        // The merged list was built without the fresh entries — drop it so
        // the next search picks them up.
        appListCache = null
      }
    } finally {
      uwpScanRunning = false
    }
  })
  child.on('error', () => {
    clearTimeout(watchdog)
    uwpScanRunning = false
  })
}

function loadUwpApps(): UwpApp[] {
  let apps: UwpApp[] = []
  let age = Infinity
  try {
    if (fs.existsSync(UWP_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(UWP_CACHE_FILE, 'utf8')) as UwpCacheFile
      if (Array.isArray(parsed.apps)) {
        // Old-format caches (no icons / no version field) must rescan.
        if (parsed.version !== UWP_CACHE_VERSION) {
          age = Infinity
        } else {
          apps = parsed.apps
          age = Date.now() - (parsed.time ?? 0)
        }
      }
    }
  } catch {
    // fall through to refresh
  }
  if ((age >= UWP_CACHE_TTL_MS || apps.length === 0) && !uwpScanRunning) {
    // Slow (spawns PowerShell), so refresh in the background and serve the
    // previous cache for this round.
    uwpScanRunning = true
    setImmediate(() => scanUwpAppsAsync())
  }
  // Noise entries may already sit in a cache written before the filter
  // existed — apply the same SKIP_NAME_PATTERN on read so they disappear
  // immediately without waiting for a rescan.
  return apps.filter((a) => !SKIP_NAME_PATTERN.test(a.name))
}

function getOrRefreshAppList(): AppShortcut[] {
  const now = Date.now()
  if (appListCache && now - cacheTime < CACHE_TTL_MS) {
    return appListCache
  }

  const historyEntries: AppShortcut[] = []
  const rest: AppShortcut[] = []
  const seenNames = new Set<string>()
  const seenTargets = new Set<string>()

  // Push into the given bucket with name + real-target dedupe. History entries
  // go first so the same app registered elsewhere (different display name but
  // same .lnk target) keeps its history slot and priority.
  const push = (bucket: AppShortcut[], entry: AppShortcut, isHistory: boolean): void => {
    const nameKey = entry.name.toLowerCase()
    if (seenNames.has(nameKey)) return
    const targetKey = resolveTargetKey(entry.path)
    if (seenTargets.has(targetKey)) return
    seenNames.add(nameKey)
    seenTargets.add(targetKey)
    bucket.push({ ...entry, isHistory })
  }

  // 1) Launch history first (user-launched apps should lead search results)
  for (const hist of config.launchHistory) {
    if (fs.existsSync(hist.path) || isAppsFolderPath(hist.path) || isSystemCommandPath(hist.path)) {
      push(historyEntries, { name: hist.name, path: hist.path }, true)
    }
  }

  // 2) Custom apps
  for (const custom of config.customApps) {
    if (fs.existsSync(custom.path)) {
      push(rest, { name: custom.name, path: custom.path }, false)
    }
  }

  // 3) Start Menu .lnk shortcuts
  for (const shortcut of scanStartMenuApps()) {
    push(rest, shortcut, false)
  }

  // 4) AppsFolder entries (UWP + registered desktop apps; 便签 etc. have no
  // .lnk in Start Menu). Path-like ids are plain executables — keep the raw
  // path so they dedupe against Start Menu .lnk targets.
  const uwpApps = loadUwpApps()
  const uwpIconByPath = new Map<string, string>()
  for (const uwp of uwpApps) {
    const path = /^[a-z]:\\/i.test(uwp.appId) ? uwp.appId : `shell:AppsFolder\\${uwp.appId}`
    if (uwp.iconPath) uwpIconByPath.set(path, uwp.iconPath)
    push(rest, { name: uwp.name, path, iconFile: uwp.iconPath }, false)
  }

  // 5) Windows system settings & tools (ported from ZTools)
  for (const setting of WINDOWS_SETTINGS) {
    const entry: AppShortcut = { name: setting.name, path: SYS_CMD_PREFIX + setting.command, isSystem: true }
    push(rest, entry, false)
  }

  // Pre-compute matching variants (initials / compact form for all entries,
  // pinyin only for Chinese names). History entries pointing at an AppsFolder
  // app inherit the icon extracted during the UWP scan.
  for (const s of [...historyEntries, ...rest]) {
    if (!s.iconFile) {
      const iconFile = uwpIconByPath.get(s.path)
      if (iconFile) s.iconFile = iconFile
    }
    if (!s.initials) s.initials = computeInitials(s.name)
    if (!s.compact) s.compact = s.name.replace(/[\s\-_.]+/g, '').toLowerCase()
    if (!s.pinyinFull && /[\u4e00-\u9fff]/.test(s.name)) {
      s.pinyinFull = pinyin(s.name, { toneType: 'none', type: 'array' }).join('')
      s.pinyinInitials = pinyin(s.name, { toneType: 'none', pattern: 'first', type: 'array' }).join('')
    }
  }

  rest.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  appListCache = [...historyEntries, ...rest]
  cacheTime = now
  return appListCache
}

async function withIcon(appShortcut: AppShortcut): Promise<AppShortcut> {
  if (iconCache.has(appShortcut.path)) {
    return { ...appShortcut, iconDataUrl: iconCache.get(appShortcut.path) ?? undefined }
  }

  try {
    // Pre-extracted icon PNG (AppsFolder entries): read the image content
    // directly — app.getFileIcon only extracts the *associated* icon of a
    // file, which for a .png is the generic image-file icon, not the bitmap.
    let pngPath: string | undefined
    if (appShortcut.iconFile && fs.existsSync(appShortcut.iconFile)) {
      pngPath = appShortcut.iconFile
    } else if (isAppsFolderPath(appShortcut.path)) {
      // History entries may not carry iconFile — look it up in the UWP cache.
      pngPath = loadUwpApps().find(
        (u) =>
          u.iconPath &&
          !/^[a-z]:\\/i.test(u.appId) &&
          `shell:AppsFolder\\${u.appId}` === appShortcut.path &&
          fs.existsSync(u.iconPath)
      )?.iconPath
    }
    if (pngPath) {
      const dataUrl = `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`
      iconCache.set(appShortcut.path, dataUrl)
      return { ...appShortcut, iconDataUrl: dataUrl }
    }

    let iconSource = appShortcut.path
    if (appShortcut.path.toLowerCase().endsWith('.lnk')) {
      // For .lnk files, resolve the target EXE and extract its icon for better quality
      try {
        const details = shell.readShortcutLink(appShortcut.path)
        if (details.target && fs.existsSync(details.target)) {
          iconSource = details.target
        }
      } catch {
        // Fall back to the .lnk itself
      }
    }

    // Electron's getFileIcon (IImageList::GetIcon) cannot render PNG-compressed
    // icon entries — every electron-builder exe (all Electron apps) hits this
    // and gets the generic default icon. Parse the PE resource section first
    // and fall back to getFileIcon for everything else.
    if (/\.exe$/i.test(iconSource)) {
      const peIcon = extractPeIcon(iconSource)
      if (peIcon) {
        iconCache.set(appShortcut.path, peIcon)
        return { ...appShortcut, iconDataUrl: peIcon }
      }
    }

    const icon = await app.getFileIcon(iconSource, { size: 'normal' })
    const iconDataUrl = icon.isEmpty() ? null : icon.toDataURL()
    iconCache.set(appShortcut.path, iconDataUrl)
    return { ...appShortcut, iconDataUrl: iconDataUrl ?? undefined }
  } catch {
    iconCache.set(appShortcut.path, null)
    return appShortcut
  }
}

/**
 * Word-initial / camelCase initials (utools-style): collect the character at
 * every word start — after a separator or at a camelCase boundary — lowercased.
 * e.g. "Wishful Claw" / "wishfulClaw" / "WeChat" → "wc".
 */
function computeInitials(name: string): string {
  let initials = ''
  let prev = ' '
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]
    const isBoundary =
      i === 0 ||
      prev === ' ' || prev === '-' || prev === '_' || prev === '.' ||
      (/[a-z\u4e00-\u9fff]/.test(prev) && /[A-Z]/.test(ch))
    if (isBoundary) initials += ch
    prev = ch
  }
  return initials.toLowerCase()
}

interface ScoredApp {
  item: AppShortcut
  score: number
}

async function searchApps(query: string): Promise<AppShortcut[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) return []
  const apps = getOrRefreshAppList()

  const scored: ScoredApp[] = []
  for (const item of apps) {
    const name = item.name.toLowerCase()
    let score = -1
    if (name === normalizedQuery) {
      score = 100
    } else if (name.startsWith(normalizedQuery)) {
      score = 90
    } else if (item.pinyinFull && item.pinyinFull.toLowerCase().startsWith(normalizedQuery)) {
      score = 88
    } else if (item.pinyinInitials && item.pinyinInitials.toLowerCase().startsWith(normalizedQuery)) {
      score = 86
    } else if (item.initials === normalizedQuery || item.compact === normalizedQuery) {
      // Full initials/compact hit ("gc" === Google Chrome's initials) must beat
      // a substring landing somewhere mid-name.
      score = 85
    } else {
      const position = name.indexOf(normalizedQuery)
      if (position >= 0) {
        score = 80 - Math.min(position, 30)
      } else if (item.compact && item.compact.includes(normalizedQuery)) {
        score = 75
      } else if (item.initials && item.initials.includes(normalizedQuery)) {
        score = 70
      } else if (item.pinyinFull && item.pinyinFull.toLowerCase().includes(normalizedQuery)) {
        score = 60
      } else if (item.pinyinInitials && item.pinyinInitials.toLowerCase().includes(normalizedQuery)) {
        score = 58
      }
    }
    if (score < 0) continue
    // History entries always lead, then by match quality.
    if (item.isHistory) score += 1000
    scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return Promise.all(scored.slice(0, 50).map((entry) => withIcon(entry.item)))
}

// ── Everything 文件搜索（S-151）──
//
// 口径（老大 2026-09-28）：「判断 Everything 装了没，如果不存在引导用户去下载，如果存在，把搜索的值
// 发给 Everything 并且启动它。剩下的就跟我们没关系了，带参数启动」。
//
// ⇒ 我们**不接搜索结果**，只把关键词投给 Everything，由它自己的窗口显示。探测优先级、参数形态、
//   「不碰第三方私有副本」的理由都在 `lib/everything-search.ts` 顶部写死了。

interface EverythingStatus {
  /** 平台是否支持（本需求只做 Windows）。 */
  supported: boolean
  /** 探到了可用的 Everything.exe。 */
  ready: boolean
  exePath: string | null
  source: EverythingExeSource | null
  /** exePath 是「本机检测」自动绑定的 —— 设置页文案要跟「手动指定」分开，不然用户看着莫名其妙。 */
  detected: boolean
}

const EVERYTHING_NOT_READY: EverythingStatus = {
  supported: true,
  ready: false,
  exePath: null,
  source: null,
  detected: false
}

/** 轻探的缓存窗口。设置页反复切换不该每次都去查注册表。 */
const EVERYTHING_PROBE_TTL_MS = 30 * 1000
/** 重探（含扫盘）的缓存窗口：扫盘贵，绑上了别反复扫。 */
const EVERYTHING_DEEP_PROBE_TTL_MS = 5 * 60 * 1000
/** 扫盘的全局硬超时：到点就拿已找到的（通常是没有），不拖住面板。 */
const EVERYTHING_SCAN_TIMEOUT_MS = 2000
/** 快捷方式目录递归深度（`Start Menu\Programs\<厂商>\<应用>.lnk` 是 2 层）。 */
const EVERYTHING_SHORTCUT_MAX_DEPTH = 3
/** 等子进程给个说法的时间：超时按成功算（Everything 常驻实例收下参数后自己不会退出）。 */
const EVERYTHING_SPAWN_CONFIRM_MS = 1000

const EVERYTHING_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

/** 服务模式（`Everything.exe -svc`）注册的服务名，1.4 / 1.5 都是 `Everything`。 */
const EVERYTHING_SERVICE_NAME = 'Everything'

let everythingProbeCache: { at: number; status: EverythingStatus; deep: boolean } | null = null

function invalidateEverythingProbe(): void {
  everythingProbeCache = null
}

/**
 * 跑一条只读探测命令，失败一律当「没有输出」。
 *
 * `reg query` 在键不存在时返回非 0，那是正常情况而非错误 —— 所以这里不看退出码，只要 stdout。
 */
function runProbeCommand(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          resolve(error && !stdout ? '' : (stdout ?? ''))
        }
      )
    } catch {
      resolve('')
    }
  })
}

/** 拉一次 Windows PowerShell（`-Command` 里的引号是命令行字面量，不走 shell，无需再转义）。 */
function runPowerShell(command: string, timeout = 5000): Promise<string> {
  return runProbeCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], timeout)
}

/**
 * 注册表卸载项里的 Everything。
 *
 * 只认三项官方卸载键，**不去翻第三方私有副本**（uTools / WPS 内置的那几份，理由见模块头注释）。
 */
async function collectRegistryCandidates(): Promise<string[]> {
  const found: string[] = []
  for (const key of EVERYTHING_UNINSTALL_KEYS) {
    const stdout = await runProbeCommand('reg', ['query', key, '/s'])
    if (!stdout) continue
    for (const candidate of extractEverythingRegistryCandidates(parseRegistryUninstallBlocks(stdout))) {
      if (!found.includes(candidate)) found.push(candidate)
    }
  }
  return found
}

async function collectPathCandidates(): Promise<string[]> {
  const found: string[] = []
  // `where` 一次只按一个名字找，1.4 与 1.5 的两种命名都要问。
  for (const name of EVERYTHING_EXE_BASENAMES) {
    const stdout = await runProbeCommand('where', [name], 3000)
    for (const candidate of parseExecutablePathLines(stdout)) {
      if (!found.includes(candidate)) found.push(candidate)
    }
  }
  return found
}

/** 服务模式（`Everything.exe -svc`）的 ImagePath 就是本体路径。 */
async function collectServiceCandidates(): Promise<string[]> {
  const stdout = await runProbeCommand('sc', ['qc', EVERYTHING_SERVICE_NAME], 3000)
  return sanitizeEverythingCandidates([parseEverythingServiceImagePath(stdout)])
}

/**
 * 正在运行的 Everything 进程路径 —— 最准的一档（用户此刻就在用它）。
 *
 * 用 CIM 而不是 `Get-Process -Name 'Everything*'`：后者会把服务宿主 `EverythingService.exe` 也算
 * 进来，而 CIM 能按两个精确进程名过滤。实测含拉起 PowerShell 约 0.4s，所以只在便宜的档全空时才跑。
 */
async function collectProcessCandidates(): Promise<string[]> {
  const stdout = await runPowerShell(
    "Get-CimInstance Win32_Process -Filter \"Name='Everything.exe' OR Name='Everything64.exe'\" " +
      '| Select-Object -ExpandProperty ExecutablePath'
  )
  return sanitizeEverythingCandidates(parseExecutablePathLines(stdout))
}

/** 递归收 `.lnk` 文件（深度受限）。开始菜单目录上千个文件，readdirSync 足够快。 */
function listShortcutFiles(dir: string, maxDepth: number, depth = 0): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  const subdirs: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) files.push(join(dir, entry.name))
    else if (entry.isDirectory()) subdirs.push(join(dir, entry.name))
  }
  if (depth < maxDepth) {
    for (const sub of subdirs) files.push(...listShortcutFiles(sub, maxDepth, depth + 1))
  }
  return files
}

/**
 * 开始菜单 / 任务栏固定 / 桌面的 `.lnk` 指向哪 —— 便携版用户跑不掉这一档。
 *
 * 用 Electron 原生的 `shell.readShortcutLink()` 解析，比自己去解 Shell Link 二进制靠谱。
 */
function collectShortcutCandidates(): string[] {
  const appData = process.env['APPDATA'] ?? ''
  const programData = process.env['ProgramData'] ?? ''
  const userProfile = process.env['USERPROFILE'] ?? ''
  const publicDir = process.env['PUBLIC'] ?? ''

  const dirs = [
    appData ? join(appData, 'Microsoft', 'Windows', 'Start Menu') : '',
    programData ? join(programData, 'Microsoft', 'Windows', 'Start Menu') : '',
    appData
      ? join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
      : '',
    userProfile ? join(userProfile, 'Desktop') : '',
    publicDir ? join(publicDir, 'Desktop') : ''
  ].filter((dir) => dir.length > 0)

  const targets: string[] = []
  for (const dir of dirs) {
    for (const lnk of listShortcutFiles(dir, EVERYTHING_SHORTCUT_MAX_DEPTH)) {
      try {
        const target = shell.readShortcutLink(lnk).target
        if (target) targets.push(target)
      } catch {
        // 坏快捷方式 / 指向 MSI 广告入口 —— 跳过，不该让一条坏 lnk 打断整轮探测。
      }
    }
  }
  return sanitizeEverythingCandidates(targets)
}

/** 固定盘（`DriveType=3`）。可移动盘不扫 —— 老大 2026-09-28 定的。 */
async function listFixedDriveRoots(): Promise<string[]> {
  const stdout = await runPowerShell(
    'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID'
  )
  return (stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z]:$/.test(line))
    .map((root) => `${root}\\`)
}

/**
 * 盘根往下扫 `EVERYTHING_SCAN_MAX_DEPTH` 层，找到第一个就收手。
 *
 * 全局超时 `timeoutMs`：到点返回已找到的（通常是空），扫不完不拖住面板。实测根+两层
 * C: 0.84s / D: 0.09s，这个量级才敢让用户点。
 */
async function collectScanCandidates(
  timeoutMs: number,
  matchesName: (fileName: string) => boolean = isEverythingExecutableName,
  sanitize: (paths: readonly string[]) => string[] = sanitizeEverythingCandidates
): Promise<string[]> {
  const roots = await listFixedDriveRoots()
  const deadline = Date.now() + timeoutMs
  const found: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (found.length > 0 || Date.now() > deadline) return

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isFile() && matchesName(entry.name)) {
        found.push(join(dir, entry.name))
        return
      }
    }
    if (depth >= EVERYTHING_SCAN_MAX_DEPTH) return

    for (const entry of entries) {
      if (found.length > 0 || Date.now() > deadline) return
      if (!entry.isDirectory() || !shouldScanIntoDirectory(entry.name)) continue
      await walk(join(dir, entry.name), depth + 1)
    }
  }

  for (const root of roots) {
    if (found.length > 0 || Date.now() > deadline) break
    await walk(root, 0)
  }
  return sanitize(found)
}

/**
 * 「本机检测」搜出来的候选要过一道检测：文件的版本信息得说自己是 Everything。
 *
 * **只对猜出来的档（快捷方式 / 扫盘）做** —— 手动指定、注册表、服务、常见安装位都是强证据，
 * 再拦一道只是白等 0.4s。**读不到版本信息时放行**（fail-open）：老版本 / 精简 exe 可能不带
 * `ProductName`，不能因为查不出来就把真货丢掉。
 */
async function verifyDiscoveredCandidates(
  paths: string[],
  hit: (versionInfo: string) => boolean = isEverythingVersionInfoHit
): Promise<string[]> {
  const existing = (paths ?? []).filter((path) => fs.existsSync(path))
  if (existing.length === 0) return []

  const command = existing
    .map((path) => {
      const escaped = path.replace(/'/g, "''")
      return (
        `$info = (Get-Item -LiteralPath '${escaped}' -ErrorAction SilentlyContinue).VersionInfo; ` +
        `if ($info) { '${escaped}|' + $info.ProductName + '|' + $info.FileDescription }`
      )
    })
    .join('; ')

  const stdout = await runPowerShell(command)
  const verdicts = new Map<string, string>()
  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const separator = line.indexOf('|')
    if (separator <= 0) continue
    verdicts.set(line.slice(0, separator), line.slice(separator + 1))
  }

  return existing.filter((path) => hit(verdicts.get(path) ?? ''))
}

/**
 * 分级探测。
 *
 * 档位按**代价**分三批，便宜的先跑，命中就早返回 —— 挂载面板的常见路径（装在本机标准位置）
 * 不该为「扫盘 / 进程查询」白等一秒：
 *   ① 手动指定 → ② 注册表 / 常见安装位 / PATH → ③ 服务 / 正在运行的进程
 *   → ④ 快捷方式（要过版本检测）→ ⑤ 扫盘（**只有重探才跑**，同样过版本检测）
 */
async function probeEverything(deep: boolean): Promise<EverythingStatus> {
  if (process.platform !== 'win32') return { ...EVERYTHING_NOT_READY, supported: false }

  const toStatus = (match: EverythingExeMatch | null): EverythingStatus => ({
    supported: true,
    ready: match !== null,
    exePath: match?.path ?? null,
    source: match?.source ?? null,
    detected: match?.source === 'manual' && config.everythingExePathAuto
  })
  const exists = (candidate: string): boolean => fs.existsSync(candidate)

  // ① 手动指定（含「本机检测」自动绑定的）—— 用户自己的选择，直接认。
  const manual = (config.everythingExePath ?? '').trim()
  if (manual && exists(manual)) return toStatus({ path: manual, source: 'manual' })

  // ② 便宜且强的档。
  const [registry, fromPath] = await Promise.all([collectRegistryCandidates(), collectPathCandidates()])
  const cheap = pickEverythingExePath(
    { registry, 'program-files': getKnownInstallCandidates(process.env), path: fromPath },
    exists
  )
  if (cheap) return toStatus(cheap)

  // ③ 稍贵的强档。
  const [service, fromProcess] = await Promise.all([
    collectServiceCandidates(),
    collectProcessCandidates()
  ])
  const strong = pickEverythingExePath({ service, process: fromProcess }, exists)
  if (strong) return toStatus(strong)

  // ④ 猜出来的档：快捷方式。
  const shortcut = pickEverythingExePath(
    { shortcut: await verifyDiscoveredCandidates(collectShortcutCandidates()) },
    exists
  )
  if (shortcut) return toStatus(shortcut)

  if (!deep) return toStatus(null)

  // ⑤ 重探才有的扫盘。
  const scanned = pickEverythingExePath(
    { scan: await verifyDiscoveredCandidates(await collectScanCandidates(EVERYTHING_SCAN_TIMEOUT_MS)) },
    exists
  )
  return toStatus(scanned)
}

async function getEverythingStatus(deep = false): Promise<EverythingStatus> {
  const now = Date.now()
  const cached = everythingProbeCache
  if (cached && now - cached.at < (cached.deep ? EVERYTHING_DEEP_PROBE_TTL_MS : EVERYTHING_PROBE_TTL_MS)) {
    // 轻探的结果答不了重探（重探多扫一层盘），重探的结果可以答轻探。
    if (cached.deep || !deep) return cached.status
  }
  const status = await probeEverything(deep)
  everythingProbeCache = { at: now, status, deep }
  return status
}

/**
 * 把关键词投给 Everything 并放它出来。
 *
 * 成功 = 子进程没报错、且要么活着（新起了窗口）要么以 0 退出（参数交给了已在运行的实例，
 * Everything 自己会复用实例 —— 我们不加 `-new-window`）。失败就如实回给面板，不假装成功。
 */
function spawnEverythingSearch(
  exePath: string,
  keyword: string
): Promise<{ success: boolean; error?: string }> {
  const args = buildEverythingSearchArgs(keyword)
  if (!args) return Promise.resolve({ success: false, error: 'empty-query' })

  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (result: { success: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(exePath, args, { detached: true, stdio: 'ignore', windowsHide: false })
    } catch (error) {
      resolve({ success: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    timer = setTimeout(() => finish({ success: true }), EVERYTHING_SPAWN_CONFIRM_MS)
    child.once('error', (error) => finish({ success: false, error: error.message }))
    child.once('exit', (code) =>
      finish(code === 0 ? { success: true } : { success: false, error: `exit ${code ?? 'unknown'}` })
    )
    child.unref()
  })
}

// ── es.exe 取数（S-155）──
//
// S-151 的口径是「把关键词投给 Everything，剩下的跟我们没关系」；S-155 改成**我们取数、我们渲染**：
// 走官方命令行版 es.exe 把命中结果导成 JSON，解析成列表交给渲染端。
//
// 降级三档（渲染端按两个状态自己选）：
//   Everything✅ + es✅ → 自渲染结果列表
//   Everything✅ + es❌ → 退回 S-151 的投递式（`launcher:open-in-everything`）
//   Everything❌        → 保持引导页

interface EsStatus {
  /** 平台是否支持（本需求只做 Windows）。 */
  supported: boolean
  /** 探到了可用的 es.exe。 */
  ready: boolean
  exePath: string | null
  source: EsExeSource | null
  /** exePath 是「本机检测」自动绑定的 —— 设置页文案要跟「手动指定」分开。 */
  detected: boolean
}

const ES_NOT_READY: EsStatus = {
  supported: true,
  ready: false,
  exePath: null,
  source: null,
  detected: false
}

/** 轻探的缓存窗口。 */
const ES_PROBE_TTL_MS = 30 * 1000
/** 重探（含扫盘）的缓存窗口：扫盘贵，绑上了别反复扫。 */
const ES_DEEP_PROBE_TTL_MS = 5 * 60 * 1000
/** 取数落盘的临时 JSON —— 读完就删，不常驻（见 `runEsSearch`）。 */
const ES_OUT_FILENAME = 'es-search-out.json'

/**
 * Everything 未运行时的自动拉起（S-155 调整②）：起进程后**等 IPC 上线**的总预算与轮询间隔。
 *
 * 冷启动 Everything 要读索引，几百毫秒到两三秒是正常的；轮询直接拿用户那次搜索重试，不额外探测
 * （省一次无用查询，命中那一次的结果本身就是最终结果）。
 */
const EVERYTHING_AUTOSTART_WAIT_MS = 3000
const EVERYTHING_AUTOSTART_POLL_MS = 250

/**
 * 自动拉起的冷却窗口。
 *
 * 连打关键词会连着好几次搜索、每次都会看到 `not-running` —— 没有冷却就会一秒起一堆 Everything。
 * 窗口内只起一次，后面的搜索靠轮询等它上线。
 */
const EVERYTHING_AUTOSTART_COOLDOWN_MS = 10 * 1000

let esProbeCache: { at: number; status: EsStatus; deep: boolean } | null = null

/** 上次自动拉起 Everything 的时刻（0 = 从没起过），用于 `EVERYTHING_AUTOSTART_COOLDOWN_MS` 冷却。 */
let everythingAutostartAt = 0

function invalidateEsProbe(): void {
  esProbeCache = null
}

/** 去重 + 剔第三方私有副本 + 只留 `es.exe`（常见安装位 / 扫盘的输出都过这道）。 */
function sanitizeEsCandidates(paths: readonly string[]): string[] {
  const found: string[] = []
  for (const raw of paths ?? []) {
    const candidate = (raw ?? '').trim()
    if (!candidate) continue
    const base = candidate.split(/[\\/]/).pop() ?? ''
    if (!isEsExecutableName(base)) continue
    if (isThirdPartyPrivateEverythingPath(candidate)) continue
    if (!found.includes(candidate)) found.push(candidate)
  }
  return found
}

/** `where es.exe`。 */
async function collectEsPathCandidates(): Promise<string[]> {
  const stdout = await runProbeCommand('where', [ES_EXE_BASENAME], 3000)
  return sanitizeEsCandidates(parseEsPathLines(stdout))
}

/**
 * 内置 es.exe 的可能落点（S-155 调整①：不再引导用户去装 es.exe）。
 *
 * 三个 root 都算一遍、交给 `pickEsCandidate` 的 `exists` 筛 —— 不在这里判存在，省得两处判断漂移：
 *   - dev：`<repo>/resources/es/es.exe`（`process.cwd()` = 仓库根）；
 *   - 打包：`<resources>/es/es.exe`（electron-builder `extraResources` 的落点）；
 *   - 兜底：`<app>/resources/es/es.exe`（asar 外挂路径的另一种摆法）。
 *
 * process.resourcesPath 在 dev 下指向 `node_modules/electron/dist/resources`，所以 dev 命中的是
 * 第一条而不是它 —— 三条并列扫一遍，谁真存在算谁。
 */
function getEsBuiltinCandidates(): string[] {
  const roots = [
    join(process.cwd(), 'resources'),
    process.resourcesPath ?? '',
    join(app.getAppPath(), 'resources')
  ]
  const found: string[] = []
  for (const root of roots) {
    const candidate = getEsBuiltinPath(root)
    if (candidate && !found.includes(candidate)) found.push(candidate)
  }
  return found
}

/**
 * 分级探测 —— 档位按**代价**排：手动指定 → 内置件 → Everything 同目录 / 常见安装位 / PATH → 扫盘（仅重探）。
 *
 * 比 S-151 少四档（注册表 / 服务 / 快捷方式 / 进程）：es.exe 是**单文件**，不装、不跑、不当快捷
 * 方式目标，那四档没有对应物（理由写在 `lib/es-search.ts` 的 `EsExeSource` 上）。
 */
async function probeEs(deep: boolean): Promise<EsStatus> {
  if (process.platform !== 'win32') return { ...ES_NOT_READY, supported: false }

  const toStatus = (match: EsExeMatch | null): EsStatus => ({
    supported: true,
    ready: match !== null,
    exePath: match?.path ?? null,
    source: match?.source ?? null,
    detected: match?.source === 'manual' && config.esExePathAuto
  })
  const exists = (candidate: string): boolean => fs.existsSync(candidate)

  // ① 手动指定（含「本机检测」自动绑定的）—— 用户自己的选择，直接认。
  const manual = (config.esExePath ?? '').trim()
  if (manual && exists(manual)) return toStatus({ path: manual, source: 'manual' })

  // ② 便宜档。内置件排最前（默认落点，零外部依赖）；「与 Everything 同目录」要拿本体的路径，
  //    先问一句本体（它有缓存，通常零成本）。内置路径不过 `sanitizeEsCandidates` —— 那是我们自己
  //    打包的确定落点，多一道「第三方私有路径」过滤反而可能误伤。
  const everything = await getEverythingStatus()
  const fromPath = await collectEsPathCandidates()
  const cheap = pickEsCandidate(
    {
      builtin: getEsBuiltinCandidates(),
      alongside: sanitizeEsCandidates(getEsAlongsideCandidates(everything.exePath)),
      'program-files': sanitizeEsCandidates(getEsKnownDirCandidates(process.env)),
      path: fromPath
    },
    exists
  )
  if (cheap) return toStatus(cheap)

  if (!deep) return toStatus(null)

  // ③ 扫盘（仅重探）。猜出来的必须过版本检测 —— 叫 es.exe 的杂鱼不少（它的版本信息就是 `es`）。
  const scanned = pickEsCandidate(
    {
      scan: await verifyDiscoveredCandidates(
        await collectScanCandidates(
          EVERYTHING_SCAN_TIMEOUT_MS,
          isEsExecutableName,
          sanitizeEsCandidates
        ),
        isEsVersionInfoHit
      )
    },
    exists
  )
  return toStatus(scanned)
}

async function getEsStatus(deep = false): Promise<EsStatus> {
  const now = Date.now()
  const cached = esProbeCache
  if (cached && now - cached.at < (cached.deep ? ES_DEEP_PROBE_TTL_MS : ES_PROBE_TTL_MS)) {
    // 轻探答不了重探（重探多扫一层盘），重探可以答轻探。
    if (cached.deep || !deep) return cached.status
  }
  const status = await probeEs(deep)
  esProbeCache = { at: now, status, deep }
  return status
}

/** 取数结果。`ok: true` + 空 `hits` = **成功但没搜到**（不是失败）。 */
interface EsSearchResult {
  ok: boolean
  hits: FileHit[]
  failure?: EsFailure
  error?: string
}

/**
 * 取数串行队列。
 *
 * 所有调用共用同一个输出文件，并发会互踩（A 写 B 读、B 删 A 写），最坏拿到别人关键词的结果。
 * 单次实测 ~130ms，串行完全够。队列吞掉前一个的异常，不让一次失败堵死后续查询。
 */
let esSearchQueue: Promise<unknown> = Promise.resolve()

function enqueueEsSearch<T>(task: () => Promise<T>): Promise<T> {
  const next = esSearchQueue.then(task, task)
  esSearchQueue = next.catch(() => undefined)
  return next
}

function resolveEsOutFile(): string {
  return join(resolveDataDir(), ES_OUT_FILENAME)
}

/**
 * 跑一次 es.exe 取数。
 *
 * 三个实测踩坑点（原文在 `lib/es-search.ts` 头注，这里是对应的处理）：
 *   - 输出文件**先删**：es.exe 失败时照样会建它（实测 exit 8 也建），不删会把上一轮的陈旧结果
 *     当成这次的结果；
 *   - 失败分类**看退出码**（exit 8 = Everything 没在跑），不能只看文件在不在；
 *   - 空结果文件只有 3 字节 BOM，`parseEsJson` 已把它当空数组，不算错误。
 *
 * 临时文件**用完即删**，不常驻 —— 别在用户数据目录里留一堆没人清理的中间产物。
 */
async function runEsSearch(exePath: string, query: string): Promise<EsSearchResult> {
  const outFile = resolveEsOutFile()
  const args = buildEsArgs(query, outFile, ES_SEARCH_LIMIT)
  // 空关键词不启动进程，直接当「没搜到」。
  if (!args) return { ok: true, hits: [] }

  try {
    await fs.promises.rm(outFile, { force: true })
  } catch {
    // 删不掉就继续 —— 后面读不到内容会走 bad-output，不会静默错。
  }

  const outcome = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>(
    (resolve) => {
      try {
        execFile(
          exePath,
          args,
          {
            windowsHide: true,
            timeout: ES_PROCESS_TIMEOUT_MS,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            cwd: resolveDataDir()
          },
          (error, _stdout, stderr) => {
            resolve({
              code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
              stderr: typeof stderr === 'string' ? stderr : '',
              timedOut: Boolean(error && error.killed)
            })
          }
        )
      } catch (error) {
        resolve({
          code: null,
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false
        })
      }
    }
  )

  try {
    // 超时杀进程时 code 也是 null，但那是「跑了没在 2s 内回来」，不是「没起来」——
    // 归 search-failed，免得调用方白跑一轮重新探测。
    if (outcome.timedOut && outcome.code === null) {
      return { ok: false, hits: [], failure: 'search-failed', error: 'es.exe timed out' }
    }

    const failure = classifyEsFailure(outcome.code, outcome.stderr)
    if (failure) {
      return { ok: false, hits: [], failure, error: outcome.stderr.trim() || `exit ${outcome.code}` }
    }

    let raw = ''
    try {
      raw = await fs.promises.readFile(outFile, 'utf8')
    } catch {
      return { ok: false, hits: [], failure: 'bad-output', error: 'output file missing' }
    }

    try {
      return { ok: true, hits: parseEsJson(raw) }
    } catch (error) {
      return {
        ok: false,
        hits: [],
        failure: 'bad-output',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    try {
      await fs.promises.rm(outFile, { force: true })
    } catch {
      // 清理失败不该影响结果。
    }
  }
}

/** 等一会儿（`setTimeout` 的 Promise 版）。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Everything 没在跑 ⇒ 替他拉起来，再重试这次搜索（S-155 调整②）。
 *
 * 老大 2026-09-29 的口径：用户装了 Everything 却没开机自启 / 没手动开，不该让他自己去开 ——
 * 我们替他起。步骤：
 *   ① 问一句本体路径（走缓存）；**没探到就如实回 `not-running`** —— 那是「压根没装」，
 *      交给 UI 走「下载并安装」引导，我们不越权去装东西；
 *   ② `spawn <Everything.exe> -startup`：`-startup` 是官方的「静默启动」开关（已在跑则什么都不做），
 *      detached + 不挂窗口，别弹个主窗口糊用户一脸。冷却窗口内只起一次；
 *   ③ 轮询重试**用户这次搜索本身**，直到失败分类不再是 `not-running`（IPC 上线了）或超预算。
 *
 * 边界（写进 S-155.md 待实测项）：Everything 若配置成需要提权才能索引，这一步会弹 UAC —— 用户
 * 允许即正常；不允许则重试到超时，如实回 `not-running`。
 */
async function startEverythingAndRetry(
  esExePath: string,
  keyword: string,
  firstResult: EsSearchResult
): Promise<EsSearchResult> {
  const everything = await getEverythingStatus()
  const everythingExe = (everything.exePath ?? '').trim()
  if (!everything.ready || !everythingExe) return firstResult

  const now = Date.now()
  if (now - everythingAutostartAt > EVERYTHING_AUTOSTART_COOLDOWN_MS) {
    everythingAutostartAt = now
    try {
      const child = spawn(everythingExe, ['-startup'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.on('error', (error) =>
        console.warn(`[QuickLauncher] Failed to start Everything: ${error.message}`)
      )
      child.unref()
    } catch (error) {
      console.warn(`[QuickLauncher] Failed to start Everything: ${String(error)}`)
    }
  }

  const deadline = now + EVERYTHING_AUTOSTART_WAIT_MS
  let result = firstResult
  while (result.failure === 'not-running' && Date.now() < deadline) {
    await delay(EVERYTHING_AUTOSTART_POLL_MS)
    result = await enqueueEsSearch(() => runEsSearch(esExePath, keyword))
  }
  return result
}

// ── IPC ──

let ipcRegistered = false

function registerLauncherIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  registerMessagePackHandler<string, AppShortcut[]>('launcher:search', (query) => searchApps(query))

  registerMessagePackHandler<void, AppShortcut[]>('launcher:get-recent', async () => {
    if (config.launchHistory.length === 0) return []
    const recent = config.launchHistory.slice(0, 8)
    return Promise.all(recent.map(async (entry) => withIcon({ name: entry.name, path: entry.path })))
  })

  registerMessagePackHandler<string, boolean>('launcher:launch', async (appPath) => {
    let launchError = ''
    if (isSystemCommandPath(appPath)) {
      launchSystemCommand(appPath.slice(SYS_CMD_PREFIX.length))
    } else if (isAppsFolderPath(appPath)) {
      // shell: pseudo-paths don't go through shell.openPath; explorer handles them.
      spawnHidden('explorer.exe', [appPath])
    } else {
      // shell.openPath resolves to '' on success, an error string otherwise —
      // checking it is the only way to notice a failed launch.
      launchError = await shell.openPath(appPath)
      if (launchError) {
        console.warn(`[QuickLauncher] Failed to launch ${appPath}: ${launchError}`)
      }
    }
    if (launchError) {
      // Don't record failed launches in history and keep the panel open so
      // the user can retry instead of believing the launch succeeded.
      return false
    }
    // Record launch history
    const apps = getOrRefreshAppList()
    const launched = apps.find((a) => a.path === appPath)
    if (launched) {
      const entry: CustomApp = { name: launched.name, path: launched.path }
      config.launchHistory = config.launchHistory.filter((h) => h.path !== appPath)
      config.launchHistory.unshift(entry)
      if (config.launchHistory.length > 30) config.launchHistory = config.launchHistory.slice(0, 30)
      saveConfig()
      // History ordering changed — rebuild the merged list on next search.
      appListCache = null
    }
    hideLauncherWindow()
    return true
  })

  registerMessagePackHandler<void, { canceled: boolean; path?: string; name?: string }>('launcher:pick-exe', async () => {
    // launcherWindow may have been destroyed between the click and the dialog;
    // fall back to a parentless dialog instead of asserting.
    const options: Electron.OpenDialogOptions = {
      title: '选择应用程序',
      filters: [{ name: '应用程序', extensions: ['exe', 'bat', 'cmd'] }],
      properties: ['openFile']
    }
    const result = launcherWindow
      ? await dialog.showOpenDialog(launcherWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop()!.replace(/\.(exe|bat|cmd)$/i, '')
    return { canceled: false, path: filePath, name }
  })

  // ── Config IPC ──

  registerMessagePackHandler<void, LauncherConfig>('launcher:get-config', () => config)

  registerMessagePackHandler<void, void>('launcher:hide', () => {
    hideLauncherWindow()
  })

  registerMessagePackHandler<void, CustomApp[]>('launcher:get-custom-apps', () => config.customApps)

  registerMessagePackHandler<{ name: string; path: string }, CustomApp[]>('launcher:add-custom-app', (app) => {
    if (!app.name || !app.path) return config.customApps
    if (!fs.existsSync(app.path)) return config.customApps
    if (config.customApps.some((a) => a.path === app.path)) return config.customApps
    config.customApps.push({ name: app.name, path: app.path })
    saveConfig()
    appListCache = null
    return config.customApps
  })

  registerMessagePackHandler<string, CustomApp[]>('launcher:remove-custom-app', (appPath) => {
    config.customApps = config.customApps.filter((a) => a.path !== appPath)
    saveConfig()
    appListCache = null
    return config.customApps
  })

  registerMessagePackHandler<Partial<LauncherConfig>, LauncherConfig & { shortcutRegistered: boolean }>('launcher:update-config', (patch) => {
    const wasEnabled = config.enabled
    config = { ...config, ...patch }
    saveConfig()

    let shortcutRegistered = true
    if (patch.enabled !== undefined || patch.accelerators !== undefined) {
      if (!config.enabled) {
        unregisterShortcut()
      } else if (patch.accelerators !== undefined || !wasEnabled) {
        shortcutRegistered = registerShortcut()
      }
    }

    return { ...config, shortcutRegistered }
  })

  // ── Everything 文件搜索 IPC（S-151）──

  registerMessagePackHandler<void, EverythingStatus>('launcher:get-everything-status', () =>
    getEverythingStatus()
  )

  registerMessagePackHandler<void, EverythingStatus>('launcher:refresh-everything-status', () => {
    invalidateEverythingProbe()
    return getEverythingStatus()
  })

  registerMessagePackHandler<
    void,
    { canceled: boolean; status: EverythingStatus; error?: string }
  >('launcher:pick-everything-exe', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择 Everything 主程序',
      filters: [{ name: 'Everything', extensions: ['exe'] }],
      properties: ['openFile']
    }
    const result = launcherWindow
      ? await dialog.showOpenDialog(launcherWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, status: await getEverythingStatus() }
    }

    const filePath = result.filePaths[0]
    const fileName = filePath.split(/[\\/]/).pop() ?? ''
    // 选错文件（比如挑了 unins000.exe）就说清楚，不静默存进去让用户后面一脸问号。
    if (!isEverythingExecutableName(fileName)) {
      return {
        canceled: false,
        status: await getEverythingStatus(),
        error: 'not-everything-exe'
      }
    }

    config = { ...config, everythingExePath: filePath, everythingExePathAuto: false }
    saveConfig()
    invalidateEverythingProbe()
    return { canceled: false, status: await getEverythingStatus() }
  })

  registerMessagePackHandler<void, EverythingStatus>('launcher:clear-everything-exe', async () => {
    config = { ...config, everythingExePath: '', everythingExePathAuto: false }
    saveConfig()
    invalidateEverythingProbe()
    return getEverythingStatus()
  })

  /**
   * 「本机检测」（S-151 二轮）：跑一轮**重探**（含扫盘），检测到就**直接绑定**。
   *
   * 老大 2026-09-28 15:38 的口径：「如果用户本机没有，那么我们提供两个选项 1.去安装 2.本机检测，
   * 如果检测到直接给他绑定上，**而不是引导用户去绑定**」。
   *
   * 绑定写进 `everythingExePath`（与手动指定同一个槽位 —— 它本来就是最高优先级），但
   * `everythingExePathAuto = true`，设置页据此显示「本机检测」而不是「手动指定」。
   * 用户已经手选过路径时**不动它** —— 那是用户自己的判断，优先级更高。
   */
  registerMessagePackHandler<void, EverythingStatus>('launcher:detect-everything', async () => {
    invalidateEverythingProbe()
    const status = await getEverythingStatus(true)
    if (!status.ready || !status.exePath || config.everythingExePath.trim()) return status

    config = { ...config, everythingExePath: status.exePath, everythingExePathAuto: true }
    saveConfig()

    // 绑定后直接构造结果，不再重探一遍（重探要再扫一次盘 + 四个子进程，纯浪费）。
    const bound: EverythingStatus = { ...status, source: 'manual', detected: true }
    everythingProbeCache = { at: Date.now(), status: bound, deep: true }
    return bound
  })

  /**
   * 文件搜索（S-155 起**改语义**）：返回结构化结果给渲染端自己渲染。
   *
   * S-151 时代这个通道的返回值是「投没投出去」（`{ success, error }`），投完还会收面板；
   * 现在结果由我们自己渲染，面板**不能收**（收了用户就看不着结果了）。
   */
  registerMessagePackHandler<string, EsSearchResult>('launcher:search-files', async (keyword) => {
    const status = await getEsStatus()
    if (!status.ready || !status.exePath) {
      return { ok: false, hits: [], failure: 'spawn-failed', error: 'es-not-ready' }
    }

    const esExePath = status.exePath
    let result = await enqueueEsSearch(() => runEsSearch(esExePath, keyword))

    // es.exe 失效（用户删了 / 换了盘）⇒ 让下一轮探测重新找，别一直拿死路径报错。
    if (result.failure === 'spawn-failed') {
      invalidateEsProbe()
      return result
    }

    // Everything 没在跑 ⇒ 替他拉起来再重试（S-155 调整②），别让用户自己去找。
    if (result.failure === 'not-running') {
      result = await startEverythingAndRetry(esExePath, keyword, result)
    }
    return result
  })

  /**
   * 降级档：Everything 在、es.exe 不在 —— 退回 S-151 的投递式（关键词交给 Everything 自己的窗口）。
   *
   * 这是 **S-155 §七 裁定②** 的落点：有 Everything 却拿不到 es.exe 时，不能让用户什么都搜不了。
   */
  registerMessagePackHandler<string, { success: boolean; error?: string }>(
    'launcher:open-in-everything',
    async (keyword) => {
      const status = await getEverythingStatus()
      if (!status.ready || !status.exePath) return { success: false, error: 'not-ready' }

      const result = await spawnEverythingSearch(status.exePath, keyword)
      // 只有确实投出去了才收起面板，否则用户连报错都看不到（面板一关就没了）。
      if (result.success) hideLauncherWindow()
      return result
    }
  )

  /** 点结果项：`reveal` 时定位到所在目录，否则用系统默认程序打开它。 */
  registerMessagePackHandler<
    { path: string; reveal?: boolean },
    { success: boolean; error?: string }
  >('launcher:open-hit', async (payload) => {
    const target = (payload?.path ?? '').trim()
    if (!target) return { success: false, error: 'empty-path' }

    if (payload?.reveal) {
      shell.showItemInFolder(target)
      return { success: true }
    }

    const failed = await shell.openPath(target)
    // openPath 成功返回空串，失败返回错误描述 —— 不看返回值等于假装用户点开了。
    return failed ? { success: false, error: failed } : { success: true }
  })

  registerMessagePackHandler<void, EsStatus>('launcher:get-es-status', () => getEsStatus())

  registerMessagePackHandler<void, EsStatus>('launcher:refresh-es-status', async () => {
    invalidateEsProbe()
    return getEsStatus(true)
  })

  /**
   * 手动指定 es.exe。挑错文件就说清楚，不静默存进去让用户后面一脸问号。
   *
   * S-155 调整① 后这是**唯一的覆盖入口** —— es.exe 已内置，不再有「本机检测 / 获取 ES」两个通道。
   * 留着它只为一种场景：用户自己那份 es.exe 版本更新，想顶掉内置的。
   */
  registerMessagePackHandler<void, { canceled: boolean; status: EsStatus; error?: string }>(
    'launcher:set-es-exe',
    async () => {
      const options = {
        title: '选择 es.exe',
        properties: ['openFile' as const],
        filters: [{ name: 'es.exe', extensions: ['exe'] }]
      }
      const result = launcherWindow
        ? await dialog.showOpenDialog(launcherWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, status: await getEsStatus() }
      }

      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[\\/]/).pop() ?? ''
      if (!isEsExecutableName(fileName)) {
        return { canceled: false, status: await getEsStatus(), error: 'not-es-exe' }
      }

      config = { ...config, esExePath: filePath, esExePathAuto: false }
      saveConfig()
      invalidateEsProbe()
      return { canceled: false, status: await getEsStatus() }
    }
  )

  registerMessagePackHandler<void, EsStatus>('launcher:clear-es-exe', async () => {
    config = { ...config, esExePath: '', esExePathAuto: false }
    saveConfig()
    invalidateEsProbe()
    return getEsStatus()
  })

  registerMessagePackHandler<void, void>('launcher:open-everything-download', () => {
    // 固定 URL 写死在这里，不接受渲染端传任意地址。
    void shell.openExternal(EVERYTHING_DOWNLOAD_URL)
  })
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

function clearLauncherTimers(): void {
  clearLauncherBlurHideTimer()
  clearLauncherActivationTimer()
}

function hideLauncherWindow(): void {
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
  registerLauncherIpc()

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

// ── Init ──

export function registerQuickLauncher(): void {
  config = loadConfig()
  registerLauncherIpc()
  registerShortcut()

  app.on('will-quit', () => {
    clearLauncherTimers()
    unregisterShortcut()
  })
}
