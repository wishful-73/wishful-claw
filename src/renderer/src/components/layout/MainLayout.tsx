import { useEffect } from 'react'
import {
  Sparkles,
  Ghost,
  RefreshCw,
  PenTool,
  Languages,
  GitBranch,
  Plug,
  FolderTree,
  CalendarDays,
  SquareKanban,
} from 'lucide-react'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { dbLoadAll } from '@renderer/stores/chat-store/db-helpers'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { TitleBar } from './TitleBar'
import { RightPanel } from './RightPanel'
import { RuntimeStatusPanel } from './RuntimeStatusPanel'
import { CommandPalette } from './CommandPalette'
import { SessionConversationPane } from './SessionConversationPane'
import { PlaceholderPage } from './PlaceholderPage'
import { AutomationPage } from '@renderer/components/automation/AutomationPage'
import { TaskBoardPage } from '@renderer/components/taskboard/TaskBoardPage'

import { ChatHomePage } from '@renderer/components/chat/ChatHomePage'
import { ProjectHomePage } from '@renderer/components/chat/ProjectHomePage'
import { ProjectArchivePage } from '@renderer/components/chat/ProjectArchivePage'
import { SettingsPage } from '@renderer/components/settings/SettingsPage'
import { PersonaPanel } from '@renderer/components/settings/PersonaPanel'

// ─── Feature page registry ───

const FEATURE_PAGES: Record<string, { title: string; iterLabel: string; icon: React.ComponentType<{ className?: string }> }> = {
  skills: { title: 'Skills', iterLabel: '后续', icon: Sparkles },
  souls: { title: 'Souls', iterLabel: '迭代七', icon: Ghost },
  sync: { title: 'Sync', iterLabel: '后续', icon: RefreshCw },
  resources: { title: 'Resources', iterLabel: '后续', icon: FolderTree },
  translate: { title: 'Translate', iterLabel: '后续', icon: Languages },
  draw: { title: 'Draw', iterLabel: '后续', icon: PenTool },
  tasks: { title: 'Automation', iterLabel: '后续', icon: CalendarDays },
  taskboard: { title: 'Task Board', iterLabel: '后续', icon: SquareKanban },
  codegraph: { title: 'Code Graph', iterLabel: '后续', icon: GitBranch },
  channels: { title: 'Channels', iterLabel: '迭代四', icon: Plug }
}

// ─── Content area ───

function ContentArea(): React.JSX.Element {
  const activeNavItem = useUIStore((s) => s.activeNavItem)
  const chatView = useUIStore((s) => s.chatView)
  const settingsPageOpen = useUIStore((s) => s.settingsPageOpen)
  const skillsPageOpen = useUIStore((s) => s.skillsPageOpen)
  const soulsPageOpen = useUIStore((s) => s.soulsPageOpen)
  const syncPageOpen = useUIStore((s) => s.syncPageOpen)
  const resourcesPageOpen = useUIStore((s) => s.resourcesPageOpen)
  const translatePageOpen = useUIStore((s) => s.translatePageOpen)
  const drawPageOpen = useUIStore((s) => s.drawPageOpen)
  const tasksPageOpen = useUIStore((s) => s.tasksPageOpen)
  const codeGraphPageOpen = useUIStore((s) => s.codeGraphPageOpen)
  const taskBoardPageOpen = useUIStore((s) => s.taskBoardPageOpen)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeProject = useChatStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  )

  // Settings page (inline overlay)
  if (settingsPageOpen) {
    return <SettingsPage />
  }

  // Non-chat nav items → placeholder pages
  if (activeNavItem !== 'chat') {
    const config = FEATURE_PAGES[activeNavItem]
    if (config) {
      return <PlaceholderPage title={config.title} iterLabel={config.iterLabel} icon={config.icon} />
    }
  }

  // Feature page toggles (opened from within chat context)
  if (skillsPageOpen) return <PlaceholderPage title="Skills" iterLabel="后续" icon={Sparkles} />
  if (soulsPageOpen) return <PlaceholderPage title="Souls" iterLabel="迭代七" icon={Ghost} />
  if (syncPageOpen) return <PlaceholderPage title="Sync" iterLabel="后续" icon={RefreshCw} />
  if (resourcesPageOpen) return <PlaceholderPage title="Resources" iterLabel="后续" icon={FolderTree} />
  if (translatePageOpen) return <PlaceholderPage title="Translate" iterLabel="后续" icon={Languages} />
  if (drawPageOpen) return <PlaceholderPage title="Draw" iterLabel="后续" icon={PenTool} />
  if (tasksPageOpen) return <AutomationPage />
  if (taskBoardPageOpen) return <TaskBoardPage />
  if (codeGraphPageOpen) return <PlaceholderPage title="Code Graph" iterLabel="后续" icon={GitBranch} />

  // Chat views
  switch (chatView) {
    case 'home':
      return <ChatHomePage />
    case 'project':
      return <ProjectHomePage />
    case 'session':
      return <SessionConversationPane sessionId={activeSessionId} />
    case 'persona':
      return (
        <PersonaPanel workingFolder={activeProject?.workingFolder} />
      )
    case 'archive':
      return <ProjectArchivePage />
    case 'git':
      return <PlaceholderPage title="Git" iterLabel="后续" icon={GitBranch} />
    case 'channels':
      return <PlaceholderPage title="Channels" iterLabel="迭代四" icon={Plug} />
    default:
      return <ChatHomePage />
  }
}

