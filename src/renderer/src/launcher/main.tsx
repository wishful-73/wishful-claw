import '../assets/main.css'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Search,
  CornerDownLeft,
  Settings,
  ArrowLeft,
  Plus,
  Trash2,
  FileText,
  AppWindow,
  Download,
  RefreshCw,
  Check,
  AlertCircle,
  Folder,
  Loader2
} from 'lucide-react'
import { syncThemeFromSettings } from '../lib/theme-sync'

interface AppShortcut {
  name: string
  path: string
  iconDataUrl?: string
  isHistory?: boolean
  isSystem?: boolean
}

interface CustomApp {
  name: string
  path: string
}

type SearchMode = 'app' | 'file'

type EverythingExeSource =
  | 'manual'
  | 'registry'
  | 'service'
  | 'process'
  | 'shortcut'
  | 'program-files'
  | 'path'
  | 'scan'

interface EverythingStatus {
  /** 平台是否支持（本需求只做 Windows）。 */
  supported: boolean
  ready: boolean
  exePath: string | null
  source: EverythingExeSource | null
  /** exePath 是「本机检测」自动绑定的（跟「手动指定」区分显示）。 */
  detected: boolean
}

type EsExeSource = 'manual' | 'builtin' | 'alongside' | 'program-files' | 'path' | 'scan'

/** es.exe（取数用）的探测状态 —— 与 Everything 本体是两个槽位，可以只有一个就绪。 */
interface EsStatus {
  supported: boolean
  ready: boolean
  exePath: string | null
  source: EsExeSource | null
  /** exePath 是「本机检测」自动绑定的（跟「手动指定」区分显示）。 */
  detected: boolean
}

