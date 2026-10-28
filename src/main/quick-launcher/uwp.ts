/**
 * UWP / 内置 Windows 应用（便签之类在开始菜单里没有 .lnk）。
 *
 * S-249 从 `quick-launcher.ts` 搬出，整段原样平移。上下两个 PowerShell 扫描器都是同步 spawn 的替代品：
 * 同步跑会把主进程连同焦点一起冻住整个扫描期（见 `scanUwpAppsAsync` 注释）。
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import { UWP_CACHE_FILE, UWP_ICON_DIR } from './config'
import { UWP_CACHE_TTL_MS, UWP_CACHE_VERSION, SKIP_NAME_PATTERN } from './constants'
import { invalidateAppListCache } from './cache'
import type { UwpApp, UwpCacheFile } from './types'

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
    invalidateAppListCache()
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

export function loadUwpApps(): UwpApp[] {
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