import { useTranslation } from 'react-i18next'
import { FolderOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, SquareTerminal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { WindowControls } from './WindowControls'

interface TitleBarProps {
  title?: string
  subtitle?: string | null
  tooltip?: string | null
  showSidebarToggle?: boolean
}

export function TitleBar({
  showSidebarToggle = true
}: TitleBarProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen)
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const ensureFilesTab = useUIStore((s) => s.ensureFilesTab)
  const toggleBottomTerminalDock = useUIStore((s) => s.toggleBottomTerminalDock)

  // Get current session ID and terminal dock state
  const currentSessionId = useChatStore((s) => s.activeSessionId)
  const bottomTerminalDockOpen = useUIStore((s) =>
    currentSessionId ? Boolean(s.bottomTerminalDockOpenBySessionId[currentSessionId]) : false
  )

  // Session title is only shown when the content area actually renders the
  // session conversation pane (mirrors MainLayout ContentArea conditions).
  const isSessionPage = useUIStore(
    (s) =>
      !s.settingsPageOpen &&
      s.activeNavItem === 'chat' &&
      !s.skillsPageOpen &&
      !s.soulsPageOpen &&
      !s.syncPageOpen &&
      !s.resourcesPageOpen &&
      !s.translatePageOpen &&
      !s.drawPageOpen &&
      !s.tasksPageOpen &&
      !s.taskBoardPageOpen &&
      !s.codeGraphPageOpen &&
      s.chatView === 'session'
  )
  const sessionTitle = useChatStore(
    (s) => s.sessions.find((item) => item.id === s.activeSessionId)?.title ?? ''
  )

  // Only show file/terminal buttons in project-level sessions (has workingFolder)
  const hasProject = useChatStore((s) => {
    const session = s.sessions.find((item) => item.id === s.activeSessionId)
    if (session?.workingFolder) return true
    // Inherit from project if session doesn't have its own workingFolder
    if (session?.projectId) {
      const project = s.projects.find((p) => p.id === session.projectId)
      return Boolean(project?.workingFolder) || Boolean(project?.sshConnectionId)
    }
    return false
  })

  return (
    <header className="titlebar-drag flex h-10 shrink-0 items-center justify-between bg-background/90 backdrop-blur">
      {/* Left: sidebar toggle (always visible) + session title (session page only) */}
      <div className="flex min-w-0 items-center gap-1 px-2">
        {showSidebarToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleLeftSidebar}
                className="titlebar-no-drag flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {leftSidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('topbar.toggleSidebar', { defaultValue: 'Toggle sidebar' })}</TooltipContent>
          </Tooltip>
        )}

        {isSessionPage && sessionTitle && (
          <span
            title={sessionTitle}
            className="max-w-[40vw] truncate text-sm font-medium text-foreground/85"
          >
            {sessionTitle}
          </span>
        )}
      </div>

      {/* Right: files, terminal, right panel toggle, window controls */}
      <div className="flex items-center gap-1 px-2">
        {hasProject && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => ensureFilesTab()}
                  className="titlebar-no-drag flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <FolderOpen className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('topbar.files', { defaultValue: 'Files' })}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => currentSessionId && toggleBottomTerminalDock(currentSessionId)}
                  className={`titlebar-no-drag flex size-7 items-center justify-center rounded-md transition-colors ${bottomTerminalDockOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                >
                  <SquareTerminal className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('topbar.terminal', { defaultValue: 'Terminal' })}</TooltipContent>
            </Tooltip>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleRightPanel}
              className={`titlebar-no-drag flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground ${
                rightPanelOpen ? 'text-foreground bg-accent' : 'text-muted-foreground'
              }`}
            >
              {rightPanelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('topbar.toggleRightPanel', { defaultValue: 'Toggle right panel' })}</TooltipContent>
        </Tooltip>

        <WindowControls />
      </div>
    </header>
  )
}
