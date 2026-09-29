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
  FileSearch,
  Check,
  AlertCircle
} from 'lucide-react'
import { syncThemeFromSettings } from '../lib/theme-sync'

interface AppShortcut {
  name: string
  path: string
  iconDataUrl?: string
  isHistory?: boolean
  isSystem?: boolean
}

/**
 * 「搜索文件」在启动页里就是**一个应用**（S-155 调整⑥）：跟最近使用那几个砖同排、同形态，
 * 不再单独占一整行。
 *
 * 它没有真实可执行文件，所以 `path` 给哨兵值 —— 直接丢给 `launcher:launch` 会变成一次
 * 「启动不存在的程序」，由 `handleLaunch` 认出来改开文件搜索窗。
 */
const FILE_SEARCH_APP_PATH = '__wishful_file_search__'

const FILE_SEARCH_ENTRY: AppShortcut = { name: '搜索文件', path: FILE_SEARCH_APP_PATH }

interface CustomApp {
  name: string
  path: string
}

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

  /**
   * 开文件搜索独立窗（S-155 调整⑤）。
   *
   * 已输入的文字一起带过去 —— 用户在原窗打了一半才发现要搜文件，不该让他重打。
   * 主进程收到就会把原窗收起来（`hideLauncherWindow`），这里不用自己 hide。
   */
  const openFileSearch = useCallback((): void => {
    void window.api.invoke('launcher:open-file-search', { keyword: query })
  }, [query])

  const doSearch = useCallback(async (q: string): Promise<void> => {
    const apps = await window.api.invoke<AppShortcut[]>('launcher:search', q)
    const list = apps as AppShortcut[]
    // 「搜索文件」**恒在**搜索结果里（S-155 调整⑥，老大两条口径）：有结果就吊在末尾，不抢真正
    // 命中应用的焦点；一条都没搜到时它占首位（那时它是唯一一项）—— 这种时候用户要的正是「那我去
    // 搜文件吧」这个出口，甩一句「无搜索结果」等于把人堵死。
    setResults(list.length > 0 ? [...list, FILE_SEARCH_ENTRY] : [FILE_SEARCH_ENTRY])
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

  const handleLaunch = useCallback(
    async (app: AppShortcut): Promise<void> => {
      // 「搜索文件」是个哨兵项，没有真实 exePath（见 FILE_SEARCH_ENTRY）。
      if (app.path === FILE_SEARCH_APP_PATH) {
        openFileSearch()
        return
      }
      await window.api.invoke<boolean>('launcher:launch', app.path)
    },
    [openFileSearch]
  )

  useEffect(() => {
    focusInputUntilActive()
    void loadRecent()
  }, [focusInputUntilActive, loadRecent])

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
      void loadRecent()
      // Retry focus until it lands — covers the settings→list view transition
      // and the window-not-yet-activated race
      focusInputUntilActive()
    })
    return cleanup
  }, [loadRecent, focusInputUntilActive])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Tab：带着已输入的文字去文件搜索（沿用它原本「切模式」的键位，语义没变）。
    if (e.key === 'Tab') {
      e.preventDefault()
      openFileSearch()
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
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索应用..."
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

      {hasQuery ? (
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
                    {app.path === FILE_SEARCH_APP_PATH ? (
                      <FileSearch className="size-4 text-primary" />
                    ) : app.iconDataUrl ? (
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
            <span>{'\u2191\u2193'} 选择 {'\u00b7'} Enter 启动 {'\u00b7'} Tab 搜索文件</span>
            <span>WishfulClaw Quick Search</span>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* S-155 调整⑥：「搜索文件」跟最近使用同排、同形态 —— 它就是一个应用，不单独占一行。 */}
          <p className="mb-2 text-[10px] text-muted-foreground">快捷入口</p>
          <div className="flex flex-wrap gap-2">
            {[FILE_SEARCH_ENTRY, ...recentApps].map((app) => (
              <button
                key={app.path}
                onClick={() => void handleLaunch(app)}
                className="flex w-16 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-accent"
                title={app.name}
              >
                <div className="flex size-9 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {app.path === FILE_SEARCH_APP_PATH ? (
                    <FileSearch className="size-5 text-primary" />
                  ) : app.iconDataUrl ? (
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
      )}
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
