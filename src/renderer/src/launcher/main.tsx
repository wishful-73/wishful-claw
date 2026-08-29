import '../assets/main.css'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Search, CornerDownLeft, Settings, ArrowLeft, Plus, Trash2 } from 'lucide-react'
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

function QuickLauncher(): React.JSX.Element {
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AppShortcut[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [recentApps, setRecentApps] = useState<AppShortcut[]>([])

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
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
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
            <span>{'\u2191\u2193'} 选择 {'\u00b7'} Enter 启动</span>
            <span>WishfulClaw Quick Launcher</span>
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

// ── Launcher Settings Page ──

function LauncherSettings({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [customApps, setCustomApps] = useState<CustomApp[]>([])

  useEffect(() => {
    void window.api.invoke<CustomApp[]>('launcher:get-custom-apps', null).then((apps) => {
      setCustomApps(apps)
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
