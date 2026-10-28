/**
 * S-155 —— es.exe 取数层：**输出解析与失败分类**。
 *
 * 这一层全部建立在「本机实测」之上（见 `../es-search.ts` 头注 ②③④⑧）：
 *   - 空结果时导出文件只有 3 字节 BOM、连 `[]` 都没有 ⇒ 剥 BOM 后为空要返回 `[]`，不许抛；
 *   - Everything 没在跑时 exit = 8 **且照样创建空输出文件** ⇒ 失败分类必须吃退出码；
 *   - 目录项 `filename` 自带尾部反斜杠、`size` / `extension` 为 null ⇒ 目录判定只看分隔符；
 *   - `-get-result-count` 出裸数字，但仍要容忍千分位逗号（用户那份 es.exe 未必同款）。
 */

import type { EsFailure, FileHit } from './types'

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

/**
 * `Everything.exe -startup` 的退出码算不算「自动拉起明确失败」（S-253 补刀的补刀）。
 *
 * 单独抽出来是因为这条判据反直觉，且错了会直接变成用户看到的一句假话：`-startup` 的官方语义是
 * 「已在运行就什么都不做」⇒ **Everything 本来就在跑时它会立刻以 0 退出**，那一刻的真实含义是
 * 「没事要干」，不是「启动失败」。判据必须收在 `!== 0`，不能放宽成「非 null 即失败」
 * （`classifyEsFailure` 里 `code === null` 归 `spawn-failed` 是另一码事，那是 es.exe 自己没起来）。
 */
export function isEverythingAutostartFailure(code: number | null): boolean {
  return code !== 0
}
