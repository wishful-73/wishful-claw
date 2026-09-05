import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useUIStore, type RightPanelTabInstance } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { BROWSER_PLUGIN_ID } from '@renderer/lib/app-plugin/types'
import { cn } from '@renderer/lib/utils'
import { RightPanelHeader } from './RightPanelHeader'
import { ActivityPanel } from '@renderer/components/activity/ActivityPanel'
import { MemoryPanel } from '@renderer/components/memory/MemoryPanel'
import { SubAgentsPanel } from '@renderer/components/layout/SubAgentsPanel'
import { SubAgentExecutionDetail } from '@renderer/components/layout/SubAgentExecutionDetail'
import { BrowserPanel } from '@renderer/components/layout/BrowserPanel'
import { PreviewPanel } from '@renderer/components/layout/PreviewPanel'
import { AgentFilesPanel } from '@renderer/components/layout/AgentFilesPanel'
import { SessionChangeReviewPanel } from '@renderer/components/layout/SessionChangeReviewPanel'
import { SessionSummaryPanel } from '@renderer/components/layout/SessionSummaryPanel'
import { GoalHistoryPanel } from '@renderer/components/goal/GoalHistoryPanel'
import { RIGHT_PANEL_DEFAULT_WIDTH, clampRightPanelWidth } from './right-panel-defs'
import {
  readActiveRightPanelTabId,
  rightPanelTabScope,
  rightPanelTabScopeId
} from '@renderer/stores/right-panel-scope'


