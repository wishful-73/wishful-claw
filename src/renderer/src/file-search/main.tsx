/**
 * 文件搜索独立窗（S-155 调整⑤）。
 *
 * 存在理由：原窗是「搜应用」的窄条（透明 / 无边框 / 失焦即隐），塞不下带路径 / 大小 / 时间的
 * 文件列表。老大 2026-09-29 的定稿：搜索文件另开一个**常规窗**，布局照 uTools 那张图
 * （左栏分类 + 中间结果 + 底部排序与总数），样式走我们自己的主题。
 *
 * 三条边界：
 *   - 原窗只负责「搜应用」；点它的「搜索文件」把已输入的文字带过来（`file-search:init`）；
 *   - 取数 / 打开 / 图标全走 `file-search:*` 这组独占通道，不碰原窗那套；
 *   - **双击 = 打开文件（关窗）、回车 = 打开所在位置（留窗）** —— 用户常常要连着看好几个。
 *
 * 分页：es.exe 的 `-viewport-offset/-count` 真分页（见 `lib/es-search.ts` 头注 ⑥），所以列表
 * 滚到接近底部才续取下一页，不把整份结果拉进内存。
 */

import '../assets/main.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ExternalLink, FileText, Folder, FolderOpen, Loader2, Search } from 'lucide-react'
import { syncThemeFromSettings } from '../lib/theme-sync'
import {
  DEFAULT_ES_SORT,
  ES_CATEGORIES,
  ES_SORT_OPTIONS,
  FILE_SEARCH_PAGE_SIZE,
  fileSearchFailureText,
  formatHitSize,
  formatHitTime,
  type EsCategory,
  type EsSearchResult,
  type EsSort,
  type FileHit
} from '../lib/file-search-shared'

/** 防抖窗口。es.exe 单次取数实测 ~130ms，250ms 足够把连打收敛成一次。 */
const FILE_SEARCH_DEBOUNCE_MS = 250

/** 距底部还有这么多像素就续取下一页（提前量，别让用户看到「拉到底才转圈」）。 */
const LOAD_MORE_THRESHOLD_PX = 240

