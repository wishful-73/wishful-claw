/**
 * S-155 —— 快捷启动「文件搜索」的 es.exe 取数层（纯函数）。
 *
 * 存在理由：S-151 只把关键词投给 Everything 自己的窗口，结果长什么样我们管不着（原生界面丑）。
 * S-155 改成**我们自己取数、自己渲染**，取数统一走官方命令行版 `es.exe` —— 挂到 Everything
 * 已经在跑的实例上，让它把结果导出成 JSON，我们解析成列表。
 *
 * 为什么是 es.exe，而不是自编 native addon / Everything HTTP server（三条路的取证见 S-155.md §0.2）：
 *   - 117 KB 单文件、官方分发，零 native 维护、不占端口；
 *   - 不改用户的 Anything 设置，复用用户自己的 Everything 与它已建好的索引 —— 我们不额外占磁盘。
 *
 * 本机实测钉死的五条（ES 1.1.0.38 × Everything 1.4.1.1032，2026-09-28）：
 *   ① `-date-format 1` 让 `date_modified` 直接出**本地时间 ISO 串**（`2023-06-08T18:01:25`，
 *      无时区、无毫秒）⇒ 不必去解 FILETIME ticks（那是 1.4e17 量级，超过 JS 安全整数会丢精度）；
 *   ② **空结果时输出文件只有 3 字节 BOM、连 `[]` 都没有**，且 exit code 仍是 0
 *      ⇒ 解析层必须把「剥 BOM 后为空」当成空结果，不能让 JSON.parse 抛出去；
 *   ③ **Everything 没在跑时 exit code = 8**（`Error 8: Everything IPC not found`），
 *      **并且输出文件照样会被创建**（内容为空）⇒ 失败分类必须吃退出码，不能只看文件在不在；
 *   ④ 目录项 `filename` **自带尾部反斜杠**、`size` / `extension` 为 `null` ⇒ 目录判定只看分隔符；
 *   ⑤ es.exe 的版本信息是 `ProductName=es` / `FileDescription=Everything Command Line Interface`
 *      ⇒ 版本校验不能只认 `Everything`（S-151 的 `isEverythingVersionInfoHit` 会误杀）。
 *
 * 本模块只做解析与判定，不碰文件系统、不开进程；存在性由调用方注入，便于回归套件钉死顺序。
 */

import { join } from 'path'
import { getKnownInstallCandidates, isThirdPartyPrivateEverythingPath } from './everything-search'

/** 官方命令行版只有这一个名字（大小写无关）。 */
export const ES_EXE_BASENAME = 'es.exe'

/**
 * es.exe 的探测档位，从高到低。
 *
 * 比 S-151 的 Everything 探测少几档 —— 那些档对 es.exe 没有对应物：它是**单文件**，没有安装
 * 程序（无卸载键 `DisplayIcon` / `InstallLocation`）、不当服务跑（无 `-svc`）、也不会成为
 * 快捷方式的目标。真正有意义的落点只有：用户指定 → **内置件** → Everything 本体同目录（最常见的
 * 手工解压位）→ 常见安装位 → PATH → 扫盘。
 */
export type EsExeSource = 'manual' | 'builtin' | 'alongside' | 'program-files' | 'path' | 'scan'

/**
 * 档位次序。
 *
 * `builtin` 排第二：用户手选的一律优先（尊重用户），但默认我们**不再让他去装 es.exe** ——
 * 打进包里最省事，也免掉「装完 Everything 还要再装命令行版」这道坑。后四档留作兜底：
 * 内置件被安全软件清掉、或用户那份 es.exe 版本更新想覆盖时，还能落回原路径。
 */
export const ES_SOURCE_PRIORITY: readonly EsExeSource[] = [
  'manual',
  'builtin',
  'alongside',
  'program-files',
  'path',
  'scan'
]

