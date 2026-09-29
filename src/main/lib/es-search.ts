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
 * 分页 / 排序 / 总数五条（2026-09-29 实测，S-155 调整⑤ 文件搜索独立窗要用的能力）：
 *   ⑥ `-viewport-offset <n>` + `-viewport-count <k>` **真的在分页** —— offset 0 与 offset 5 拿回的
 *      是两批不重叠的结果，所以滚动续取不必把整份结果拉进内存；
 *   ⑦ `-sort <key>[-ascending|-descending]`，key ∈ name / path / size / extension /
 *      date-created / date-modified / date-accessed。实测 `name-ascending`、`size-descending`、
 *      `date-modified-descending` 均生效；
 *   ⑧ `-get-result-count` 把**裸数字**写 stdout（实测 2142298，无千分位逗号，带不带
 *      `-no-digit-grouping` 都一样）⇒ 解析仍要容忍逗号 —— 用户自己那份 es.exe 版本未必同款；
 *   ⑨ `/ad`（只要文件夹）**不能和 `ext:` 同用**：实测 `"/ad ext:pdf"` 恒为 0 条（是先按扩展名
 *      筛出文件、再要求它是目录，必然空集）⇒ 文件类的过滤与 `folder` 互斥，拼查询词时二选一；
 *   ⑩ **空查询等于全盘**（实测 `-get-result-count` 不带关键词 → 2142298）⇒ 取数层必须继续拦空
 *      查询，不能指望 es.exe 自己报错。
 *   ⑪ **空格在这台机器上不是 AND，是「整文件名精确匹配」**（2026-09-29 实测）：`we chat` /
 *      `package json` / `node modules` / `package ext:json` **恒 0 条**，而完整目录名 `WeChat Files`
 *      才有命中 ⇒ 「关键词 + 分类」这种带空格的标准写法在老大本机必然搜不到（这就是「选了文档分类
 *      反而 0 条」的根因）。官方文档说空格是 AND，属本机 Everything 设置偏离，所以**不赌用户环境**：
 *      拼查询词时全程不留空格，关键词按空白拆词、每个词各自 `<>` 分组后紧挨着拼（见 `buildEsQuery`）。
 *      实测 `<package><ext:json>` = 11920（同写法带空格 = 0）、`<WeChat><folder:>` = 47（带空格 = 0）。
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

/**
 * 一页取多少条（文件搜索窗滚动到「还没取的边界」时，就按这个大小续取下一页）。
 *
 * 不再用 `-n`：`-n` 与 `-viewport-count` 语义重叠，同时给会让人误以为「先取 50 再切片」。
 * 分页窗只要当前这一页，取多少说多少。
 */
export const ES_PAGE_SIZE = 100

/** 单页硬上限。渲染端乱传（或被改坏的配置）也拉不爆内存。 */
export const ES_MAX_PAGE_SIZE = 500

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

/**
 * `-sort` 的键（实测通过的七个，见头注 ⑦）。
 *
 * 只暴露这七个：es.exe 还认 `DIR style sorts`（`-s` / `-r` 之类），但那是给命令行人用的简写，
 * 我们这边按「列表列头」点排序，用不上。
 */
export type EsSortKey =
  | 'name'
  | 'path'
  | 'size'
  | 'extension'
  | 'date-created'
  | 'date-modified'
  | 'date-accessed'

/** `-sort` 的方向。es.exe 的写法是 `<key>-descending`，不带后缀即升序。 */
export type EsSortOrder = 'ascending' | 'descending'

export interface EsSort {
  key: EsSortKey
  order: EsSortOrder
}

export const ES_SORT_KEYS: readonly EsSortKey[] = [
  'name',
  'path',
  'size',
  'extension',
  'date-created',
  'date-modified',
  'date-accessed'
]

/** 默认排序：修改时间倒序 —— 跟资源管理器 / uTools 的默认一致，最近动过的先看见。 */
export const ES_DEFAULT_SORT: EsSort = { key: 'date-modified', order: 'descending' }

export function isEsSortKey(value: unknown): value is EsSortKey {
  return typeof value === 'string' && (ES_SORT_KEYS as readonly string[]).includes(value)
}

/**
 * 排序对象 → es.exe 的 `-sort` 取值。
 *
 * 非法输入（渲染端传过来的 IPC 数据不可信）一律回落 `ES_DEFAULT_SORT` —— 排序取错方向用户能忍，
 * 拼出个 es.exe 不认的参数就整条查询直接失败，那不能忍。
 */
export function buildEsSortArg(sort: EsSort | null | undefined): string {
  const key = isEsSortKey(sort?.key) ? sort.key : ES_DEFAULT_SORT.key
  const order: EsSortOrder = sort?.order === 'ascending' || sort?.order === 'descending' ? sort.order : ES_DEFAULT_SORT.order
  return `${key}-${order}`
}

