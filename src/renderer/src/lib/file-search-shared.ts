/**
 * 文件搜索的**渲染端**共享层（S-155 调整⑤）：类型、分类/排序清单、展示格式化、失败文案。
 *
 * 为什么另起一份类型，而不是 import 主进程的 `src/main/lib/es-search.ts`：
 * 渲染包不能把 `node:path` 这类依赖拖进来，跨进程只能复制形状。所以这里**手工同步** ——
 * 改主进程的 `EsCategory` / `EsSortKey` / `FileHit` 时必须一起改这里，否则 typecheck 不报错，
 * 界面只是静默错（记忆里踩过一次：主进程加 `'builtin'` 档，渲染端那份没跟上，来源标签直接消失）。
 *
 * 共用方：独立窗 `file-search/main.tsx`、原窗 `launcher/main.tsx` 的文件模式。
 */

import type { ComponentType } from 'react'
import {
  FileArchive,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  Music
} from 'lucide-react'

/** 左栏分类（与主进程 `EsCategory` 手工同步）。 */
export type EsCategory = 'all' | 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive'

/** `-sort` 的键（与主进程 `EsSortKey` 手工同步，对应 es.exe 实测通过的那七个）。 */
export type EsSortKey =
  | 'name'
  | 'path'
  | 'size'
  | 'extension'
  | 'date-created'
  | 'date-modified'
  | 'date-accessed'

export type EsSortOrder = 'ascending' | 'descending'

export interface EsSort {
  key: EsSortKey
  order: EsSortOrder
}

/** 一条搜索命中（与主进程 `FileHit` 手工同步）。 */
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

/** 取数结果。`ok: true` + 空 `hits` = 成功但没搜到。 */
export interface EsSearchResult {
  ok: boolean
  hits: FileHit[]
  failure?: 'not-running' | 'spawn-failed' | 'bad-output' | 'search-failed'
  error?: string
}

/** 一页取多少条（与主进程 `ES_PAGE_SIZE` 同步）。 */
export const FILE_SEARCH_PAGE_SIZE = 100

/** 默认排序：修改时间倒序 —— 跟资源管理器 / uTools 的默认一致。 */
export const DEFAULT_ES_SORT: EsSort = { key: 'date-modified', order: 'descending' }

/** 左栏次序（`全部` 在最上，`文件夹` 紧随 —— 这两种是最高频的诉求）。 */
export const ES_CATEGORIES: ReadonlyArray<{
  id: EsCategory
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'all', label: '全部', icon: LayoutGrid },
  { id: 'folder', label: '文件夹', icon: Folder },
  { id: 'document', label: '文档', icon: FileText },
  { id: 'image', label: '图片', icon: ImageIcon },
  { id: 'video', label: '视频', icon: Film },
  { id: 'audio', label: '音频', icon: Music },
  { id: 'archive', label: '压缩包', icon: FileArchive }
]

/** 底栏排序选项。第一项就是默认值。 */
export const ES_SORT_OPTIONS: ReadonlyArray<{ id: string; label: string; sort: EsSort }> = [
  { id: 'mtime-desc', label: '按修改时间降序', sort: { key: 'date-modified', order: 'descending' } },
  { id: 'mtime-asc', label: '按修改时间升序', sort: { key: 'date-modified', order: 'ascending' } },
  { id: 'name-asc', label: '按名称升序', sort: { key: 'name', order: 'ascending' } },
  { id: 'name-desc', label: '按名称降序', sort: { key: 'name', order: 'descending' } },
  { id: 'size-desc', label: '按大小降序', sort: { key: 'size', order: 'descending' } },
  { id: 'size-asc', label: '按大小升序', sort: { key: 'size', order: 'ascending' } }
]

/** 取数失败 → 给用户看的话。不甩 exit code 这种内部细节，但说清「下一步能做什么」。 */
export function fileSearchFailureText(result: EsSearchResult): string {
  switch (result.failure) {
    case 'not-running':
      return 'Everything 没有在运行，先启动它再搜'
    case 'spawn-failed':
      return 'es.exe 启动失败，可能路径已失效（设置里可以重新检测）'
    case 'bad-output':
      return 'es.exe 的输出无法解析，换个关键词试试'
    default:
      return `搜索失败：${result.error ?? '未知原因'}`
  }
}

/** 字节数 → 人类可读（`432.6 KB`）。目录（`null`）返回空串。 */
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