/**
 * 内置 es.exe 的路径（随安装包分发的 `resources/es/es.exe`）。
 *
 * `resourcesRoot` 由调用方注入 —— dev 下是仓库根的 `resources/`，打包后是 `process.resourcesPath`
 * （electron-builder 的 `extraResources: from resources/es → to es` 把它摊在 `<resources>/es/`）。
 * 本函数不探测、不碰文件系统：是否真存在交给 `pickEsCandidate` 注入的 `exists` 判。
 */
export function getEsBuiltinPath(resourcesRoot: string | null | undefined): string | null {
  const root = (resourcesRoot ?? '').trim()
  if (!root) return null
  return join(root, 'es', ES_EXE_BASENAME)
}

/** 一次取多少条。列表只渲染这么多，多了既没人看也白等。 */
export const ES_SEARCH_LIMIT = 50

/** 交给 es.exe 的 `-timeout`：等它把索引加载完（首次查询时库可能还没进内存）。 */
export const ES_INTERNAL_TIMEOUT_MS = 1000

/** 进程级硬超时：es.exe 赖着不退出就 kill，别拖住面板。 */
export const ES_PROCESS_TIMEOUT_MS = 2000

export interface EsExeMatch {
  path: string
  source: EsExeSource
}

/** 一条搜索结果。`name` / `dir` 是 `fullPath` 切出来的，es.exe 不拆列（实测 `-name -path-column` 无效）。 */
export interface FileHit {
  fullPath: string
  name: string
  dir: string
  isDir: boolean
  size: number | null
  /** epoch 毫秒；解析不出来是 null。 */
  mtime: number | null
  ext: string
}

/**
 * 取数失败的分类（**不含「无结果」** —— 那是成功，只是列表为空）。
 *
 * - `not-running`：Everything 本体没在跑（es.exe 的 exit 8），我们只能让他去开 Everything；
 * - `spawn-failed`：es.exe 压根没起来（路径失效 / 权限）⇒ 调用方应回探测；
 * - `bad-output`：起来了但吐的不是合法 JSON；
 * - `search-failed`：其它非零退出。
 */
export type EsFailure = 'not-running' | 'spawn-failed' | 'bad-output' | 'search-failed'

/** 文件名是不是 es.exe（大小写无关；只看 basename）。 */
export function isEsExecutableName(fileName: string): boolean {
  return (fileName ?? '').trim().toLowerCase() === ES_EXE_BASENAME
}

/**
 * es.exe 的版本信息是否可信。传入的是 PowerShell 读出来的 `ProductName|FileDescription`。
 *
 * 判定比 S-151 的 Everything 版多一条：实测 es.exe 的 `ProductName` **就是 `es`**（FileDescription
 * 才是 `Everything Command Line Interface`），只认 `Everything` 会把它误杀。规则：
 *    - **空串（两个字段都空）= 读不到 ⇒ 放行** —— 精简 / 老版本 exe 可能不带版本信息（fail-open）；
 *    - 任一字段恰好等于 `es` ⇒ 命中；
 *    - 整串含 `everything` ⇒ 命中（covers `FileDescription` 那条）；
 *    - 有值但都不沾 ⇒ 拦（挡同名的杂鱼 exe）。
 */
export function isEsVersionInfoHit(versionInfo: string): boolean {
  const raw = (versionInfo ?? '').trim()
  if (!raw) return true
  const fields = raw.split('|').map((field) => field.trim().toLowerCase())
  if (fields.some((field) => field === 'es')) return true
  return /everything/i.test(raw)
}

/**
 * Everything 本体同目录下的 es.exe —— 把手里的 es.exe 跟 Everything 放一起是最常见的用法。
 *
 * 拿不到本体路径（没探到 Everything）时返回空数组。
 */
export function getEsAlongsideCandidates(everythingExePath: string | null | undefined): string[] {
  const path = (everythingExePath ?? '').trim()
  if (!path) return []
  const sep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (sep <= 0) return []
  return [join(path.slice(0, sep), ES_EXE_BASENAME)]
}

