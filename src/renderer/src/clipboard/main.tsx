import '../assets/main.css'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Clipboard, Trash2, X, Settings, ArrowLeft, Pin } from 'lucide-react'
import { syncThemeFromSettings } from '../lib/theme-sync'

interface ClipboardEntry {
  id: string
  text: string
  timestamp: number
  preview: string
  lastUsed?: number
  pinned?: boolean
}

interface ClipboardConfig {
  enabled: boolean
  maxDays: number
  maxItems: number
  accelerators: string[]
  hideOnBlur: boolean
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return Math.floor(diff / 86400000) + '天前'
}

function ClipboardEnhancer(): React.JSX.Element {
  const [history, setHistory] = useState<ClipboardEntry[]>([])
  const [config, setConfig] = useState<ClipboardConfig | null>(null)
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.invoke<ClipboardEntry[]>('clipboard:get-history', null).then((h: ClipboardEntry[]) => {
      setHistory(h)
    })
    void window.api.invoke<ClipboardConfig>('clipboard:get-config', null).then((c: ClipboardConfig) => {
      setConfig(c)
    })

    const cleanupHistory = window.api.on<ClipboardEntry[]>('clipboard:history-updated', (entries: ClipboardEntry[]) => {
      setHistory(entries)
    })
    const cleanupTheme = window.api.on<unknown>('clipboard:theme-refresh', () => {
      void syncThemeFromSettings()
    })
    return () => { cleanupHistory(); cleanupTheme() }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (view === 'settings') {
          setView('list')
        } else {
          void window.api.invoke('clipboard:hide', null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [view])

  // Auto-focus search input when history is available
  useEffect(() => {
    if (view === 'list' && history.length > 0) {
      searchRef.current?.focus()
    }
  }, [view, history.length])

  const filteredHistory = (searchQuery
    ? history.filter(
        (e) => e.text.toLowerCase().includes(searchQuery.toLowerCase()) || e.preview.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history
  ).slice().sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  // Scroll selected item into view
  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, filteredHistory])

  // Paste: copy, hide the panel, and paste into the previous app.
  const handlePaste = useCallback(async (text: string): Promise<void> => {
    await window.api.invoke<boolean>('clipboard:copy', text)
  }, [])

  // Window-level keyboard navigation: Arrow keys move selection, Enter pastes.
  // Attached to window (not the list div) so it works while the search input holds focus.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (view !== 'list') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filteredHistory.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const entry = filteredHistory[selectedIndex]
        if (entry) void handlePaste(entry.text)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [view, filteredHistory, selectedIndex, handlePaste])

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    const updated = await window.api.invoke<ClipboardEntry[]>('clipboard:delete', id)
    setHistory(updated)
  }, [])

  const handleTogglePin = useCallback(async (id: string): Promise<void> => {
    const updated = await window.api.invoke<ClipboardEntry[]>('clipboard:toggle-pin', id)
    setHistory(updated)
  }, [])

  const handleClear = useCallback(async (): Promise<void> => {
    const updated = await window.api.invoke<ClipboardEntry[]>('clipboard:clear', null)
    setHistory(updated)
  }, [])

  const updateConfig = useCallback(async (patch: Partial<ClipboardConfig>): Promise<void> => {
    const updated = await window.api.invoke<ClipboardConfig>('clipboard:update-config', patch)
    setConfig(updated)
  }, [])

  // ── Settings Panel ──
  if (view === 'settings') {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-border bg-background/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <button
            onClick={() => setView('list')}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            返回
          </button>
          <span className="flex-1 text-sm font-medium text-foreground">剪贴板设置</span>
        </div>

        {/* Settings content */}
        <div className="flex-1 overflow-y-auto p-4">
          {config ? (
            <div className="space-y-5">
              {/* Max days */}
              <div>
                <label className="mb-1.5 block text-sm text-foreground">过期时间（天）</label>
                <p className="mb-2 text-[11px] text-muted-foreground">超过此天数的记录将自动删除</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={config.maxDays}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1
                      void updateConfig({ maxDays: Math.max(1, Math.min(365, val)) })
                    }}
                    className="w-20 rounded-md border border-input bg-muted px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">天</span>
                </div>
              </div>

              {/* Max items */}
              <div>
                <label className="mb-1.5 block text-sm text-foreground">最大记录数</label>
                <p className="mb-2 text-[11px] text-muted-foreground">超过此数量时自动清理最旧记录</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={config.maxItems}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 100
                      void updateConfig({ maxItems: Math.max(10, Math.min(1000, val)) })
                    }}
                    className="w-20 rounded-md border border-input bg-muted px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">条</span>
                </div>
              </div>

              {/* Hide on blur */}
              <div>
                <label className="mb-1.5 block text-sm text-foreground">失焦自动隐藏</label>
                <p className="mb-2 text-[11px] text-muted-foreground">关闭后剪贴板窗口不会在失去焦点时自动隐藏，方便拖动到其他位置进行数据对比</p>
                <button
                  onClick={() => void updateConfig({ hideOnBlur: !config.hideOnBlur })}
                  className={
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' +
                    (config.hideOnBlur ? 'bg-primary' : 'bg-muted-foreground/30')
                  }
                >
                  <span
                    className={
                      'inline-block size-4 transform rounded-full bg-white shadow transition-transform ' +
                      (config.hideOnBlur ? 'translate-x-4' : 'translate-x-0.5')
                    }
                  />
                </button>
              </div>

              {/* Clear history */}
              <div className="border-t border-border pt-4">
                <label className="mb-1.5 block text-sm text-foreground">清空历史</label>
                <p className="mb-2 text-[11px] text-muted-foreground">删除全部剪贴板历史记录，此操作不可撤销</p>
                <button
                  onClick={() => {
                    if (window.confirm('确定清空全部剪贴板历史记录吗？')) void handleClear()
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                  清空历史
                </button>
              </div>

            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中...</div>
          )}
        </div>

      </div>
    )
  }

  // ── History List ──
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-border bg-background/95 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <Clipboard className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-foreground">剪贴板历史</span>
        <button
          onClick={() => setView('settings')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="size-3" />
          设置
        </button>
        <button
          onClick={() => void window.api.invoke('clipboard:hide', null)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="收起剪贴板窗口"
        >
          <X className="size-3" />
          收起
        </button>
      </div>

      {/* Search */}
      {history.length > 0 && (
        <div className="px-3 py-2">
          <input
            ref={searchRef}
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-muted px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* History list — single click selects, double click pastes */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filteredHistory.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Clipboard className="size-8 opacity-40" />
            <span className="text-xs">
              {searchQuery ? '无匹配结果' : '暂无剪贴板历史'}
            </span>
          </div>
        ) : (
          filteredHistory.map((entry, index) => (
            <div
              key={entry.id}
              onClick={() => setSelectedIndex(index)}
              onDoubleClick={() => void handlePaste(entry.text)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={
                'group flex cursor-pointer items-start gap-2 border-b border-border/50 px-4 py-3 transition-colors ' +
                (index === selectedIndex ? 'bg-accent' : 'hover:bg-accent')
              }
            >
              <span className="self-center flex w-2 shrink-0 items-center justify-center">
                {entry.pinned && (
                  <Pin className="size-2 text-primary" fill="currentColor" />
                )}
              </span>
              {index < 9 && (
                <span className="mt-0.5 shrink-0 w-4 text-center text-[10px] font-medium text-muted-foreground/60">
                  {index + 1}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs leading-5 text-foreground">
                  {entry.preview}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-[10px] text-muted-foreground">{formatTime(entry.timestamp)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleTogglePin(entry.id)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className={"rounded p-0.5 " + (entry.pinned ? "text-primary" : "text-muted-foreground hover:text-primary")}
                  title={entry.pinned ? '取消置顶' : '置顶'}
                >
                  <Pin className="size-3" fill={entry.pinned ? "currentColor" : "none"} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(entry.id)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        <span>{filteredHistory.length} 条记录</span>
        <span>{config?.accelerators.join(' / ') ?? 'Ctrl+Shift+V'} 唤起</span>
      </div>
    </div>
  )
}

// Sync theme from main app settings before rendering to avoid flash
void syncThemeFromSettings().finally(() => {
  const root = createRoot(document.getElementById('root')!)
  root.render(<ClipboardEnhancer />)
})
