/**
 * S-151 —— 快捷启动「文件搜索」的 Everything「接管式」逻辑（纯函数）。
 *
 * 老大 2026-09-28 定案：「我们判断 Everything 装了没，是否存在，如果不存在引导用户去下载，
 * 如果存在，我们把搜索的值发给 Everything 并且启动它。剩下的就跟我们没关系了，带参数启动」
 *
 * ⇒ 我们只做两件事：**探测用户自装的 Everything.exe** 与 **`-search` 带参启动**。
 *    - 搜索结果由 Everything 自己的窗口显示，我们不接、不列、不加工（所以没有结果规整层）；
 *    - 不带任何二进制、不建索引、不改用户 `Everything.ini`、不代拉起常驻进程；
 *    - 探不到 ⇒ 文件模式不可用，走引导（不是我们兜一个劣化遍历去糊）。
 *
 * 老二轮（老大 2026-09-28 15:38）：「如果用户本机没有，那么我们提供两个选项 1.去安装
 * 2.本机检测，如果检测到直接给他绑定上，**而不是引导用户去绑定**」。
 *
 * ⇒ 探测分两级（调用方选，见 `quick-launcher.ts` 的 `probeEverything`）：
 *    - **轻探**：注册表 / 服务 / 正在运行的进程 / 快捷方式 / 常见安装位 / PATH —— 亚秒级，
 *      挂载、切模式、开设置页时跑；
 *    - **重探**（= 轻探 + 扫盘）：只在用户点「本机检测」时跑，代价是秒级（实测根+两层：
 *      C: 0.84s / D: 0.09s），命中的路径**直接落盘绑定**，用户不用自己去找。
 *
 *    另：可移动盘（`DriveType != 3`）不扫 —— 老大 15:38 定的。
 *
 * 参数口径（官方 `command_line_options` 页核实）：`-search <text>` = *Set the search to the
 * specified text*，1.4 起即有；**写长名 `-search` 而不写 `-s`** —— `es.exe` 里 `-s` 是「按路径
 * 排序」，将来看代码容易串。实例复用（把参数投给已在运行的实例）由 Everything 自己做，我们
 * 不加 `-new-window` / `-config` / `-instance`。
 *
 * 探测优先级（`EVERYTHING_SOURCE_PRIORITY`）：手动指定 > 注册表卸载项 > 常见安装位 > PATH。
 * 手动指定排第一是硬要求 —— 便携版注册表里探不到，而那是主流用法。
 *
 * 本模块只做解析与判定，不碰文件系统、不开进程；存在性由调用方注入，便于回归套件钉死顺序。
 */

import { join } from 'path'

export type EverythingExeSource =
  | 'manual'
  | 'registry'
  | 'service'
  | 'process'
  | 'shortcut'
  | 'program-files'
  | 'path'
  | 'scan'

/** 官方两种可执行名：1.4 系 `Everything.exe`，1.5 系 `Everything64.exe`（存官方大小写，拼路径直接用）。 */
export const EVERYTHING_EXE_BASENAMES = ['Everything.exe', 'Everything64.exe'] as const

/**
 * 探测优先级，从高到低。改顺序只改这里。
 *
 * 手动指定排第一是硬要求 —— 用户自己点选的路径永远最优先。其后是官方安装痕迹（注册表卸载项 /
 * 服务 ImagePath），再是「用户此刻真的在用的那份」（正在运行的进程 / 快捷方式目标），最后才是
 * 猜测性的位置（常见安装位 / PATH / 扫盘命中）。
 */
export const EVERYTHING_SOURCE_PRIORITY: readonly EverythingExeSource[] = [
  'manual',
  'registry',
  'service',
  'process',
  'shortcut',
  'program-files',
  'path',
  'scan'
]

/** 引导里给的下载页（安装版）。 */
export const EVERYTHING_DOWNLOAD_URL = 'https://www.voidtools.com/downloads/'

export interface EverythingExeMatch {
  path: string
  source: EverythingExeSource
}

