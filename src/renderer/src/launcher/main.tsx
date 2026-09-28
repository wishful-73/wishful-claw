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
      if (next === 'file') void refreshEverythingStatus()
    },
    [mode, refreshEverythingStatus]
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
      if (saved === 'file') void refreshEverythingStatus()
    })
  }, [focusInputUntilActive, loadRecent, refreshEverythingStatus])

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
      if (mode === 'file') void refreshEverythingStatus()
      // Retry focus until it lands — covers the settings→list view transition
      // and the window-not-yet-activated race
      focusInputUntilActive()
    })
    return cleanup
  }, [mode, loadRecent, refreshEverythingStatus, focusInputUntilActive])

  const submitFileSearch = useCallback(async (): Promise<void> => {
    if (!query.trim()) return
    setFileSearchError('')
    const result = await window.api.invoke<{ success: boolean; error?: string }>(
      'launcher:search-files',
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
      if (e.key === 'Enter') {
        e.preventDefault()
        void submitFileSearch()
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
          status={everythingStatus}
          query={query}
          error={fileSearchError}
          detecting={detecting}
          onRefresh={() => void refreshEverythingStatus()}
          onDetect={() => void detectEverything()}
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

// ── File search panel (S-151) ──
//
// 我们**不渲染结果**：命中由 Everything 自己的窗口呈现。这里只有三种状态 ——
// 未探到（下载 / 本机检测）、就绪（提示回车把关键词投出去）、失败（说清原因）。

function FileSearchPanel({
  status,
  query,
  error,
  detecting,
  onRefresh,
  onDetect
}: {
  status: EverythingStatus | null
  query: string
  error: string
  detecting: boolean
  onRefresh: () => void
  onDetect: () => void
}): React.JSX.Element {
  const trimmed = query.trim()

  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        正在检测 Everything...
      </div>
    )
  }

  if (!status.supported) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <AlertCircle className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">文件搜索目前仅支持 Windows</p>
      </div>
    )
  }

  if (!status.ready) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">文件搜索需要 Everything</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            我们不做自己的文件索引 —— 装了 Everything 就直接把关键词交给它，搜索由它完成。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onDetect}
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
              onClick={onRefresh}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              重新检测
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            「本机检测」会扫一遍本机的注册表、快捷方式、正在运行的进程和常见目录 —— 已经装了的话
            直接就绑上，不需要你去找路径。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-3 px-6">
      <div className="flex items-center justify-center gap-1.5 text-xs text-foreground">
        <CornerDownLeft className="size-3.5 text-muted-foreground" />
        <span>按回车用 Everything 搜索「{trimmed || '…'}」</span>
      </div>
      <p className="text-center text-[10px] text-muted-foreground">
        结果会显示在 Everything 窗口中
      </p>
      {error && <p className="text-center text-[10px] text-destructive">{error}</p>}
      <p className="truncate text-center text-[10px] text-muted-foreground" title={status.exePath ?? ''}>
        {everythingSourceLabel(status) ? `${everythingSourceLabel(status)} · ` : ''}
        {status.exePath}
      </p>
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <Check className="size-3" />
        <button onClick={onRefresh} className="underline-offset-2 hover:underline">
          重新检测
        </button>
      </div>
    </div>
  )
}


// ── Launcher Settings Page ──

function LauncherSettings({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [customApps, setCustomApps] = useState<CustomApp[]>([])
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null)
  const [pickError, setPickError] = useState('')
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    void window.api.invoke<CustomApp[]>('launcher:get-custom-apps', null).then((apps) => {
      setCustomApps(apps)
    })
    void window.api.invoke<EverythingStatus>('launcher:get-everything-status', null).then((status) => {
      setEverythingStatus(status)
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
                  由 Everything 完成搜索，我们不建自己的索引
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