function FileSearchWindow(): React.JSX.Element {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [category, setCategory] = useState<EsCategory>('all')
  const [sortId, setSortId] = useState(ES_SORT_OPTIONS[0].id)
  const [hits, setHits] = useState<FileHit[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /** 回填顺序令牌：慢的那次回来时若已不是最新，直接丢弃（否则旧结果会盖掉新结果）。 */
  const tokenRef = useRef(0)
  /** 有请求在飞时不再续页（滚动事件很密，防重入）。 */
  const busyRef = useRef(false)
  /** 还有没有下一页：上一页取满一页就认为还有（总数读不到时的唯一判据）。 */
  const hasMoreRef = useRef(false)

  const sort = useMemo<EsSort>(
    () => ES_SORT_OPTIONS.find((option) => option.id === sortId)?.sort ?? DEFAULT_ES_SORT,
    [sortId]
  )

  // 滚动 / 键盘回调里要读「当下」的值，闭包里的 state 会是过期的 —— 用 ref 镜像一份。
  const queryRef = useRef({ keyword: '', category: 'all' as EsCategory, sort: DEFAULT_ES_SORT })
  const hitsRef = useRef<FileHit[]>([])
  const iconsRef = useRef<Record<string, string | null>>({})
  const selectedIndexRef = useRef(0)

  useEffect(() => {
    queryRef.current = { keyword: debouncedKeyword, category, sort }
  }, [debouncedKeyword, category, sort])
  useEffect(() => {
    hitsRef.current = hits
  }, [hits])
  useEffect(() => {
    iconsRef.current = icons
  }, [icons])
  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  // 连打收敛：输入停下来 250ms 才真去搜。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), FILE_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /** 打开命中项。`reveal` = 在资源管理器里定位（回车/单击的默认动作），否则用默认程序打开。 */
  const openHit = useCallback(async (hit: FileHit, reveal: boolean): Promise<void> => {
    try {
      await window.api.invoke('launcher:open-hit', { path: hit.fullPath, reveal })
    } catch {
      // 打开失败就保持窗口，让用户能换个操作重试。
      return
    }
    if (!reveal) void window.api.invoke('file-search:close', null)
  }, [])

  /** 取第一页 + 总数。关键词 / 分类 / 排序任意一项变了都走这里（偏移归零）。 */
  const runFirstPage = useCallback(
    async (nextKeyword: string, nextCategory: EsCategory, nextSort: EsSort): Promise<void> => {
      const token = (tokenRef.current += 1)
      busyRef.current = true
      setSearching(true)
      setError('')
      setSelectedIndex(0)

      try {
        const result = await window.api.invoke<EsSearchResult>('file-search:query', {
          keyword: nextKeyword,
          category: nextCategory,
          sort: nextSort,
          offset: 0,
          pageSize: FILE_SEARCH_PAGE_SIZE
        })
        if (token !== tokenRef.current) return

        if (!result?.ok) {
          setHits([])
          hasMoreRef.current = false
          setError(fileSearchFailureText(result ?? { ok: false, hits: [] }))
          return
        }
        setHits(result.hits)
        hasMoreRef.current = result.hits.length >= FILE_SEARCH_PAGE_SIZE
      } catch {
        if (token !== tokenRef.current) return
        setHits([])
        hasMoreRef.current = false
        setError('搜索失败')
      } finally {
        if (token === tokenRef.current) {
          busyRef.current = false
          setSearching(false)
        }
      }

      // 总数单独一次进程：只有关键词 / 分类变了才需要重算，翻页时不该跟着重跑。
      void window.api
        .invoke<{ total: number | null }>('file-search:count', {
          keyword: nextKeyword,
          category: nextCategory
        })
        .then((response) => {
          if (token === tokenRef.current) setTotal(response?.total ?? null)
        })
        .catch(() => {
          if (token === tokenRef.current) setTotal(null)
        })
    },
    []
  )

  /** 续取下一页（滚动到底时触发）。 */
  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMoreRef.current || busyRef.current) return

    const token = tokenRef.current
    const current = queryRef.current
    busyRef.current = true
    setLoadingMore(true)

    try {
      const result = await window.api.invoke<EsSearchResult>('file-search:query', {
        keyword: current.keyword,
        category: current.category,
        sort: current.sort,
        offset: hitsRef.current.length,
        pageSize: FILE_SEARCH_PAGE_SIZE
      })
      if (token !== tokenRef.current) return
      if (!result?.ok) return

      setHits((prev) => [...prev, ...result.hits])
      hasMoreRef.current = result.hits.length >= FILE_SEARCH_PAGE_SIZE
    } catch {
      // 续页失败保持现状：用户再滚一下会重试，不打断已看到的结果。
    } finally {
      if (token === tokenRef.current) {
        busyRef.current = false
        setLoadingMore(false)
      }
    }
  }, [])

  // 条件变化 ⇒ 重新搜第一页。
  useEffect(() => {
    void runFirstPage(debouncedKeyword, category, sort)
  }, [debouncedKeyword, category, sort, runFirstPage])

  // 拉到接近底部就续页。
  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const onScroll = (): void => {
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
        void loadMore()
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [loadMore])

  // 键盘：上下选择，回车 = 打开所在位置（默认动作，跟老大口径一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const list = hitsRef.current
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((prev) => (list.length ? Math.min(prev + 1, list.length - 1) : 0))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (event.key === 'Enter') {
        const hit = list[selectedIndexRef.current]
        if (!hit) return
        event.preventDefault()
        void openHit(hit, true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openHit])

  // 键盘选中的那一行要跟着滚进视野（否则连按 ↓ 会选到看不见的地方）。
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-hit-index="${selectedIndex}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // 图标按需批量取：新进视野的路径才问主进程要（已缓存的不再问）。
  // 目录**不问** —— Windows 对目录回的是 shell 那套通用图标，跟列表里其它行不搭；
  // 目录一律由渲染端 `<Folder />` 出图（见下方 iconSrc 分支），顺带省掉无意义的原生提取。
  useEffect(() => {
    const missing = hits
      .filter((hit) => !hit.isDir)
      .map((hit) => hit.fullPath)
      .filter((fullPath) => !(fullPath in iconsRef.current))
    if (missing.length === 0) return

    let cancelled = false
    void window.api
      .invoke<Record<string, string | null>>('file-search:icons', missing)
      .then((map) => {
        if (cancelled || !map) return
        setIcons((prev) => ({ ...prev, ...map }))
      })
      .catch(() => {
        // 拿不到图标就退回通用图标，不影响列表本身。
      })
    return () => {
      cancelled = true
    }
  }, [hits])

  // 原窗带过来的已输入文字（窗**已经开着**时走这条推送）。
  useEffect(() => {
    return window.api.on<{ keyword?: string }>('file-search:init', (payload) => {
      const next = (payload?.keyword ?? '').trim()
      if (!next) return
      setKeyword(next)
      inputRef.current?.focus()
    })
  }, [])

  // **首次开窗**时上面那条推送必丢 —— 推的时机（`did-finish-load`）早于这里挂上监听。所以挂载后
  // 再主动取一次主进程存的槽（取完即清空），这才是首次带词进来的可靠路径。
  useEffect(() => {
    void window.api.invoke<string>('file-search:take-initial-keyword', null).then((pending) => {
      const next = (pending ?? '').trim()
      if (!next) return
      setKeyword(next)
      inputRef.current?.focus()
    })
  }, [])

  const showEmpty = !error && hits.length === 0 && !searching

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 顶部：标识 + 搜索框（置顶 / 关闭交给系统标题栏，不再自绘） */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <Search className="size-4" />
          <span className="text-xs font-medium">文件搜索</span>
        </div>

        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索本机文件（文件名 / 通配符 / ext:pdf）"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-border bg-muted/40 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring/60 focus:bg-background"
          />
          {searching && (
            <Loader2 className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：分类（切换即重搜，偏移归零） */}
        <nav className="flex w-32 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
          {ES_CATEGORIES.map((item) => {
            const Icon = item.icon
            const active = item.id === category
            return (
              <button
                key={item.id}
                onClick={() => setCategory(item.id)}
                className={
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ' +
                  (active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')
                }
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* 结果列表 */}
        <div ref={listRef} className="min-w-0 flex-1 overflow-y-auto py-1">
          {error && <div className="px-4 py-3 text-xs text-destructive">{error}</div>}

          {!error && searching && hits.length === 0 && (
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              搜索中...
            </div>
          )}

          {showEmpty && (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              {debouncedKeyword.trim() || category !== 'all' ? '没有匹配的文件' : '输入关键词开始搜索'}
            </div>
          )}

          {hits.map((hit, index) => {
            const iconSrc = icons[hit.fullPath]
            const active = index === selectedIndex
            return (
              <div
                key={hit.fullPath}
                data-hit-index={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onDoubleClick={() => void openHit(hit, false)}
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
                    onClick={() => void openHit(hit, true)}
                    title="打开所在位置"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <FolderOpen className="size-3.5" />
                  </button>
                  <button
                    onClick={() => void openHit(hit, false)}
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
      </div>

      {/* 底栏：排序 + 结果总数（总数读不到就退化成「已加载 N 条」，不编数字） */}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <select
          value={sortId}
          onChange={(event) => setSortId(event.target.value)}
          className="rounded border border-border bg-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground"
        >
          {ES_SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id} className="text-foreground">
              {option.label}
            </option>
          ))}
        </select>

        <span className="shrink-0 tabular-nums">
          {total !== null
            ? `共 ${total.toLocaleString()} 条结果`
            : hits.length > 0
              ? `已加载 ${hits.length} 条`
              : ''}
        </span>
      </footer>
    </div>
  )
}

// 先同步主题再渲染，避免深色主题下先闪一帧浅色。
void syncThemeFromSettings().finally(() => {
  const root = createRoot(document.getElementById('root')!)
  root.render(<FileSearchWindow />)
})