/** 文件名是不是 Everything 本体（大小写无关；只看 basename）。 */
export function isEverythingExecutableName(fileName: string): boolean {
  const base = fileName.trim().toLowerCase()
  return EVERYTHING_EXE_BASENAMES.some((name) => name.toLowerCase() === base)
}

/**
 * 规范化注册表里拿到的路径。
 *
 * `DisplayIcon` 常见形如 `C:\Program Files\Everything\Everything.exe,0`（尾巴是图标索引），
 * 也可能整体带引号 —— 两种都要剥掉。带引号时按引号切（路径本身可能含逗号），
 * 不带引号时才敢按逗号切。
 */
export function normalizeRegistryPath(raw: string): string {
  let value = (raw ?? '').trim()
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1)
    return end > 1 ? value.slice(1, end).trim() : value.trim()
  }
  const comma = value.indexOf(',')
  if (comma > 0) value = value.slice(0, comma)
  return value.trim()
}

export interface RegistryUninstallEntry {
  displayName: string
  displayIcon: string
  installLocation: string
}

/**
 * 切分 `reg query <Uninstall> /s` 的输出。
 *
 * 形如：
 *   HKEY_LOCAL_MACHINE\...\Uninstall\{GUID}
 *       DisplayName    REG_SZ    Everything
 *       DisplayIcon    REG_SZ    C:\Program Files\Everything\Everything.exe,0
 *
 * 以 `HKEY_` 开头的行切块（每块一条卸载项），块内的 `REG_SZ` / `REG_EXPAND_SZ` 行取三个字段。
 */
export function parseRegistryUninstallBlocks(stdout: string): RegistryUninstallEntry[] {
  const blocks: RegistryUninstallEntry[] = []
  let current: RegistryUninstallEntry | null = null

  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^HKEY_/i.test(line)) {
      current = { displayName: '', displayIcon: '', installLocation: '' }
      blocks.push(current)
      continue
    }
    if (!current) continue

    const matched = /^(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/i.exec(line)
    if (!matched) continue

    switch (matched[1].toLowerCase()) {
      case 'displayname':
        current.displayName = matched[2].trim()
        break
      case 'displayicon':
        current.displayIcon = matched[2].trim()
        break
      case 'installlocation':
        current.installLocation = matched[2].trim()
        break
      default:
        break
    }
  }

  return blocks
}

/**
 * 从卸载项里挑出 Everything 的可执行文件候选（去重、保序）。
 *
 * 只认 `DisplayName` 含 Everything 的条目 —— 否则会把同一把注册表里任意软件的自带 exe 抓进来。
 */
export function extractEverythingRegistryCandidates(blocks: RegistryUninstallEntry[]): string[] {
  const found: string[] = []

  const pushIfExecutable = (candidate: string): void => {
    const normalized = normalizeRegistryPath(candidate)
    if (!normalized) return
    const base = normalized.split(/[\\/]/).pop() ?? ''
    if (!isEverythingExecutableName(base)) return
    if (!found.includes(normalized)) found.push(normalized)
  }

  for (const block of blocks ?? []) {
    if (!/everything/i.test(block.displayName ?? '')) continue
    if (block.displayIcon) pushIfExecutable(block.displayIcon)
    if (block.installLocation) {
      // 装在哪不只一种命名，两个都试
      for (const name of EVERYTHING_EXE_BASENAMES) {
        pushIfExecutable(join(normalizeRegistryPath(block.installLocation), name))
      }
    }
  }

  return found
}

/**
 * 常见安装位的候选路径。
 *
 * 覆盖：标准安装（`%ProgramFiles%\Everything\`）、1.5 alpha（单独目录 `Everything 1.5a\`）、
 * **包管理器**（winget 的 `%LOCALAPPDATA%\Programs` 与 `WinGet\Links`、scoop 的 `apps\everything\current`
 * 与 `shims`、chocolatey 的 `bin`）—— 这三家都不写官方卸载键，而 `where` 只看得见 scoop / choco
 * 的 shim，所以目录得显式列出来，否则「明明装了却探不到」。
 *
 * 非 Windows 平台没有对应物 —— 直接空数组（本需求只做 Windows）。
 */
