/**
 * S-155 —— 快捷启动「文件搜索」的 es.exe 取数层：**类型、常量与分类表**。
 *
 * 本文件只放同质数据（类型定义、目录档位、扩展名白名单、分页常量），不放逻辑。
 * 逻辑分三处：
 *   - `query.ts`     —— 查询词与命令行参数怎么拼
 *   - `parse.ts`     —— 输出怎么解、失败怎么分类
 *   - `discovery.ts` —— es.exe 怎么找
 *
 * 本机实测钉死的十条口径见 `../es-search.ts` 头注（那里是模块总纲，这里是它的数据落点）。
 */

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
 * `-sort` 的键（实测通过的七个，见 `../es-search.ts` 头注 ⑦）。
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