interface FileHit {
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
interface EsSearchResult {
  ok: boolean
  hits: FileHit[]
  failure?: 'not-running' | 'spawn-failed' | 'bad-output' | 'search-failed'
  error?: string
}

const ES_SOURCE_LABEL: Record<EsExeSource, string> = {
  manual: '手动指定',
  builtin: '应用内置',
  alongside: '随 Everything 安装',
  'program-files': '安装目录',
  path: 'PATH',
  scan: '本机扫描'
}

/** 来源文案：自动绑定的那条一律显示「本机检测」，比「手动指定」诚实。 */
function esSourceLabel(status: EsStatus): string {
  if (status.detected) return '本机检测'
  return status.source ? ES_SOURCE_LABEL[status.source] : ''
}

/** 文件搜索的防抖窗口。es.exe 单次取数实测 ~130ms，250ms 足够把连打收敛成一次。 */
const FILE_SEARCH_DEBOUNCE_MS = 250

/** 取数失败 → 给用户看的话。不甩 exit code 这种内部细节，但说清「下一步能做什么」。 */
function fileSearchFailureText(result: EsSearchResult): string {
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

/** 字节数 → 人类可读。目录没有大小，显示空串。 */
function formatHitSize(size: number | null): string {
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

/** epoch 毫秒 → `YYYY-MM-DD HH:mm`。 */
function formatHitTime(mtime: number | null): string {
  if (mtime === null || !Number.isFinite(mtime)) return ''
  const date = new Date(mtime)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

const EVERYTHING_SOURCE_LABEL: Record<EverythingExeSource, string> = {
  manual: '手动指定',
  registry: '注册表',
  service: '服务',
  process: '正在运行',
  shortcut: '快捷方式',
  'program-files': '安装目录',
  path: 'PATH',
  scan: '本机扫描'
}

/** 来源文案：自动绑定的那条一律显示「本机检测」，比「手动指定」诚实。 */
function everythingSourceLabel(status: EverythingStatus): string {
  if (status.detected) return '本机检测'
  return status.source ? EVERYTHING_SOURCE_LABEL[status.source] : ''
}

function QuickLauncher(): React.JSX.Element {
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AppShortcut[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [recentApps, setRecentApps] = useState<AppShortcut[]>([])

  // ── S-151：应用 / 文件 两种模式 ──
  const [mode, setMode] = useState<SearchMode>('app')
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null)
  const [fileSearchError, setFileSearchError] = useState('')
  const [detecting, setDetecting] = useState(false)

  // ── S-155：文件结果由我们自己渲染（es.exe 取数）──
  const [esStatus, setEsStatus] = useState<EsStatus | null>(null)
  const [hits, setHits] = useState<FileHit[]>([])
  const [searching, setSearching] = useState(false)
  /** 回填顺序令牌：慢的那次回来时若已不是最新，直接丢弃（否则旧结果会盖掉新结果）。 */
  const searchTokenRef = useRef(0)

  // 「重新检测」：轻探重跑一遍（含探测缓存失效）。
  //
  // 不能走 `launcher:get-everything-status` —— 它吃 30s 探测缓存，用户点了「重新检测」却拿到
  // 点之前的结果（典型场景：刚装完 / 刚卸掉 Everything，翻天覆地了界面还咬着旧结论）。
  // 「本机检测」是重探（多一层扫盘 + 命中就绑定），这个是轻探，两者不是一回事。
  const refreshEverythingStatus = useCallback(async (): Promise<void> => {
    const status = await window.api.invoke<EverythingStatus>(
      'launcher:refresh-everything-status',
      null
    )
    setEverythingStatus(status)
  }, [])

  // es.exe 版「重新检测」（S-155）：同上，绕开 30s 探测缓存，用户点了就拿到当下结论。
  const refreshEsStatus = useCallback(async (): Promise<void> => {
    const status = await window.api.invoke<EsStatus>('launcher:refresh-es-status', null)
    setEsStatus(status)
  }, [])

  // 「本机检测」：重探（含扫盘）→ 命中就直接绑定，用户什么都不用选。扫盘是秒级的，所以要有
  // loading 态，否则用户以为点了没反应。
  const detectEverything = useCallback(async (): Promise<void> => {
    setDetecting(true)
    setFileSearchError('')
    try {
      const status = await window.api.invoke<EverythingStatus>('launcher:detect-everything', null)
      setEverythingStatus(status)
    } finally {
      setDetecting(false)
    }
  }, [])

  const switchMode = useCallback(
    (next: SearchMode): void => {
      if (next === mode) return
      setMode(next)
      setFileSearchError('')
      setSelectedIndex(0)
      void window.api.invoke('launcher:update-config', { searchMode: next })
      if (next === 'file') {
        void refreshEverythingStatus()
        void refreshEsStatus()
      }
    },
    [mode, refreshEverythingStatus, refreshEsStatus]
  )

  const doSearch = useCallback(async (q: string): Promise<void> => {
    const apps = await window.api.invoke<AppShortcut[]>('launcher:search', q)
    setResults(apps as AppShortcut[])
    setSelectedIndex(0)
  }, [])

  const loadRecent = useCallback(async (): Promise<void> => {
    const apps = await window.api.invoke<AppShortcut[]>('launcher:get-recent', null)
    setRecentApps(apps as AppShortcut[])
  }, [])

  // Retry focus until it actually lands. Focus loss is intermittent because the
  // transparent alwaysOnTop window may not be fully activated when the first
  // focus() call arrives — keep trying for up to ~800ms.
  const focusInputUntilActive = useCallback((): void => {
    const deadline = Date.now() + 800
    const attempt = (): void => {
      if (inputRef.current && document.activeElement === inputRef.current) return
      inputRef.current?.focus({ preventScroll: true })
      if (Date.now() < deadline) requestAnimationFrame(attempt)
    }
    attempt()
  }, [])

  const handleLaunch = useCallback(async (app: AppShortcut): Promise<void> => {
    await window.api.invoke<boolean>('launcher:launch', app.path)
  }, [])

  useEffect(() => {
    focusInputUntilActive()
    void loadRecent()
    // 模式是持久的：上次停在文件模式，这次唤起就该还在文件模式。
    void window.api.invoke<{ searchMode?: SearchMode }>('launcher:get-config', null).then((config) => {
      const saved: SearchMode = config.searchMode === 'file' ? 'file' : 'app'
      setMode(saved)
      if (saved === 'file') {
        void refreshEverythingStatus()
        void refreshEsStatus()
      }
    })
  }, [focusInputUntilActive, loadRecent, refreshEverythingStatus, refreshEsStatus])

  useEffect(() => {
    if (view !== 'list') return
    focusInputUntilActive()
  }, [view, focusInputUntilActive])

  // Re-focus when the OS window itself regains focus (e.g. after blur-hide-show)
  useEffect(() => {
    const onWindowFocus = (): void => {
      if (view === 'list') focusInputUntilActive()
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [view, focusInputUntilActive])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setResults([])
      setSelectedIndex(0)
      return
    }
    const timer = setTimeout(() => doSearch(query), 120)
    return () => clearTimeout(timer)
  }, [query, doSearch])

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Reset input and focus when window becomes visible (triggered by main on 'show')
  useEffect(() => {
    const cleanup = window.api.on<null>('launcher:reset', () => {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setView('list')
      setFileSearchError('')
      void loadRecent()
      // 面板每次唤起都要面对「用户刚装完 / 刚删掉 Everything」的现实，但探测本身有 TTL，
      // 在文件模式下才顺手问一次。
      if (mode === 'file') {
        void refreshEverythingStatus()
        void refreshEsStatus()
      }
      // Retry focus until it lands — covers the settings→list view transition
      // and the window-not-yet-activated race
      focusInputUntilActive()
    })
    return cleanup
  }, [mode, loadRecent, refreshEverythingStatus, focusInputUntilActive])

  /**
   * 文件模式的取数（S-155）：**输入即搜**，防抖 250ms。
   *
   * 与 S-151 的「回车才投出去」不同 —— 现在结果是我们自己渲染的，没有「投出去」这个动作，
   * 回车改成「打开选中的那一条」。es.exe 单次 ~130ms，250ms 的坎足够把连打收敛成一次。
   */
  const esReady = esStatus?.ready === true

  useEffect(() => {
    if (mode !== 'file') return
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      setFileSearchError('')
      setSearching(false)
      return
    }
    // es.exe 没就绪时不取数 —— 此时界面走「投递式」降级（见 FileSearchPanel）。
    if (!esReady) return

    const timer = setTimeout(() => {
      const token = ++searchTokenRef.current
      setSearching(true)
      void window.api
        .invoke<EsSearchResult>('launcher:search-files', trimmed)
        .then((result) => {
          // 过期回填直接丢：慢的那次回来时，新关键词的结果可能已经在屏幕上了。
          if (token !== searchTokenRef.current) return
          if (result.ok) {
            setHits(result.hits)
            setFileSearchError('')
            setSelectedIndex(0)
          } else {
            setHits([])
            setFileSearchError(fileSearchFailureText(result))
          }
        })
        .finally(() => {
          if (token === searchTokenRef.current) setSearching(false)
        })
    }, FILE_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, mode, esReady])

  /** 点结果项：`reveal` 时定位到所在目录，否则用系统默认程序打开。成功了就收起面板。 */
  const openHit = useCallback(async (hit: FileHit, reveal: boolean): Promise<void> => {
    const result = await window.api.invoke<{ success: boolean; error?: string }>(
      'launcher:open-hit',
      { path: hit.fullPath, reveal }
    )
    if (result.success) {
      void window.api.invoke('launcher:hide', null)
    } else {
      setFileSearchError(`打开失败：${result.error ?? '未知原因'}`)
    }
  }, [])

  /** 降级档（S-155 §七 裁定②）：拿不到 es.exe，就把关键词交给 Everything 自己的窗口。 */
  const openInEverything = useCallback(async (): Promise<void> => {
    if (!query.trim()) return
    setFileSearchError('')
    const result = await window.api.invoke<{ success: boolean; error?: string }>(
      'launcher:open-in-everything',
      query
    )
    // 成功时主进程已经把面板收起来了；只有失败才留在屏幕上说明原因。
    if (!result.success) {
      setFileSearchError(
        result.error === 'not-ready'
          ? '未检测到 Everything，无法搜索文件'
          : `启动 Everything 失败：${result.error ?? '未知原因'}`
      )
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab') {
      // 模式切换挂在 Tab 上：聚焦输入框时 Tab 本来没有别的用途。
      e.preventDefault()
      switchMode(mode === 'app' ? 'file' : 'app')
      return
    }
    if (mode === 'file') {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, hits.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const hit = hits[selectedIndex]
        if (hit) {
          // Ctrl/Cmd + Enter 打开所在目录（列表快捷键的通用约定）。
          void openHit(hit, e.ctrlKey || e.metaKey)
        } else if (!esReady) {
          // 没有结果列表（es 未就绪）时，回车是「交给 Everything 去搜」。
          void openInEverything()
        }
      } else if (e.key === 'Escape') {
        if (query) {
          setQuery('')
          setFileSearchError('')
        } else {
          void window.api.invoke('launcher:hide', null)
        }
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[selectedIndex]) {
        handleLaunch(results[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      if (query) {
        setQuery('')
      } else {
        void window.api.invoke('launcher:hide', null)
      }
    }
  }

  const hasQuery = query.trim().length > 0

  // ── Settings View ──
  if (view === 'settings') {
    return <LauncherSettings onBack={() => setView('list')} />
  }

  // ── List View ──
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-border bg-background/95">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          <button
            onClick={() => switchMode('app')}
            title="搜索应用（Tab 切换）"
            className={
              'flex items-center gap-1 rounded-[6px] px-2 py-1 text-[10px] transition-colors ' +
              (mode === 'app'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            <AppWindow className="size-3" />
            应用
          </button>
          <button
            onClick={() => switchMode('file')}
            title="搜索文件（Tab 切换）"
            className={
              'flex items-center gap-1 rounded-[6px] px-2 py-1 text-[10px] transition-colors ' +
              (mode === 'file'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            <FileText className="size-3" />
            文件
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'file' ? '搜索文件...' : '搜索应用...'}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoFocus
        />
        <button
          onClick={() => setView('settings')}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="设置"
        >
          <Settings className="size-3.5" />
        </button>
      </div>

      {mode === 'file' ? (
        <FileSearchPanel
          everythingStatus={everythingStatus}
          esStatus={esStatus}
          hits={hits}
          query={query}
          error={fileSearchError}
          searching={searching}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpenHit={(hit, reveal) => void openHit(hit, reveal)}
          onOpenInEverything={() => void openInEverything()}
          detecting={detecting}
          onRefreshEverything={() => void refreshEverythingStatus()}
          onDetectEverything={() => void detectEverything()}
        />
      ) : hasQuery ? (
        <>
          <div ref={listRef} className="flex-1 overflow-y-auto py-1">
            {results.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                无搜索结果
              </div>
            ) : (
              results.map((app, index) => (
                <div
                  key={app.path}
                  onClick={() => handleLaunch(app)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={
                    'flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition-colors ' +
                    (index === selectedIndex
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50')
                  }
                >
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs text-muted-foreground">
                    {app.iconDataUrl ? (
                      <img src={app.iconDataUrl} alt="" className="size-7 object-contain" draggable={false} />
                    ) : (
                      app.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  {app.isHistory && (
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                      历史
                    </span>
                  )}
                  {app.isSystem && (
                    <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] leading-none text-primary">
                      系统
                    </span>
                  )}
                  {index === selectedIndex && (
                    <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
            <span>{'\u2191\u2193'} 选择 {'\u00b7'} Enter 启动 {'\u00b7'} Tab 切换模式</span>
            <span>WishfulClaw Quick Search</span>
          </div>
        </>
      ) : (
        recentApps.length > 0 && (
          <div className="flex-1 overflow-x-auto px-4 py-3">
            <p className="mb-2 text-[10px] text-muted-foreground">最近使用</p>
            <div className="flex gap-2">
              {recentApps.map((app) => (
                <button
                  key={app.path}
                  onClick={() => handleLaunch(app)}
                  className="flex w-16 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-accent"
                  title={app.name}
                >
                  <div className="flex size-9 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {app.iconDataUrl ? (
                      <img src={app.iconDataUrl} alt="" className="size-7 object-contain" draggable={false} />
                    ) : (
                      <span className="text-xs text-muted-foreground">{app.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="w-full truncate text-center text-[10px] text-muted-foreground">{app.name}</span>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ── 文件搜索面板（S-155）──
//
// 三档降级（S-155 §七 裁定②）：
//   es.exe 就绪                 → 我们自己渲染结果列表
//   Everything 就绪但 es 不就绪 → 退回投递式（回车交给 Everything 自己的窗口）
//   两者都没有                  → 引导页（下载 Everything / 本机检测）

function FileSearchPanel({
  everythingStatus,
  esStatus,
  hits,
  query,
  error,
  searching,
  selectedIndex,
  onSelect,
  onOpenHit,
  onOpenInEverything,
  detecting,
  onRefreshEverything,
  onDetectEverything
}: {
  everythingStatus: EverythingStatus | null
  esStatus: EsStatus | null
  hits: FileHit[]
  query: string
  error: string
  searching: boolean
  selectedIndex: number
  onSelect: (index: number) => void
  onOpenHit: (hit: FileHit, reveal: boolean) => void
  onOpenInEverything: () => void
  detecting: boolean
  onRefreshEverything: () => void
  onDetectEverything: () => void
}): React.JSX.Element {
  const trimmed = query.trim()
  const esReady = esStatus?.ready === true
  const everythingReady = everythingStatus?.ready === true
  const esLabel = esStatus ? esSourceLabel(esStatus) : ''

  if (!everythingStatus) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        正在检测 Everything...
      </div>
    )
  }

  if (!everythingStatus.supported) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <AlertCircle className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">文件搜索目前仅支持 Windows</p>
      </div>
    )
  }

  // ① es.exe 就绪：结果列表（这是我们自己渲染的那一档）。
  if (esReady) {
    return (
      <>
        <div className="flex-1 overflow-y-auto py-1">
          {searching && hits.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              搜索中...
            </div>
          ) : hits.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-muted-foreground">
              <span>{trimmed ? '没有匹配的文件' : '输入关键词开始搜索'}</span>
              {error && <span className="text-destructive">{error}</span>}
            </div>
          ) : (
            hits.map((hit, index) => (
              <div
                key={hit.fullPath}
                onClick={() => onOpenHit(hit, false)}
                onMouseEnter={() => onSelect(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onOpenHit(hit, true)
                }}
                title={hit.fullPath}
                className={
                  'flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors ' +
                  (index === selectedIndex
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50')
                }
              >
                <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {hit.isDir ? (
                    <Folder className="size-4 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{hit.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{hit.dir}</p>
                </div>
                <div className="shrink-0 text-right text-[10px] leading-tight text-muted-foreground">
                  {hit.size !== null && <p>{formatHitSize(hit.size)}</p>}
                  {hit.mtime !== null && <p>{formatHitTime(hit.mtime)}</p>}
                </div>
                {index === selectedIndex && (
                  <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <span>
            {hits.length > 0 ? `共 ${hits.length} 条 · ` : ''}
            {'\u2191\u2193'} 选择 · Enter 打开 · Ctrl+Enter 定位 · Tab 切换模式
          </span>
          <span className="truncate" title={esStatus?.exePath ?? ''}>
            {esLabel ? `${esLabel} · ` : ''}
            {esStatus?.exePath}
          </span>
        </div>
      </>
    )
  }

  // ② Everything 在、内置 es.exe 不可用（被安全软件清理 / 版本失效）：退回投递式。
  if (everythingReady) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">文件搜索</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            内置的搜索组件没起来，已退回用 Everything 自己的窗口搜 —— 回车把「{trimmed || '…'}」
            交过去。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenInEverything}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground transition-opacity hover:opacity-90"
            >
              <CornerDownLeft className="size-3" />
              用 Everything 搜索
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            这多半是杀毒软件把内置组件清掉了。重启一下应用通常能恢复。
          </p>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </div>
      </div>
    )
  }

  // ③ 两者都没有：引导页。
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-foreground">文件搜索需要 Everything</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          全盘文件名秒级出结果，支持通配符、正则，也能按大小和时间排序。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={onDetectEverything}
            disabled={detecting}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Search className="size-3" />
            {detecting ? '正在本机检测...' : '本机检测'}
          </button>
          <button
            onClick={() => void window.api.invoke('launcher:open-everything-download', null)}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3" />
            下载并安装
          </button>
          <button
            onClick={onRefreshEverything}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3" />
            重新检测
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          装过 Everything？点「本机检测」会自动认出来 —— 不需要你去找路径。
        </p>
        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}


// ── Launcher Settings Page ──

function LauncherSettings({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [customApps, setCustomApps] = useState<CustomApp[]>([])
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null)
  const [esStatus, setEsStatus] = useState<EsStatus | null>(null)
  const [pickError, setPickError] = useState('')
  const [esError, setEsError] = useState('')
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    void window.api.invoke<CustomApp[]>('launcher:get-custom-apps', null).then((apps) => {
      setCustomApps(apps)
    })
    void window.api.invoke<EverythingStatus>('launcher:get-everything-status', null).then((status) => {
      setEverythingStatus(status)
    })
    void window.api.invoke<EsStatus>('launcher:get-es-status', null).then((status) => {
      setEsStatus(status)
    })
  }, [])

  const handleAddApp = useCallback(async (): Promise<void> => {
    const result = await window.api.invoke<{ canceled: boolean; path?: string; name?: string }>('launcher:pick-exe', null)
    if (result.canceled || !result.path || !result.name) return
    const updated = await window.api.invoke<CustomApp[]>('launcher:add-custom-app', { name: result.name, path: result.path })
    setCustomApps(updated)
  }, [])

  const handleRemoveApp = useCallback(async (appPath: string): Promise<void> => {
    const updated = await window.api.invoke<CustomApp[]>('launcher:remove-custom-app', appPath)
    setCustomApps(updated)
  }, [])

  const handlePickEverything = useCallback(async (): Promise<void> => {
    setPickError('')
    const result = await window.api.invoke<{
      canceled: boolean
      status: EverythingStatus
      error?: string
    }>('launcher:pick-everything-exe', null)
    if (result.canceled) return
    setEverythingStatus(result.status)
    if (result.error === 'not-everything-exe') {
      setPickError('请选择 Everything.exe 或 Everything64.exe')
    }
  }, [])

  const handleClearEverything = useCallback(async (): Promise<void> => {
    setPickError('')
    const status = await window.api.invoke<EverythingStatus>('launcher:clear-everything-exe', null)
    setEverythingStatus(status)
  }, [])

  // 「本机检测」：重探（含扫盘），命中就直接绑定 —— 用户不用自己去找路径。
  const handleDetectEverything = useCallback(async (): Promise<void> => {
    setPickError('')
    setDetecting(true)
    try {
      const status = await window.api.invoke<EverythingStatus>('launcher:detect-everything', null)
      setEverythingStatus(status)
    } finally {
      setDetecting(false)
    }
  }, [])

  const handlePickEs = useCallback(async (): Promise<void> => {
    setEsError('')
    const result = await window.api.invoke<{
      canceled: boolean
      status: EsStatus
      error?: string
    }>('launcher:set-es-exe', null)
    if (result.canceled) return
    setEsStatus(result.status)
    if (result.error === 'not-es-exe') {
      setEsError('请选择 es.exe（Everything 官方命令行版）')
    }
  }, [])

  const handleClearEs = useCallback(async (): Promise<void> => {
    setEsError('')
    const status = await window.api.invoke<EsStatus>('launcher:clear-es-exe', null)
    setEsStatus(status)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-border bg-background/95">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          返回
        </button>
        <span className="flex-1 text-sm font-medium text-foreground">快速搜索设置</span>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-5">
          {/* Custom apps */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <label className="block text-sm text-foreground">自定义启动项</label>
                <p className="text-[11px] text-muted-foreground">添加绿色版或未在开始菜单中的应用</p>
              </div>
              <button
                onClick={() => void handleAddApp()}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3" />
                添加
              </button>
            </div>
            {customApps.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                暂无自定义启动项，点击"添加"选择 EXE 文件
              </div>
            ) : (
              <div className="space-y-1">
                {customApps.map((app) => (
                  <div
                    key={app.path}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{app.name}</span>
                    <span className="min-w-0 max-w-[200px] truncate text-[10px] text-muted-foreground">{app.path}</span>
                    <button
                      onClick={() => void handleRemoveApp(app.path)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* File search (S-151) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <label className="block text-sm text-foreground">文件搜索</label>
                <p className="text-[11px] text-muted-foreground">
                  复用本机 Everything 的索引，全盘文件名秒级出结果
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void handleDetectEverything()}
                  disabled={detecting}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                >
                  <Search className="size-3" />
                  {detecting ? '检测中...' : '本机检测'}
                </button>
                <button
                  onClick={() => void handlePickEverything()}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3" />
                  指定路径
                </button>
              </div>
            </div>

            {everythingStatus === null ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                正在检测...
              </div>
            ) : !everythingStatus.supported ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                文件搜索目前仅支持 Windows
              </div>
            ) : everythingStatus.ready ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <Check className="size-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground">
                    已就绪
                    {everythingStatus.source && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        （{everythingSourceLabel(everythingStatus)}）
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground" title={everythingStatus.exePath ?? ''}>
                    {everythingStatus.exePath}
                  </p>
                </div>
                {everythingStatus.source === 'manual' && (
                  <button
                    onClick={() => void handleClearEverything()}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    title={everythingStatus.detected ? '清除本机检测到的路径' : '清除手动指定的路径'}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" />
                  <p className="flex-1 text-xs text-foreground">未检测到 Everything</p>
                  <button
                    onClick={() => void window.api.invoke('launcher:open-everything-download', null)}
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    去下载
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  「本机检测」会扫一遍注册表、快捷方式、正在运行的进程和常见目录，装了就直接绑上 ——
                  不用自己去找路径。实在探不到（比如改了名）再点「指定路径」。
                </p>
              </div>
            )}

            {pickError && <p className="mt-1.5 text-[11px] text-destructive">{pickError}</p>}

            {/* 结果列表（S-155）：用官方命令行版 es.exe 取数，结果由我们自己渲染 */}
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                {esStatus?.ready ? (
                  <Check className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground">
                    {esStatus === null
                      ? '正在检测...'
                      : esStatus.ready
                        ? '结果列表已启用'
                        : '结果列表未启用'}
                    {esStatus && esStatus.ready && esSourceLabel(esStatus) && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        （{esSourceLabel(esStatus)}）
                      </span>
                    )}
                  </p>
                  {esStatus && esStatus.ready && (
                    <p
                      className="truncate text-[10px] text-muted-foreground"
                      title={esStatus.exePath ?? ''}
                    >
                      {esStatus.exePath}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void handlePickEs()}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-2.5" />
                    指定路径
                  </button>
                  {esStatus?.source === 'manual' && (
                    <button
                      onClick={() => void handleClearEs()}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      title="清除手动指定的路径"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                {esStatus?.ready
                  ? '搜索结果直接在面板里列出来，不再跳到 Everything 自己的窗口。Everything 没开的话，我们会替你启动它。'
                  : '内置的搜索组件没起来（多半被安全软件清理），重启应用通常能恢复，也可以手动指定一份 es.exe 顶掉它。'}
              </p>
              {esError && <p className="mt-1 text-[10px] text-destructive">{esError}</p>}
            </div>
          </div>

          {/* Hint */}
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">
              启动过的应用会自动记录到历史中，下次无需添加即可搜索到。自定义启动项和启动历史都会参与搜索。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Sync theme from main app settings before rendering to avoid flash
void syncThemeFromSettings().finally(() => {
  const root = createRoot(document.getElementById('root')!)
  root.render(<QuickLauncher />)
})
