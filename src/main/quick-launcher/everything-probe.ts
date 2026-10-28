/**
 * Everything 本体（GUI）的分级探测。
 *
 * S-249 从 `quick-launcher.ts` 搬出。档位、代价排序、缓存窗口、fail-open 判据全部原样平移；
 * 相对原文件只改了 `config.` → `getConfig().` 与几处 `export`。
 *
 * 口径（老大 2026-09-28）：「判断 Everything 装了没，如果不存在引导用户去下载，如果存在，把搜索的值
 * 发给 Everything 并且启动它。剩下的就跟我们没关系了，带参数启动」——探测优先级、参数形态、
 * 「不碰第三方私有副本」的理由都在 `lib/everything-search.ts` 顶部写死了。
 */

import { shell } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import * as fs from 'fs'
import {
  EVERYTHING_EXE_BASENAMES,
  EVERYTHING_SCAN_MAX_DEPTH,
  extractEverythingRegistryCandidates,
  getKnownInstallCandidates,
  isEverythingExecutableName,
  isEverythingVersionInfoHit,
  parseEverythingServiceImagePath,
  parseExecutablePathLines,
  parseRegistryUninstallBlocks,
  pickEverythingExePath,
  sanitizeEverythingCandidates,
  shouldScanIntoDirectory,
  type EverythingExeMatch
} from '../lib/everything-search'
import { getConfig } from './config'
import type { EverythingStatus } from './types'

// ── Everything 文件搜索（S-151）──
//
// 口径（老大 2026-09-28）：「判断 Everything 装了没，如果不存在引导用户去下载，如果存在，把搜索的值
// 发给 Everything 并且启动它。剩下的就跟我们没关系了，带参数启动」。
//
// ⇒ 我们**不接搜索结果**，只把关键词投给 Everything，由它自己的窗口显示。探测优先级、参数形态、
//   「不碰第三方私有副本」的理由都在 `lib/everything-search.ts` 顶部写死了。

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
export const EVERYTHING_SCAN_TIMEOUT_MS = 2000
/** 快捷方式目录递归深度（`Start Menu\Programs\<厂商>\<应用>.lnk` 是 2 层）。 */
const EVERYTHING_SHORTCUT_MAX_DEPTH = 3

const EVERYTHING_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

/** 服务模式（`Everything.exe -svc`）注册的服务名，1.4 / 1.5 都是 `Everything`。 */
const EVERYTHING_SERVICE_NAME = 'Everything'

let everythingProbeCache: { at: number; status: EverythingStatus; deep: boolean } | null = null

export function invalidateEverythingProbe(): void {
  everythingProbeCache = null
}

/**
 * 直接写探测缓存槽。
 *
 * 拆出来的唯一理由：IPC 的 `launcher:detect-everything` 在绑定成功后要把结果**塞回缓存**
 * 免得再扫一次盘。原文件里是同文件直接赋值，拆开后必须经访问器，调用处的字面量原样传进来。
 */
export function setEverythingProbeCache(value: {
  at: number
  status: EverythingStatus
  deep: boolean
}): void {
  everythingProbeCache = value
}

/**
 * 跑一条只读探测命令，失败一律当「没有输出」。
 *
 * `reg query` 在键不存在时返回非 0，那是正常情况而非错误 —— 所以这里不看退出码，只要 stdout。
 */
export function runProbeCommand(file: string, args: string[], timeout = 5000): Promise<string> {
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
export function runPowerShell(command: string, timeout = 5000): Promise<string> {
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
export async function collectScanCandidates(
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
export async function verifyDiscoveredCandidates(
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
export async function probeEverything(deep: boolean): Promise<EverythingStatus> {
  if (process.platform !== 'win32') return { ...EVERYTHING_NOT_READY, supported: false }

  const toStatus = (match: EverythingExeMatch | null): EverythingStatus => ({
    supported: true,
    ready: match !== null,
    exePath: match?.path ?? null,
    source: match?.source ?? null,
    detected: match?.source === 'manual' && getConfig().everythingExePathAuto
  })
  const exists = (candidate: string): boolean => fs.existsSync(candidate)

  // ① 手动指定（含「本机检测」自动绑定的）—— 用户自己的选择，直接认。
  const manual = (getConfig().everythingExePath ?? '').trim()
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

export async function getEverythingStatus(deep = false): Promise<EverythingStatus> {
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