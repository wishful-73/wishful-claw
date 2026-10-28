/**
 * 文件搜索的结果列表区（S-253 补丁随 S-255 一并收口时从 `main.tsx` 拆出）。
 *
 * 为什么单独一个文件：这段是纯展示 —— 出错提示 + 过程提示 + 空态 + 行渲染 + 续页转圈，
 * 不持有任何 state，所有数据由 `main.tsx` 传进来。留在原文件里只会让它越过 500 行硬线
 * （AGENTS.md §大文件拆分 第 2 条），拆出来后「列表长什么样」一眼能找到。
 */
import React from 'react'
import { ExternalLink, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react'
import {
  FILE_SEARCH_FAILURE_ACTION_LABELS,
  formatHitSize,
  formatHitTime,
  type EsCategory,
  type FileHit,
  type FileSearchFailureAction,
  type FileSearchFailureView
} from '../lib/file-search-shared'

const LAUNCHING_EVERYTHING_TEXT = 'Everything 没在运行，正在替你启动...'

export function ResultList({
  hits,
  icons,
  error,
  searching,
  launchingEverything,
  loadingMore,
  selectedIndex,
  keyword,
  category,
  listRef,
  onSelectIndex,
  onOpenHit,
  onFailureAction
}: {
  hits: FileHit[]
  icons: Record<string, string | null>
  error: FileSearchFailureView | null
  searching: boolean
  /** 主进程正在替用户拉起 Everything 本体（S-253）。 */
  launchingEverything: boolean
  loadingMore: boolean
  selectedIndex: number
  /** 已防抖的关键词与分类，只服务空态文案。 */
  keyword: string
  category: EsCategory
  listRef: React.RefObject<HTMLDivElement | null>
  onSelectIndex: (index: number) => void
  onOpenHit: (hit: FileHit, reveal: boolean) => Promise<void>
  onFailureAction: (action: FileSearchFailureAction) => Promise<void>
}): React.JSX.Element {
  // `!launchingEverything` —— 转圈那条（下方）和空态是同屏渲染的，状态一瞬间不同步就会
  // 出现「正在启动 Everything」和「输入关键词开始搜索」并排。宁可这半秒什么都不说。
  const showEmpty = !error && hits.length === 0 && !searching && !launchingEverything

  return (
    <div ref={listRef} className="min-w-0 flex-1 overflow-y-auto py-1">
      {error && (
        <div className="px-4 py-3">
          <p className="text-xs text-destructive">{error.text}</p>
          {error.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {error.actions.map((action) => (
                <button
                  key={action}
                  onClick={() => void onFailureAction(action)}
                  className={
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors ' +
                    (action === 'download'
                      ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')
                  }
                >
                  {FILE_SEARCH_FAILURE_ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        过程态不能挂在 `hits.length === 0` 后面。hits 要等 `file-search:query` 返回才替换，
        而 `starting-everything` 是主进程在它那 3 秒轮询期间推过来的 —— 于是「上次有结果 →
        改关键词 → 撞上 Everything 没运行」这个组合下，旧结果原地不动、提示又不显示，
        观感就是卡死。有旧结果时给一条顶部提示带，没有旧结果时保留原来的居中块。
      */}
      {!error && launchingEverything && (
        <>
          {hits.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {LAUNCHING_EVERYTHING_TEXT}
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              {LAUNCHING_EVERYTHING_TEXT}
            </div>
          )}
        </>
      )}

      {!error && searching && !launchingEverything && hits.length === 0 && (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          搜索中...
        </div>
      )}

      {showEmpty && (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {keyword.trim() || category !== 'all' ? '没有匹配的文件' : '输入关键词开始搜索'}
        </div>
      )}

      {hits.map((hit, index) => {
        const iconSrc = icons[hit.fullPath]
        const active = index === selectedIndex
        return (
          <div
            key={hit.fullPath}
            data-hit-index={index}
            onMouseEnter={() => onSelectIndex(index)}
            onDoubleClick={() => void onOpenHit(hit, false)}
            title={hit.fullPath}
            className={
              'group flex cursor-default items-center gap-3 px-3 py-1.5 transition-colors ' +
              (active ? 'bg-accent' : 'hover:bg-accent/50')
            }
          >
            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60">
              {iconSrc ? (
                <img src={iconSrc} alt="" className="size-5 object-contain" />
              ) : hit.isDir ? (
                <Folder className="size-4 text-muted-foreground" />
              ) : (
                <FileText className="size-4 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{hit.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{hit.dir}</p>
            </div>

            <div className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground tabular-nums">
              {hit.size !== null && <p>{formatHitSize(hit.size)}</p>}
              {hit.mtime !== null && <p>{formatHitTime(hit.mtime)}</p>}
            </div>

            {/* 两个动作按钮：默认动作是「打开所在位置」，双击行本身才是打开文件 */}
            <div
              className={
                'flex shrink-0 items-center gap-1 transition-opacity ' +
                (active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
              }
            >
              <button
                onClick={() => void onOpenHit(hit, true)}
                title="打开所在位置"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <FolderOpen className="size-3.5" />
              </button>
              <button
                onClick={() => void onOpenHit(hit, false)}
                title="打开文件"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          </div>
        )
      })}

      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          加载中...
        </div>
      )}
    </div>
  )
}