/**
 * 常见安装位下的 es.exe。
 *
 * 目录清单直接复用 S-151 那份（`getKnownInstallCandidates` 覆盖了标准安装、1.5 alpha、winget /
 * scoop / chocolatey 这些不写官方卸载键的位置 —— 维护一份就够），只把文件名换成 `es.exe`。
 */
export function getEsKnownDirCandidates(
  env: Record<string, string | undefined>,
  platform: string = process.platform
): string[] {
  const found: string[] = []
  for (const everythingExe of getKnownInstallCandidates(env, platform)) {
    const sep = Math.max(everythingExe.lastIndexOf('\\'), everythingExe.lastIndexOf('/'))
    if (sep <= 0) continue
    const candidate = join(everythingExe.slice(0, sep), ES_EXE_BASENAME)
    if (!found.includes(candidate)) found.push(candidate)
  }
  return found
}

/**
 * 解析「一行一个 es.exe 绝对路径」的输出（`where es.exe` 的形状）。
 *
 * 跟 S-151 的 `parseExecutablePathLines` 不能共用 —— 那个只认 Everything 本体名，会把 es.exe
 * 全滤掉。第三方私有副本（uTools / WPS 自带那份 Everything 的配套 es.exe）同样剔除：它们挂在
 * 私有的 Everything 实例上，结果被对方的 excludes 规则改写，接上去就是「假故障」。
 */
export function parseEsPathLines(stdout: string): string[] {
  const paths: string[] = []
  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const base = line.split(/[\\/]/).pop() ?? ''
    if (!isEsExecutableName(base)) continue
    if (isThirdPartyPrivateEverythingPath(line)) continue
    if (!paths.includes(line)) paths.push(line)
  }
  return paths
}

/** 按 `ES_SOURCE_PRIORITY` 挑第一个**实际存在**的候选。`exists` 由调用方注入。 */
export function pickEsCandidate(
  candidatesBySource: Partial<Record<EsExeSource, string[]>>,
  exists: (path: string) => boolean
): EsExeMatch | null {
  for (const source of ES_SOURCE_PRIORITY) {
    for (const candidate of candidatesBySource[source] ?? []) {
      if (candidate && exists(candidate)) return { path: candidate, source }
    }
  }
  return null
}

/**
 * 交给 es.exe 的参数（配方见 S-155.md §三，本机实测通过）。
 *
 * 空关键词返回 null（不启动 —— 空搜索就是白跑一次进程）。
 *
 * 两个易错点：
 *   - 关键词是**最后一个位置参数**，原样作为独立参数传入（含空格 / 引号 / 中文都安全）；
 *   - `-no-digit-grouping` 不能省，否则数字带千分位逗号（`1,234`）会污染 JSON；
 *   - 这里**不用** `-no-result-error` —— 空结果靠「输出为空数组」判定就够（实测 exit 仍 0），
 *     少一个开关少一种状态。
 */
export function buildEsArgs(
  query: string,
  outFile: string,
  limit: number = ES_SEARCH_LIMIT,
  timeoutMs: number = ES_INTERNAL_TIMEOUT_MS
): string[] | null {
  const trimmed = (query ?? '').trim()
  if (!trimmed || !outFile) return null
  const capped = Math.max(1, Math.min(Math.floor(limit) || ES_SEARCH_LIMIT, 500))
  return [
    '-export-json',
    outFile,
    '-utf8-bom',
    '-no-digit-grouping',
    '-size',
    '-date-modified',
    '-extension',
    '-date-format',
    '1',
    '-timeout',
    String(Math.max(0, Math.floor(timeoutMs))),
    '-n',
    String(capped),
    trimmed
  ]
}

/** FILETIME（100ns since 1601）→ epoch 毫秒。只在没带 `-date-format 1` 时兜底。 */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000

function parseMtime(raw: unknown): number | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }
  // 数字形态 = FILETIME ticks（超出安全整数，秒级精度已够用）。
  const ticks = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(ticks) || ticks <= 0) return null
  return Math.round(ticks / 10000 - FILETIME_EPOCH_OFFSET_MS)
}