/**
 * 左栏的分类（7 项，跟老大给的 uTools 截图对齐，但要的是我们自己的口径）。
 *
 * `all` 不过滤；`folder` 走 `/ad`；其余六类走 `ext:` 白名单。
 */
export type EsCategory = 'all' | 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive'

/** 需要按扩展名过滤的那几类（`all` 无过滤、`folder` 走 `/ad`，都不在此列）。 */
export type EsFileCategory = Exclude<EsCategory, 'all' | 'folder'>

export const ES_CATEGORY_ORDER: readonly EsCategory[] = [
  'all',
  'folder',
  'document',
  'image',
  'video',
  'audio',
  'archive'
]

/**
 * `ext:` 白名单。
 *
 * 取值口径：常见办公 / 设计 / 影音 / 压缩格式，外加中国区用户手里常见的国产格式（`wps` / `et` /
 * `dps` / `rmvb` / `wma`）。**不做穷举** —— 漏掉冷门后缀最坏结果是那个文件不出现在该类里，
 * 用户切到「全部」照样搜得到，比塞几百个后缀把界面拖慢强。
 */
export const ES_CATEGORY_EXTENSIONS: Record<EsFileCategory, readonly string[]> = {
  document: [
    'doc', 'docx', 'wps', 'xls', 'xlsx', 'et', 'csv', 'tsv', 'ppt', 'pptx', 'dps',
    'pdf', 'txt', 'md', 'rtf', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'log',
    'one', 'epub', 'mobi'
  ],
  image: [
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff',
    'psd', 'ai', 'heic', 'heif', 'raw', 'cr2', 'nef', 'arw', 'dng'
  ],
  // `ts` **故意不收** —— 它既是 MPEG-TS 视频容器、也是 TypeScript 源文件，`ext:` 只认后缀不看
  // 内容，全收进来会让「视频」分类塞满代码文件（本机实测 `<ext:ts>` 9.3 万条全是 `.ts`）。蓝光
  // 专用后缀 `m2ts` 身份唯一，留着。真 MPEG-TS 视频切「全部」照样搜得到。
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'rm', 'rmvb', 'm2ts', '3gp'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'wma', 'm4a', 'ape', 'opus', 'mid', 'midi', 'amr'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'cab', 'zst', 'lz4', 'jar']
}

export function isEsCategory(value: unknown): value is EsCategory {
  return typeof value === 'string' && (ES_CATEGORY_ORDER as readonly string[]).includes(value)
}

/**
 * 单个词怎么拼：一律 `<词>` 分组，只有**已经自带尖括号**的词（用户手写的 `size:>10mb`）原样放行。
 *
 * 为什么要分组：本机 Everything 开了「空格 = 整文件名匹配」（头注 ⑪），拼串里不能留空格，
 * 词与词之间就只剩「紧挨着」这一种连接方式，`<>` 是唯一能把「这个词必须命中」说明白的语法。
 *
 * 含 `:` 的函数词（`ext:pdf`）**也一并分组**：实测 `<package>ext:json` 与 `<package><ext:json>`
 * 同为 11920 条，两种等价，选分组是图一致 —— 多词并列时裸贴的词会跟前面的组黏成一片，难读也难测。
 * 自带 `<>` 的词必须放行，包起来会破坏函数语法（`<size:>10mb>>` 直接不成话）。
 */
function groupEsTerm(term: string): string {
  if (term.includes('<') || term.includes('>')) return term
  return `<${term}>`
}

/**
 * 把关键词 + 分类拼成交给 es.exe 的**完整查询词**（老大的口径：过滤不在本地做）。
 *
 * 为什么拼进去而不是自己筛：过滤在 Everything 侧做，我们拿回来的就是整页有效结果，本地分页的
 * 「第 N 页」才跟真实结果的第 N 页对得上；本地筛完再分页，空格会随着页面往下滚越积越多。
 *
 * **全程不许出现空格** —— 这是 S-155 修复的坑：老大本机的 Everything 把空格当「整文件名精确匹配」，
 * 实测 `we chat` / `package json` / `node modules` 恒 0 条，而 `WeChat Files`（完整目录名）才有命中。
 * 所以关键词按空白拆词，每个词各自 `<>` 分组后**紧挨着拼**，由 Everything 按 AND 求值。
 * 实测：`<we><chat>` 20 条、`<数据库设计说明书><ext:docx>` 2 条、`<WeChat><folder:>` 20 条；
 * 而原来的 `WeChat ext:doc` 形态恒 0 条（这就是「选了文档分类反而搜不到」的根因）。
 *
 * `folder` **只加 `<folder:>`、不加任何 `ext:`** —— 实测 `"<x><folder:><ext:>"` 恒 0 条（头注 ⑨）。
 *
 * 空关键词时 `<ext:jpg;png>` 这种过滤词本身仍成立（全盘图片），所以这里不判空；拦空查询是
 * `buildEsArgs` / `buildEsCountArgs` 的事（头注 ⑩）。
 */