export function getKnownInstallCandidates(
  env: Record<string, string | undefined>,
  platform: string = process.platform
): string[] {
  if (platform !== 'win32') return []

  const isNonEmpty = (value: string | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0

  const dirs: string[] = []

  const programRoots = [env['ProgramFiles'], env['ProgramW6432'], env['ProgramFiles(x86)']].filter(
    isNonEmpty
  )
  for (const root of programRoots) {
    dirs.push(join(root, 'Everything'))
    dirs.push(join(root, 'Everything 1.5a'))
  }

  if (isNonEmpty(env['LOCALAPPDATA'])) {
    dirs.push(join(env['LOCALAPPDATA'], 'Programs', 'Everything'))
    dirs.push(join(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links'))
  }
  if (isNonEmpty(env['USERPROFILE'])) {
    dirs.push(join(env['USERPROFILE'], 'scoop', 'apps', 'everything', 'current'))
    dirs.push(join(env['USERPROFILE'], 'scoop', 'shims'))
  }
  if (isNonEmpty(env['ProgramData'])) {
    dirs.push(join(env['ProgramData'], 'chocolatey', 'bin'))
  }

  const candidates: string[] = []
  for (const dir of dirs) {
    for (const name of EVERYTHING_EXE_BASENAMES) candidates.push(join(dir, name))
  }
  return candidates
}

/** 解析「一行一个可执行文件绝对路径」的输出：`where`、进程查询、扫盘命中都是这个形状。 */
export function parseExecutablePathLines(stdout: string): string[] {
  const paths: string[] = []
  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const base = line.split(/[\\/]/).pop() ?? ''
    if (!isEverythingExecutableName(base)) continue
    if (!paths.includes(line)) paths.push(line)
  }
  return paths
}

/**
 * 从 `sc qc <服务名>` 的输出里取 Everything 本体的路径。
 *
 * 形如：
 *         BINARY_PATH_NAME   : "C:\Program Files\Everything\Everything.exe" -svc
 *
 * 剥引号（路径可能含空格），不带引号时切掉第一个以 `-` / `/` 开头的参数；末尾再校验一次文件名
 * 是不是 Everything 本体 —— 不是就返回空串（服务名撞车时不当成命中）。
 */
export function parseEverythingServiceImagePath(stdout: string): string {
  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const matched = /BINARY_PATH_NAME\s*:\s*(.*)$/i.exec(rawLine.trim())
    if (!matched) continue

    let value = matched[1].trim()
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1)
      value = end > 1 ? value.slice(1, end) : value
    } else {
      const argStart = value.search(/\s+[-/]/)
      if (argStart > 0) value = value.slice(0, argStart)
    }

    value = value.trim()
    const base = value.split(/[\\/]/).pop() ?? ''
    return isEverythingExecutableName(base) ? value : ''
  }
  return ''
}

/** 归一化路径分隔符，便于做片段匹配（`C:\a\b` 与 `C:/a/b` 等价）。 */
function toPosixLower(path: string): string {
  return (path ?? '').replace(/\\/g, '/').toLowerCase()
}

/**
 * 是不是第三方软件的私有内置副本（uTools 插件目录、WPS 自带那份）。
 *
 * 老大 2026-09-28 定案：**不碰第三方私有副本** —— 它们是宿主私有、行为不可控，WPS 那份的
 * `Everything.ini` 里还写着 `exclude_files=…*.exe` / `exclude_folders=…%appdata%…`，接上去
 * 用户搜 exe 一个都搜不出来，等于造「假故障」。
 *
 * 探测档位多了（进程 / 快捷方式 / 扫盘）就可能撞上它们，所以在这里统一剔掉。
 */