// ─── Title resolver ───


// ─── MainLayout ───

export function MainLayout(): React.JSX.Element {

  const runtimeStatusPanelOpen = useUIStore((s) => s.runtimeStatusPanelOpen)
  const ensureDefaultProject = useChatStore((s) => s.ensureDefaultProject)

  // Load projects + sessions from DB on startup, then ensure default project
  useEffect(() => {
    void (async () => {
      if (useChatStore.getState().sessions.length > 0) return
      const data = await dbLoadAll()
      if (data && data.projects.length > 0) {
        // Build project map for session hydration
        const projectMap = new Map(data.projects.map((p) => [p.id, p]))

        // Hydrate sessions: inherit workingFolder from project if session doesn't have one
        const sessions = data.sessions.map((session) => {
          if (session.projectId) {
            const project = projectMap.get(session.projectId)
            if (project) {
              if (!session.workingFolder && project.workingFolder) {
                session.workingFolder = project.workingFolder
              }
              if (!session.sshConnectionId && project.sshConnectionId) {
                session.sshConnectionId = project.sshConnectionId
              }
            }
          }
          // messageCount === 0 → no messages to load, mark as loaded
          if (session.messageCount === 0) {
            session.messagesLoaded = true
            session.loadedRangeStart = 0
            session.loadedRangeEnd = 0
            session.lastKnownMessageCount = 0
          }
          return session
        })

        // Use set() so immer runs syncSessionsById and creates proper drafts
        let nextActiveSessionId: string | null = null
        let nextActiveProjectId: string | null = null

        useChatStore.setState((state) => {
          state.projects = data.projects
          state.sessions = sessions
          // Rebuild sessionsById index
          state.sessionsById = {}
          for (let i = 0; i < sessions.length; i++) {
            state.sessionsById[sessions[i].id] = i
          }

          nextActiveSessionId = sessions[0]?.id ?? null
          state.activeSessionId = nextActiveSessionId

          nextActiveProjectId = sessions[0]?.projectId ?? data.projects[0]?.id ?? null
          state.activeProjectId = nextActiveProjectId
        })

        // Load messages for the active session (like WishfulClaw does)
        if (nextActiveSessionId) {
          await useChatStore.getState().loadRecentSessionMessages(nextActiveSessionId)
          // Restore the active session's persisted agent Todo list.
          void import('@renderer/stores/task-store')
            .then(({ useTaskStore }) => {
              void useTaskStore.getState().loadTasksForSession(nextActiveSessionId!)
            })
            .catch((err) => {
              console.warn('[MainLayout] Failed to restore session tasks:', err)
            })
          // Navigate to session view so user sees the conversation directly
          useUIStore.getState().navigateToSession(nextActiveSessionId)
        }
      } else {
        // No projects in DB, ensure default
        void ensureDefaultProject()
      }
    })()
  }, [ensureDefaultProject])

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Left: NavRail + Sidebar */}
        <WorkspaceSidebar />

        {/* Center: Title bar + Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TitleBar />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Main content */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <ContentArea />
            </div>

            {/* Right panel — always mounted so browser webview stays alive */}
            <RightPanel />
          </div>
        </div>

        {/* Runtime status panel (bottom or floating) */}
        {runtimeStatusPanelOpen && <RuntimeStatusPanel />}

        {/* Command palette overlay */}
        <CommandPalette />
      </div>
    </TooltipProvider>
  )
}