export function buildEsQuery(query: string, category: EsCategory | null | undefined = 'all'): string {
  const trimmed = (query ?? '').trim()
  const resolved = isEsCategory(category) ? category : 'all'
  const terms = trimmed.length > 0 ? trimmed.split(/\s+/).map(groupEsTerm) : []
  if (resolved === 'folder') terms.push('<folder:>')
  else if (resolved !== 'all') terms.push(`<ext:${ES_CATEGORY_EXTENSIONS[resolved].join(';')}>`)
  return terms.join('')
}

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
 * 一次取数的选项（都可省，省了就是「全部 / 默认排序 / 第一页」）。
 *
 * 全部来自渲染端，**每一项都当不可信数据处理**：非法值回落默认，绝不把怪值拼进命令行。
 */
export interface EsQueryOptions {
  /** 左栏分类，拼进查询词（见 `buildEsQuery`）。 */
  category?: EsCategory | null
  /** 排序；非法值回落 `ES_DEFAULT_SORT`。 */
  sort?: EsSort | null
  /** 已取条数（滚动分页的偏移）。负数 / 非数 / NaN 一律当 0。 */
  offset?: number
  /** 本页取多少条；非法值回落 `ES_PAGE_SIZE`，上限 `ES_MAX_PAGE_SIZE`。 */
  pageSize?: number
  timeoutMs?: number
}

/** 夹紧页大小：非正数 / 非数回落默认，超过上限截到上限。 */
function clampPageSize(value: number | undefined): number {
  const size = Math.floor(Number(value))
  if (!Number.isFinite(size) || size <= 0) return ES_PAGE_SIZE
  return Math.min(size, ES_MAX_PAGE_SIZE)
}

/**
 * 交给 es.exe 的取数参数（配方见 S-155.md §三，本机实测通过；分页与排序见头注 ⑥⑦）。
 *
 * 空查询返回 null（不启动 —— 空查询在 es.exe 那边等于**全盘**，见头注 ⑩，绝不能放它出去）。
 * 注意这里的「空」看的是**拼完分类之后**的完整查询词：空关键词 + `图片` 分类 = `ext:jpg;png`，
 * 那是一条有意义的查询，照搜；空关键词 + `全部` 才是真的空。
 *
 * 三个易错点：
 *   - 完整查询词是**最后一个位置参数**，原样作为独立参数传入（含空格 / 引号 / 中文都安全）；
 *   - `-no-digit-grouping` 不能省，否则数字带千分位逗号（`1,234`）会污染 JSON；
 *   - 这里**不用** `-no-result-error` —— 空结果靠「输出为空数组」判定就够（实测 exit 仍 0），
 *     少一个开关少一种状态。
 */
export function buildEsArgs(
  query: string,
  outFile: string,
  options: EsQueryOptions = {}
): string[] | null {
  const fullQuery = buildEsQuery(query, options.category ?? 'all')
  if (!fullQuery || !outFile) return null

  const offset = Math.max(0, Math.floor(Number(options.offset)) || 0)
  const rawTimeout = Math.floor(Number(options.timeoutMs))
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(0, rawTimeout) : ES_INTERNAL_TIMEOUT_MS

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
    String(timeoutMs),
    '-sort',
    buildEsSortArg(options.sort),
    '-viewport-offset',
    String(offset),
    '-viewport-count',
    String(clampPageSize(options.pageSize)),
    fullQuery
  ]
}

/**
 * 只要**总数**的参数（底栏「共 N 条结果」，见头注 ⑧）。
 *
 * 单独一次进程：`-get-result-count` 与导出互斥（同时给时它只报数、不落盘）。
 * 查询词与分页无关 —— 总数是「整个查询命中多少」，不是「这一页多少」。
 */
export function buildEsCountArgs(
  query: string,
  category: EsCategory | null | undefined = 'all'
): string[] | null {
  const fullQuery = buildEsQuery(query, category)
  if (!fullQuery) return null
  return ['-get-result-count', '-no-digit-grouping', fullQuery]
}

/**
 * 解析 `-get-result-count` 的 stdout。
 *
 * 实测输出是裸数字（`2142298`，无千分位，见头注 ⑧），但这里仍逐行剥逗号与空白再匹配 ——
 * 用户自己那份 es.exe 未必同款，带上千分位就把「共 214 万条」变成「共 214 条」，这种错最恶心。
 *
 * 读不出来返回 `null`（底栏就不显示总数，而不是显示一个假数）。
 */
export function parseEsResultCount(stdout: string): number | null {
  const text = (stdout ?? '').replace(/^\uFEFF/, '').trim()
  if (!text) return null
  for (const rawLine of text.split(/\r?\n/)) {
    const digits = rawLine.trim().replace(/[,\s]/g, '')
    if (!/^\d+$/.test(digits)) continue
    const value = Number(digits)
    if (Number.isSafeInteger(value) && value >= 0) return value
  }
  return null
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
