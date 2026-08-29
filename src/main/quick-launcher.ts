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
import { spawn } from 'child_process'
import { join } from 'path'
import * as fs from 'fs'
import { pinyin } from 'pinyin-pro'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { registerPriorityShortcut, unregisterPriorityShortcut, forceActivateWindow, type ShortcutContext } from './priority-shortcuts'
import { getAuxiliaryWindowBounds } from './aux-window-screen'
import { safeSendMessagePackToWindow } from './window-ipc'
import { WINDOWS_SETTINGS } from './launcher-system-settings'
import { extractPeIcon } from './pe-icon-extractor'

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
}

const CACHE_TTL_MS = 5 * 60 * 1000
const UWP_CACHE_TTL_MS = 24 * 60 * 60 * 1000
// v3: alpha-preserving icon extraction (v2 wrote black-background PNGs).
const UWP_CACHE_VERSION = 3

const DATA_DIR = join(app.getPath('home'), '.wishful-claw')
const CONFIG_FILE = join(DATA_DIR, 'launcher-config.json')
const UWP_CACHE_FILE = join(DATA_DIR, 'uwp-apps.json')
const UWP_ICON_DIR = join(DATA_DIR, 'uwp-icons')

const DEFAULT_CONFIG: LauncherConfig = {
  enabled: true,
  accelerators: ['Alt+Space'],
  customApps: [],
  launchHistory: []
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
        launchHistory: Array.isArray(parsed.launchHistory) ? parsed.launchHistory : []
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
