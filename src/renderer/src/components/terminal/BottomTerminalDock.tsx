import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Minimize2, Plus, SquareTerminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useTerminalStore, type TerminalTab } from '@renderer/stores/terminal-store'
import { useUIStore } from '@renderer/stores/ui-store'

const LocalTerminal = lazy(() =>
  import('./LocalTerminal').then((m) => ({ default: m.LocalTerminal }))
)
const AgentSshTerminal = lazy(() =>
  import('./AgentSshTerminal').then((m) => ({ default: m.AgentSshTerminal }))
)

const MIN_HEIGHT = 120
const MAX_HEIGHT = 560

function clampHeight(h: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h))
}

function getViewportMaxHeight(): number {
  if (typeof window === 'undefined') return MAX_HEIGHT
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(window.innerHeight * 0.72)))
}

function getFullscreenHeight(): number {
  if (typeof window === 'undefined') return MAX_HEIGHT
  return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - 88))
}

function StatusDot({ status }: { status: TerminalTab['status'] }): React.JSX.Element {
  return (
    <div
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'running'
          ? 'bg-emerald-500'
          : status === 'error'
            ? 'bg-red-500'
            : 'bg-muted-foreground/50'
      )}
    />
  )
}

export interface BottomTerminalDockProps {
  projectId: string
  sessionId?: string | null
  projectName?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
  dockOpen?: boolean
}

