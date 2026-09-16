import { useEffect } from 'react'
import { PenTool, GitBranch } from 'lucide-react'
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
import { FreeChatPage } from '@renderer/components/free-chat/FreeChatPage'

import { ChatHomePage } from '@renderer/components/chat/ChatHomePage'
import { ProjectHomePage } from '@renderer/components/chat/ProjectHomePage'
import { ProjectArchivePage } from '@renderer/components/chat/ProjectArchivePage'
import { SettingsPage } from '@renderer/components/settings/SettingsPage'
import { PersonaPanel } from '@renderer/components/settings/PersonaPanel'

// ─── Content area ───

function ContentArea(): React.JSX.Element {
  const chatView = useUIStore((s) => s.chatView)
  const settingsPageOpen = useUIStore((s) => s.settingsPageOpen)
  const drawPageOpen = useUIStore((s) => s.drawPageOpen)
  const tasksPageOpen = useUIStore((s) => s.tasksPageOpen)
  const taskBoardPageOpen = useUIStore((s) => s.taskBoardPageOpen)
  const freeChatPageOpen = useUIStore((s) => s.freeChatPageOpen)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeProject = useChatStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  )

  // Settings page (inline overlay)
  if (settingsPageOpen) {
    return <SettingsPage />
  }

  // Feature page toggles (opened from within chat context)
  if (drawPageOpen) return <PlaceholderPage title="Draw" iterLabel="后续" icon={PenTool} />
  if (tasksPageOpen) return <AutomationPage />
  if (taskBoardPageOpen) return <TaskBoardPage />
  if (freeChatPageOpen) return <FreeChatPage />

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
          state.activeSessionId = null

          const firstSession = sessions[0]
          nextActiveProjectId = firstSession
            ? firstSession.scope === 'project' ? firstSession.projectId ?? null : null
            : data.projects[0]?.id ?? null
          state.activeProjectId = nextActiveProjectId
        })

        // Load messages for the active session (like WishfulClaw does)
        if (nextActiveSessionId) {
          await useChatStore.getState().setActiveSession(nextActiveSessionId)
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