export function RightPanel(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const rightPanelOpen = useUIStore((state) => state.rightPanelOpen)
  const rightPanelWidth = useUIStore((state) => state.rightPanelWidth)
  const rightPanelTabs = useUIStore((state) => state.rightPanelTabs)
  const setRightPanelOpen = useUIStore((state) => state.setRightPanelOpen)
  const setRightPanelWidth = useUIStore((state) => state.setRightPanelWidth)
  const setRightPanelActiveTab = useUIStore((state) => state.setRightPanelActiveTab)
  const closeRightPanelTab = useUIStore((state) => state.closeRightPanelTab)
  const closeOtherRightPanelTabs = useUIStore((state) => state.closeOtherRightPanelTabs)
  const closeAllRightPanelTabs = useUIStore((state) => state.closeAllRightPanelTabs)
  const ensureActivityTab = useUIStore((state) => state.ensureActivityTab)
  const ensureBrowserTab = useUIStore((state) => state.ensureBrowserTab)
  const ensureFilesTab = useUIStore((state) => state.ensureFilesTab)
  const activeScopedSessionId = useUIStore((state) => state.activeScopedSessionId)

  const activeProjectId = useChatStore((state) => {
    const targetSessionId = activeScopedSessionId ?? state.activeSessionId
    const targetSession = targetSessionId
      ? state.sessions.find((item) => item.id === targetSessionId)
      : null
    return targetSession?.projectId ?? state.activeProjectId
  })
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const panelSessionId = activeScopedSessionId ?? activeSessionId ?? null
  const activeTabId = useUIStore((state) => readActiveRightPanelTabId(state, panelSessionId))
  // tab 条与激活项只认当前作用域的 tab；常驻层（browser / files）的挂载判据
  // 继续读未过滤的 rightPanelTabs，见下方 hasBrowserTab / hasFilesTab。
  const panelScopeId = rightPanelTabScopeId(panelSessionId)
  const scopedTabs = useMemo(
    () => rightPanelTabs.filter((tab) => rightPanelTabScope(tab) === panelScopeId),
    [rightPanelTabs, panelScopeId]
  )
  const memoryProject = useChatStore((state) => {
    const targetSessionId = activeScopedSessionId ?? state.activeSessionId
    const targetSession = targetSessionId
      ? state.sessions.find((item) => item.id === targetSessionId)
      : null
    const projectId = targetSession?.projectId ?? state.activeProjectId
    return state.projects.find((project) => project.id === projectId) ?? null
  })
  const workingFolder = memoryProject?.workingFolder ?? null
  const memoryProjectId = memoryProject?.id ?? null
  const memorySshConnectionId = memoryProject?.sshConnectionId ?? null
  const browserPluginEnabled = useAppPluginStore((state) =>
    Boolean(state.getPlugin(BROWSER_PLUGIN_ID, activeProjectId)?.enabled)
  )

  const tabs = useMemo(() => {
    if (!rightPanelOpen) return scopedTabs
    return scopedTabs.map((tab: any) => {
      if (tab.kind === 'activity') {
        return { ...tab, title: t('sectionExecution.title', { defaultValue: 'Activity' }) }
      }
      if (tab.kind === 'memory') {
        return { ...tab, title: t('memory.tabMemory', { defaultValue: 'Memory' }) }
      }
      if (tab.kind === 'files') {
        return { ...tab, title: t('rightPanel.files', { defaultValue: 'Files' }) }
      }
      if (tab.kind === 'browser') {
        return { ...tab, title: t('rightPanel.browser', { defaultValue: 'Browser' }) }
      }
      if (tab.kind === 'summary') {
        return {
          ...tab,
          title: t('rightPanel.contextProgress', { defaultValue: 'Context & progress' })
        }
      }
      // subagent tabs keep their own title (set from task description)
      return tab
    })
  }, [rightPanelOpen, scopedTabs, t])

  const selectedTab =
    tabs.find((tab: any) => tab.id === activeTabId) ?? tabs[0]

  // The browser webview stays mounted whenever a browser tab exists and the plugin
  // is enabled — independent of whether the panel is open. This lets agent-driven
  // browser tools keep working in the background even while the panel is collapsed.
  // 每个 Browser tab 都拥有独立且稳定的 BrowserPanel 实例。切换会话只改变
  // 哪个实例可见，不会因为当前会话变化而卸载原会话的 webview。
  const browserTabs = rightPanelTabs.filter((tab: any) => tab.kind === 'browser')
  const browserTabAlive = browserTabs.length > 0

  const activeTab = rightPanelOpen ? selectedTab : undefined
  const browserVisible = rightPanelOpen && activeTab?.kind === 'browser'

  // Files panel stays mounted to preserve tree state (expanded folders, scroll)
  // across tab switches — same persistent-layer approach as the browser panel.
  const hasFilesTab = rightPanelTabs.some((tab: any) => tab.kind === 'files')
  const filesVisible = rightPanelOpen && activeTab?.kind === 'files'

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(rightPanelWidth)
  const [isDragging, setIsDragging] = useState(false)

  const targetPanelWidth = clampRightPanelWidth(rightPanelWidth)

  useEffect(() => {
    if (rightPanelWidth === 0) setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH)
  }, [rightPanelWidth, setRightPanelWidth])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = startXRef.current - event.clientX
      setRightPanelWidth(clampRightPanelWidth(startWidthRef.current + delta))
    }

    const handleMouseUp = (): void => {
      draggingRef.current = false
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setRightPanelWidth])

  const startResize = (event: React.MouseEvent): void => {
    if (!rightPanelOpen) return
    event.preventDefault()
    draggingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = targetPanelWidth
    setIsDragging(true)
  }

  const renderActivePanel = (tab: RightPanelTabInstance | undefined): React.ReactNode => {
    if (!tab) return null
    if (tab.kind === 'activity') {
      return <ActivityPanel />
    }
    if (tab.kind === 'memory') {
      return (
        <MemoryPanel
          workingFolder={workingFolder}
          projectId={memoryProjectId}
          sshConnectionId={memorySshConnectionId}
        />
      )
    }
    if (tab.kind === 'subagent') {
      // Per-agent tabs (toolUseId set) render the execution detail directly;
      // the overview tab (no toolUseId) renders the agent list.
      if (tab.toolUseId) {
        return (
          <SubAgentExecutionDetail
            embedded
            toolUseId={tab.toolUseId}
            inlineText={tab.inlineText ?? undefined}
            sessionId={tab.sessionId ?? panelSessionId}
          />
        )
      }
      return <SubAgentsPanel sessionId={tab.sessionId ?? panelSessionId} />
    }
    if (tab.kind === 'browser') return null  // BrowserPanel is rendered as persistent layer
    if (tab.kind === 'preview') return <PreviewPanel embedded />
    if (tab.kind === 'files') return null  // AgentFilesPanel is rendered as persistent layer
    if (tab.kind === 'review') return <SessionChangeReviewPanel sessionId={tab.sessionId ?? panelSessionId} />
    if (tab.kind === 'summary') return <SessionSummaryPanel sessionId={tab.sessionId ?? panelSessionId} />
    if (tab.kind === 'goal') {
      return (
        <GoalHistoryPanel
          projectId={tab.projectId ?? activeProjectId}
          initialSessionId={tab.sessionId ?? null}
          initialGoalId={tab.goalId ?? null}
        />
      )
    }
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t('thinking.thinkingEllipsis', { ns: 'chat', defaultValue: 'Loading...' })}
      </div>
    )
  }

  return (
    <div
      data-tour="right-panel"
      className="relative z-40 h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: rightPanelOpen ? targetPanelWidth : 0 }}
    >
      <aside
        className={cn(
          'relative flex h-full w-full flex-col border-l border-border/60 bg-background shadow-[-18px_0_42px_rgba(0,0,0,0.16)] transition-[opacity,transform] duration-300 ease-out',
          rightPanelOpen
            ? 'translate-x-0 opacity-100'
            : 'pointer-events-none translate-x-full opacity-0'
        )}
      >
        {rightPanelOpen ? (
          <>
            <RightPanelHeader
              tabs={tabs}
              activeTabId={activeTab?.id ?? ''}
              browserEnabled={browserPluginEnabled}
              onSelectTab={setRightPanelActiveTab}
              onCloseTab={closeRightPanelTab}
              onCloseOtherTabs={closeOtherRightPanelTabs}
              onCloseAllTabs={closeAllRightPanelTabs}
              onAddActivity={ensureActivityTab}
              onAddBrowser={() => ensureBrowserTab(undefined, panelSessionId)}
              onOpenFile={() => ensureFilesTab(panelSessionId)}
              onClosePanel={() => setRightPanelOpen(false)}
              t={t}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
              <AnimatePresence mode="wait">
                {activeTab?.kind !== 'browser' && activeTab?.kind !== 'files' ? (
                  <motion.div
                    key={activeTab?.id ?? 'empty'}
                    className="absolute inset-0 min-h-0"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                  >
                    {renderActivePanel(activeTab)}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div
              className="absolute left-0 top-0 bottom-0 z-[60] w-1.5 cursor-col-resize transition-colors hover:bg-primary/30"
              onMouseDown={startResize}
            />
          </>
        ) : null}

        {/* Persistent browser layer: mounted whenever a browser tab exists so the
            webview keeps running even when the panel is closed or another tab is
            active. When hidden it stays in the DOM (webview connected) but
            non-interactive and transparent. */}
        {browserTabAlive
          ? browserTabs.map((tab: any) => {
              const visible = browserVisible && activeTab?.id === tab.id
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'absolute inset-x-0 bottom-0 top-10',
                    visible ? 'z-10 opacity-100' : 'pointer-events-none -z-10 opacity-0'
                  )}
                >
                  <BrowserPanel sessionId={tab.sessionId ?? null} projectId={tab.projectId ?? null} />
                </div>
              )
            })
          : null}

        {/* Persistent files layer: mounted whenever a files tab exists so the
            file tree state (expanded folders, scroll position) survives tab
            switches. When hidden it stays in the DOM but non-interactive. */}
        {hasFilesTab ? (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 top-10',
              filesVisible ? 'z-10 opacity-100' : 'pointer-events-none -z-10 opacity-0'
            )}
          >
            <AgentFilesPanel sessionId={panelSessionId} />
          </div>
        ) : null}
      </aside>

      {isDragging && <div className="fixed inset-0 z-[100] cursor-col-resize" />}
    </div>
  )
}