export function BottomTerminalDock({
  projectId,
  sessionId,
  projectName,
  workingFolder,
  sshConnectionId,
  dockOpen
}: BottomTerminalDockProps): React.JSX.Element {
  const { t } = useTranslation('layout')

  const allTabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const createTab = useTerminalStore((s) => s.createTab)
  const closeTab = useTerminalStore((s) => s.closeTab)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)

  const bottomTerminalDockHeight = useUIStore((s) => s.bottomTerminalDockHeight)
  const setBottomTerminalDockHeight = useUIStore((s) => s.setBottomTerminalDockHeight)
  const setBottomTerminalDockOpen = useUIStore((s) => s.setBottomTerminalDockOpen)

  // Filter tabs by session
  const sessionTabs = useMemo(
    () => allTabs.filter((tab) => tab.sessionId === sessionId),
    [allTabs, sessionId]
  )

  const [isResizing, setIsResizing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const resizeActiveRef = useRef(false)
  const resizeStartYRef = useRef(0)
  const resizeStartHeightRef = useRef(bottomTerminalDockHeight)
  const previousHeightRef = useRef(bottomTerminalDockHeight)
  const hasAutoCreatedRef = useRef(false)

  // Determine effective active tab (must be in project tabs)
  const effectiveActiveTabId = sessionTabs.some((t) => t.id === activeTabId)
    ? activeTabId
    : sessionTabs[0]?.id ?? null
  const activeTab = sessionTabs.find((t) => t.id === effectiveActiveTabId) ?? null

  const handleAutoCreateTerminal = useCallback(async (): Promise<void> => {
    if (sshConnectionId) {
      // For SSH projects, don't auto-create a synthetic tab.
      // Real agent SSH output events will create tabs with matching execIds.
      // Just show the placeholder; tabs appear automatically when agent runs commands.
      console.log('[BottomTerminalDock] SSH project — skipping auto-create, waiting for agent output')
      return
    }

    if (workingFolder) {
      await createTab(workingFolder ?? undefined, projectId, projectName || 'Terminal', sessionId)
      return
    }

    // Fallback: create terminal with no specific cwd
    await createTab(undefined, projectId, 'Terminal', sessionId)
  }, [sshConnectionId, workingFolder, projectId, projectName, sessionId, createTab])

  // Auto-create a terminal when dock opens and there are no session tabs
  useEffect(() => {
    if (!dockOpen) return
    if (sessionTabs.length === 0 && !hasAutoCreatedRef.current) {
      hasAutoCreatedRef.current = true
      handleAutoCreateTerminal().catch((err) => {
        // Allow a retry on the next trigger instead of staying stuck with
        // an empty dock after a transient create failure.
        console.warn('[BottomTerminalDock] Auto-create terminal failed:', err)
        hasAutoCreatedRef.current = false
      })
      return
    }
    // Reset auto-created flag when tabs become empty again (e.g., after closing all)
    if (sessionTabs.length === 0) {
      hasAutoCreatedRef.current = false
    }
  }, [sessionTabs.length, dockOpen, handleAutoCreateTerminal])

  // Resize handlers
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (event: MouseEvent): void => {
      if (!resizeActiveRef.current) return
      const delta = resizeStartYRef.current - event.clientY
      const nextHeight = resizeStartHeightRef.current + delta
      setBottomTerminalDockHeight(clampHeight(nextHeight))
    }

    const handleMouseUp = (): void => {
      resizeActiveRef.current = false
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setBottomTerminalDockHeight])

  // Window resize handler for fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const handleResize = (): void => {
      setBottomTerminalDockHeight(getFullscreenHeight())
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [fullscreen, setBottomTerminalDockHeight])

  const startResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()
      if (fullscreen) setFullscreen(false)
      resizeActiveRef.current = true
      resizeStartYRef.current = event.clientY
      resizeStartHeightRef.current = bottomTerminalDockHeight
      setIsResizing(true)
    },
    [bottomTerminalDockHeight, fullscreen]
  )

  const handleToggleFullscreen = useCallback((): void => {
    if (fullscreen) {
      setFullscreen(false)
      setBottomTerminalDockHeight(clampHeight(previousHeightRef.current))
    } else {
      previousHeightRef.current = bottomTerminalDockHeight
      setFullscreen(true)
      setBottomTerminalDockHeight(getFullscreenHeight())
    }
  }, [fullscreen, bottomTerminalDockHeight, setBottomTerminalDockHeight])

  const handleCollapse = useCallback((): void => {
    if (fullscreen) {
      setFullscreen(false)
      setBottomTerminalDockHeight(clampHeight(previousHeightRef.current))
    }
    if (sessionId) setBottomTerminalDockOpen(sessionId, false)
  }, [sessionId, setBottomTerminalDockHeight, setBottomTerminalDockOpen, fullscreen])

  const handleCreate = useCallback((): void => {
    // For both local and SSH projects, create a local terminal.
    // SSH agent tabs are auto-created by the SSH_EXEC_OUTPUT event listener
    // when the agent executes remote commands.
    void createTab(workingFolder ?? undefined, projectId, projectName || 'Terminal', sessionId)
  }, [workingFolder, projectId, projectName, sessionId, createTab])

  const handleClose = useCallback(
    async (tab: TerminalTab): Promise<void> => {
      await closeTab(tab.id)
    },
    [closeTab]
  )

  const dockHeight = fullscreen
    ? getFullscreenHeight()
    : Math.min(bottomTerminalDockHeight, getViewportMaxHeight())

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col',
        isResizing && 'select-none'
      )}
      style={{ height: fullscreen ? '100%' : dockHeight }}
    >
      {/* Resize handle */}
      {!fullscreen && (
        <div
          className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize"
          onMouseDown={startResize}
        />
      )}

      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-background/70 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:none]">
          {sessionTabs.length === 0 ? (
            <span className="px-2 text-[11px] text-muted-foreground">
              {t('terminal.noSessions', { defaultValue: 'No terminal sessions' })}
            </span>
          ) : (
            sessionTabs.map((tab) => {
              const isActive = tab.id === activeTab?.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'group relative flex h-7 shrink-0 items-center rounded-md border border-transparent px-2.5 text-left transition-colors',
                    isActive
                      ? 'border-primary/30 bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                  onClick={() => setActiveTab(tab.id)}
                  title={`${tab.title} · ${tab.cwd}`}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {tab.kind === 'ssh-agent' && (
                      <SquareTerminal className="size-3 shrink-0 text-cyan-500" />
                    )}
                    <StatusDot status={tab.status} />
                    <span className="max-w-[120px] truncate text-xs font-medium">
                      {tab.title}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleClose(tab)
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        e.stopPropagation()
                        void handleClose(tab)
                      }}
                    >
                      <X className="size-3" />
                    </span>
                  </span>
                </button>
              )
            })
          )}
          {/* New terminal button (right after tabs) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={handleCreate}
                title={t('terminal.newTerminal', { defaultValue: 'New terminal' })}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('terminal.newTerminal', { defaultValue: 'New terminal' })}</TooltipContent>
          </Tooltip>
        </div>


        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={handleToggleFullscreen}
              >
                {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {fullscreen ? t('terminal.exitFullscreen', { defaultValue: 'Exit fullscreen' }) : t('terminal.fullscreen', { defaultValue: 'Fullscreen' })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={handleCollapse}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('terminal.collapse', { defaultValue: 'Collapse' })}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Terminal content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          sessionTabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: tab.id === activeTab.id ? undefined : 'none' }}
            >
              {tab.kind === 'ssh-agent' ? (
                <Suspense fallback={null}>
                  <AgentSshTerminal connectionName={tab.connectionName} />
                </Suspense>
              ) : tab.status === 'running' ? (
                <Suspense fallback={null}>
                  <LocalTerminal terminalId={tab.id} />
                </Suspense>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  {tab.status === 'error' ? (
                    <>
                      <div>{t('terminal.exited', { defaultValue: 'Terminal exited' })}</div>
                      <div>Exit code: {tab.exitCode ?? '-'}</div>
                    </>
                  ) : (
                    <>
                      <div>{t('terminal.ended', { defaultValue: 'Terminal ended' })}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
            <SquareTerminal className="size-10 text-muted-foreground/40" />
            <div>
              {sshConnectionId
                ? `${projectName || 'SSH'} — Agent commands will appear here`
                : t('terminal.selectToStart', { defaultValue: 'Select a terminal to get started' })}
            </div>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleCreate}>
              <Plus className="size-3.5" />
              {t('terminal.newTerminal', { defaultValue: 'New terminal' })}
            </Button>
          </div>
        )}
      </div>

      {/* Status bar */}
      {activeTab && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{activeTab.title}</span>
          <span className="shrink-0 truncate">{activeTab.shell || activeTab.cwd || '-'}</span>
        </div>
      )}

      {isResizing && <div className="fixed inset-0 z-[100] cursor-row-resize" />}
    </div>
  )
}
