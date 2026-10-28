/**
 * S-155 —— es.exe 取数层：**查询词与命令行参数**。
 *
 * 拼串的全部口径见 `../es-search.ts` 头注 ⑥~⑪，本文件是它们的落点。三条铁律：
 *   1. 拼出的查询词**全程不许有空格**（本机 Everything 把空格当「整文件名精确匹配」）；
 *   2. `folder` 只加 `<folder:>`、不加任何 `ext:`（两者同用恒 0 条）；
 *   3. 空查询一律返回 `null`，绝不把空串放给 es.exe（那等于全盘）。
 */

import type { EsCategory, EsQueryOptions, EsSort, EsSortKey, EsSortOrder } from './types'
import {
  ES_CATEGORY_EXTENSIONS,
  ES_CATEGORY_ORDER,
  ES_DEFAULT_SORT,
  ES_INTERNAL_TIMEOUT_MS,
  ES_MAX_PAGE_SIZE,
  ES_PAGE_SIZE,
  ES_SORT_KEYS
} from './types'

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