/** 把一条 `filename` 切成 `name` / `dir` / `isDir`：es.exe 只给全路径，拆列得我们自己来。 */
function splitFullPath(rawPath: string): { name: string; dir: string; isDir: boolean } {
  const isDir = /[\\/]\s*$/.test(rawPath)
  const trimmed = isDir ? rawPath.replace(/[\\/]+$/, '') : rawPath
  // 盘根 `C:\` 去掉尾分隔符后只剩 `C:`，单独还原，别渲染成一个叫 `C:` 的空目录。
  if (/^[A-Za-z]:$/.test(trimmed)) return { name: `${trimmed}\\`, dir: '', isDir: true }

  const sep = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  const name = sep >= 0 ? trimmed.slice(sep + 1) : trimmed
  let dir = sep >= 0 ? trimmed.slice(0, sep) : ''
  if (/^[A-Za-z]:$/.test(dir)) dir += '\\'
  return { name, dir, isDir }
}

/** 单条 JSON → `FileHit`；`filename` 缺失就丢掉（不该出现的残条，不能让它打断整份结果）。 */
function toFileHit(entry: unknown): FileHit | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const fullPath = typeof record['filename'] === 'string' ? record['filename'].trim() : ''
  if (!fullPath) return null

  const { name, dir, isDir } = splitFullPath(fullPath)
  const rawSize = typeof record['size'] === 'number' ? record['size'] : null
  const size = rawSize !== null && Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null
  const extFromJson = typeof record['extension'] === 'string' ? record['extension'].trim() : ''
  const dot = name.lastIndexOf('.')
  const ext = isDir ? '' : extFromJson || (dot > 0 ? name.slice(dot + 1) : '')

  return { fullPath, name, dir, isDir, size, mtime: parseMtime(record['date_modified']), ext }
}

/**
 * 解析 `-export-json -utf8-bom` 落下的文件内容。
 *
 * **空结果是合法的**：实测这时文件只有 3 字节 BOM（连 `[]` 都没有）⇒ 剥掉 BOM 后为空串要返回
 * `[]`，不能让 `JSON.parse` 抛出去把「没搜到」误判成故障。
 *
 * 真·非法输出（截断 / 非数组 / 根本不是 JSON）**抛异常**，由调用方归类成 `bad-output`。
 */
export function parseEsJson(raw: string): FileHit[] {
  const text = (raw ?? '').replace(/^\uFEFF/, '').trim()
  if (!text) return []

  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('es.exe output is not a JSON array')

  const hits: FileHit[] = []
  for (const entry of parsed) {
    const hit = toFileHit(entry)
    if (hit) hits.push(hit)
  }
  return hits
}

/**
 * 退出码 + stderr → 失败分类；成功返回 null。
 *
 * `code === null` 表示进程压根没起来（spawn error），归 `spawn-failed` —— 调用方据此回探测。
 * exit 8 是本机实测的「Everything IPC not found」，直接判 `not-running`；stderr 里出现同样的字眼
 * 也算（不同版本的文案可能不同，双保险）。
 */
export function classifyEsFailure(code: number | null, stderr: string): EsFailure | null {
  if (code === 0) return null
  if (code === null) return 'spawn-failed'

  const text = (stderr ?? '').toLowerCase()
  if (code === 8 || text.includes('ipc not found') || text.includes('make sure everything is running')) {
    return 'not-running'
  }
  if (text.includes('enoent') || text.includes('cannot find') || text.includes('not recognized')) {
    return 'spawn-failed'
  }
  return 'search-failed'
}

/** 字节数 → 人类可读（`432.6 KB`）。`null`（目录）返回空串。 */
export function formatHitSize(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${Math.round(size)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

/** epoch 毫秒 → 本地时间 `YYYY-MM-DD HH:mm`。`null` / 非法值返回空串。 */
export function formatHitTime(mtime: number | null): string {
  if (mtime === null || !Number.isFinite(mtime)) return ''
  const date = new Date(mtime)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
