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
  failure?: 'not-installed' | 'not-running' | 'spawn-failed' | 'bad-output' | 'search-failed'
  error?: string
  /** 主进程已经替他自动拉过一次 Everything 本体，还是没起来（S-253）。 */
  autostartAttempted?: boolean
  /** 拉起**明确失败**（spawn 报错 / 非 0 退出），而不只是「还没就绪」（S-253 真机补刀）。 */
  autostartFailed?: boolean
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

/**
 * 失败时界面上该给的下一步（S-253）。**只有这三种**，别再加 —— 每一种都得是一个用户真能点的动作：
 * - `download`：打开 Everything 官方下载页；
 * - `redetect`：作废探测缓存重找一遍（用户刚装好 / 刚换了路径）；
 * - `retry`：同一个请求再打一次（网络抖动 / 拉起超时）。
 */
export type FileSearchFailureAction = 'download' | 'redetect' | 'retry'

/** 失败提示：一句实话 + 一个能点的下一步。 */
export interface FileSearchFailureView {
  text: string
  actions: FileSearchFailureAction[]
}

/**
 * 取数失败 → 给用户看的话 + 下一步按钮（S-253）。
 *
 * 三种情况必须**互斥**地说清，不能再混成一句「软件没有运行」：
 *   ① 没装（`not-installed`，或 es.exe 在但本体探不到 = `not-running` 且没自动拉起过）⇒ 引导去下载；
 *   ② 装了没启动 ⇒ 主进程已经替他拉（`es-probe.startEverythingAndRetry`），这里不给按钮，
 *      只在拉不起来后（`autostartAttempted`）如实说「拉过了没成」并给重试；**其中还要再分**
 *      「索引还没读完（等一等）」和「spawn 就失败了（查权限 / 重装）」—— 见 `autostartFailed`；
 *   ③ 起了没连上 / es.exe 路径失效（`spawn-failed`）⇒ 重新检测。
 *
 * 不甩 exit code 这种内部细节，但要说清「下一步能做什么」。
 */
export function fileSearchFailureView(result: EsSearchResult): FileSearchFailureView {
  switch (result.failure) {
    case 'not-installed':
      return {
        text: '没找到文件搜索组件（es.exe）。装上 Everything 就能搜本地文件，装完点「重新检测」即可，不用重启我们。',
        actions: ['download', 'redetect']
      }
    case 'not-running':
      // 没有 `autostartAttempted` = 连本体路径都没探到，跟「没装」是一件事，别让用户对着「重试」按到底。
      if (!result.autostartAttempted) {
        return {
          text: '没找到 Everything 本体。装上它就能搜本地文件，装完点「重新检测」即可。',
          actions: ['download', 'redetect']
        }
      }
      // 拉起过还连不上，两种原因，**处置方式不同**，所以必须分开说（S-253 真机补刀）：
      //   `autostartFailed` ⇒ spawn 就失败（UAC 拒绝 / 映像损坏），等多久都没用；
      //   否则 ⇒ 进程活着、索引还没读完。这是最常见的一种，原来被错报成「安装损坏」。
      //
      // 为什么敢肯定「exe 存在」：能走到这里说明 `getEverythingStatus()` 探到了本体路径
      // （`es-probe.ts` 里探不到会早退、不带 `autostartAttempted`）⇒ 文件在，谈「安装损坏」
      // 本来就不成立，只能说「启动没成功」。
      return result.autostartFailed
        ? {
            text: 'Everything 启动失败（多半是被权限拦住了，或安装已损坏）。可以先手动打开一次 Everything 看看它能不能正常启动，再回来重试。',
            actions: ['retry', 'redetect']
          }
        : {
            text: 'Everything 已经启动了，但索引还没读完，所以暂时搜不了。索引大的话要等十几秒，稍等一下再搜一次。',
            actions: ['retry']
          }
    case 'spawn-failed':
      return {
        text: 'es.exe 启动失败，路径可能已经失效（换盘 / 卸载过）。重新检测一次就能重新找到它。',
        actions: ['redetect']
      }
    case 'bad-output':
      return {
        text: 'es.exe 的输出无法解析，换个关键词试试。',
        actions: ['retry']
      }
    default:
      return {
        text: `搜索失败：${result.error ?? '未知原因'}`,
        actions: ['retry']
      }
  }
}

/** 按钮文案（`fileSearchFailureView` 的配套，只这一处用）。 */
export const FILE_SEARCH_FAILURE_ACTION_LABELS: Record<FileSearchFailureAction, string> = {
  download: '去下载 Everything',
  redetect: '我已装好，重新检测',
  retry: '重试'
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