export function isThirdPartyPrivateEverythingPath(path: string): boolean {
  const normalized = toPosixLower(path)
  if (!normalized) return false
  return (
    normalized.includes('/utools/') ||
    normalized.includes('/kingsoft/') ||
    normalized.includes('/wps office/')
  )
}

/** 去重 + 剔第三方私有副本 + 只留 Everything 本体文件名（进程 / 快捷方式 / 扫盘的输出都过这道）。 */
export function sanitizeEverythingCandidates(paths: readonly string[]): string[] {
  const found: string[] = []
  for (const raw of paths ?? []) {
    const candidate = (raw ?? '').trim()
    if (!candidate) continue
    const base = candidate.split(/[\\/]/).pop() ?? ''
    if (!isEverythingExecutableName(base)) continue
    if (isThirdPartyPrivateEverythingPath(candidate)) continue
    if (!found.includes(candidate)) found.push(candidate)
  }
  return found
}

/**
 * 「本机检测」猜出来的候选，版本信息是否指向 Everything。
 *
 * 传入的是 PowerShell 读出来的 `ProductName|FileDescription`（已剥掉路径前缀）。判定规则：
 *    - **空串（两个字段都空）= 读不到 ⇒ 放行** —— 老版本 / 精简 exe 可能不带版本信息，
 *      不能因为查不出来就把真货丢掉（fail-open 是有意的）；
 *    - 有值就要求里面含 Everything，挡住同名的杂鱼 exe。
 */
export function isEverythingVersionInfoHit(versionInfo: string): boolean {
  const value = (versionInfo ?? '').replace(/\|/g, ' ').trim()
  if (!value) return true
  return /everything/i.test(value)
}

/** 扫盘最大深度：盘根记为 0，`D:\software\Everything\Everything.exe` 是深度 2。 */
export const EVERYTHING_SCAN_MAX_DEPTH = 3
/**
 * 扫盘时不必进去的目录名（小写比对）。
 *
 * `Windows` / `$Recycle.Bin` / `System Volume Information` 进去纯浪费；`AppData` 跳过的代价是
 * 零 —— 常见安装位里已经显式覆盖了 `%LOCALAPPDATA%\Programs`，而真正的私有副本（uTools）
 * 本来就要剔。`node_modules` / `.git` 这种是给「开发机把 Everything 解到工程目录」兜底。
 */
export const SCAN_SKIP_DIR_NAMES: readonly string[] = [
  'windows',
  '$recycle.bin',
  'system volume information',
  'appdata',
  'node_modules',
  '.git',
  'program files',
  'program files (x86)'
]

/** 这个目录名值不值得进去扫。 */
export function shouldScanIntoDirectory(name: string): boolean {
  const normalized = (name ?? '').trim().toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('$')) return false
  return !SCAN_SKIP_DIR_NAMES.includes(normalized)
}

/**
 * 按 `EVERYTHING_SOURCE_PRIORITY` 挑第一个**实际存在**的候选。
 *
 * `exists` 由调用方注入（真实调用给 `fs.existsSync`，套件给假的），所以顺序本身可被钉死。
 */
export function pickEverythingExePath(
  candidatesBySource: Partial<Record<EverythingExeSource, string[]>>,
  exists: (path: string) => boolean
): EverythingExeMatch | null {
  for (const source of EVERYTHING_SOURCE_PRIORITY) {
    for (const candidate of candidatesBySource[source] ?? []) {
      if (candidate && exists(candidate)) return { path: candidate, source }
    }
  }
  return null
}

/**
 * 交给 Everything 的参数。空关键词返回 null（不启动 —— 空搜索等于白弹一个窗口）。
 *
 * 关键词原样作为**独立参数**传递、不拼命令行字符串，所以含空格 / 引号 / 中日韩文字都安全。
 */
export function buildEverythingSearchArgs(keyword: string): string[] | null {
  const trimmed = (keyword ?? '').trim()
  if (!trimmed) return null
  return ['-search', trimmed]
}
