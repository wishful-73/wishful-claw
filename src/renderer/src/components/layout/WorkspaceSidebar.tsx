import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Settings, Plus, Search, ChevronRight, Image, CalendarDays, ArrowDownAZ, ListFilter, SquareKanban, Plug, Clock3 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel } from '@renderer/components/ui/dropdown-menu'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore, type Session } from '@renderer/stores/chat-store'
import { cn } from '@renderer/lib/utils'
import { APP_VERSION_LABEL } from '@renderer/lib/app-version'
import { toast } from 'sonner'
import { WorkingFolderSelectorDialog } from '@renderer/components/chat/WorkingFolderSelectorDialog'

// ─── Helpers ───
import { SessionItem, ProjectItem, sortProjects, sortSessions, readProjectSortMode, writeProjectSortMode, PROJECT_SORT_MODES, type ProjectSortMode } from './workspace-sidebar-items'
import { ResizeHandle, renderNavItem, NavButtonItem } from './workspace-sidebar-nav'
import { SearchDialog } from './search-dialog'
import * as React from 'react'

export function WorkspaceSidebar(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen)
  const leftSidebarWidth = useUIStore((s) => s.leftSidebarWidth)
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem)
  const navigateToHome = useUIStore((s) => s.navigateToHome)
  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const activeSessionId = useChatStore((s) => s.activeSessionId)

  const sessions = useChatStore((s) => s.sessions)

  const projects = useChatStore((s) => s.projects)
  const setActiveProjectHome = useChatStore((s) => s.setActiveProjectHome)
  const createProject = useChatStore((s) => s.createProject)

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  // Must be declared before the early return below — hook order must stay stable
  // across collapsed/expanded renders (React error #300 otherwise).
  const [searchOpen, setSearchOpen] = useState(false)
  const extensionsHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openExtensions = useCallback(() => {
    if (extensionsHoverTimer.current) {
      clearTimeout(extensionsHoverTimer.current)
      extensionsHoverTimer.current = null
    }
    setExtensionsOpen(true)
  }, [])

  const closeExtensions = useCallback(() => {
    if (extensionsHoverTimer.current) {
      clearTimeout(extensionsHoverTimer.current)
    }
    extensionsHoverTimer.current = setTimeout(() => {
      setExtensionsOpen(false)
      extensionsHoverTimer.current = null
    }, 150)
  }, [])

  const openDrawPage = useUIStore((s) => s.openDrawPage)
  const openTasksPage = useUIStore((s) => s.openTasksPage)
  const openTaskBoardPage = useUIStore((s) => s.openTaskBoardPage)

  // Active project ID — used for highlighting only.
  // Expand/collapse is purely user-controlled via clicking the project title.
  // No auto-expand on active project change.

  // On initial mount: if there's an active session, expand its parent project
  // so the user can see which conversation is focused after restart.
  // This runs once — subsequent expand/collapse is purely user-controlled.
  const initialExpandDone = useRef(false)
  useEffect(() => {
    if (initialExpandDone.current) return
    if (!activeSessionId || sessions.length === 0) return
    const session = sessions.find((s) => s.id === activeSessionId)
    if (session?.projectId) {
      setExpandedProjects((prev) =>
        prev.has(session.projectId!) ? prev : new Set(prev).add(session.projectId!)
      )
    }
    initialExpandDone.current = true
  }, [activeSessionId, sessions])

  // Group sessions by project
  const { projectSessions, unassignedSessions } = useMemo(() => {
    const byProject: Record<string, Session[]> = {}
    const unassigned: Session[] = []

    for (const session of sessions) {
      if (session.projectId) {
        if (!byProject[session.projectId]) {
          byProject[session.projectId] = []
        }
        byProject[session.projectId].push(session)
      } else {
        unassigned.push(session)
      }
    }

    return { projectSessions: byProject, unassignedSessions: unassigned }
  }, [sessions])

  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>(readProjectSortMode)
  const sortedProjects = useMemo(
    () => sortProjects(projects, projectSortMode),
    [projects, projectSortMode]
  )
  const handleProjectSortModeChange = useCallback((value: string) => {
    const mode = value as ProjectSortMode
    setProjectSortMode(mode)
    writeProjectSortMode(mode)
  }, [])
  const sortedUnassigned = useMemo(() => sortSessions(unassignedSessions), [unassignedSessions])

  // Global conversations section collapses like a project row; expanded by
  // default since it is the primary unscoped session list.
  const [conversationsExpanded, setConversationsExpanded] = useState(true)

  const toggleProjectExpand = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])
  // Unassigned session list: show the first N by default, "load more" reveals the rest.
  const UNASSIGNED_COLLAPSE_COUNT = 5
  const [showAllUnassigned, setShowAllUnassigned] = React.useState(false)
  React.useEffect(() => {
    setShowAllUnassigned(false)
  }, [sessions])
  const hasHiddenUnassigned =
    !showAllUnassigned && sortedUnassigned.length > UNASSIGNED_COLLAPSE_COUNT
  const visibleUnassigned = hasHiddenUnassigned
    ? sortedUnassigned.slice(0, UNASSIGNED_COLLAPSE_COUNT)
    : sortedUnassigned

  const handleNewChat = useCallback(() => {
    // Don't create a session yet — just navigate to home.
    // The session is created when the user actually sends a message.
    setActiveProjectHome(null)
    useUIStore.getState().setMode('chat')
    setActiveNavItem('chat')
    navigateToHome()
  }, [setActiveProjectHome, setActiveNavItem, navigateToHome])

  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)

  const handleNewProject = useCallback(() => {
    setCreateProjectDialogOpen(true)
  }, [])

  const handleCreateProjectWithDirectory = useCallback(
    async (folderPath: string, connectionId: string | null, projectName?: string) => {
      const name = projectName?.trim() || folderPath.split(/[\\/]/).pop() || 'New Project'
      const projectId = await createProject({ name, workingFolder: folderPath, sshConnectionId: connectionId ?? undefined })
      useChatStore.getState().setActiveProjectHome(projectId)
      useUIStore.getState().navigateToProject(projectId)
      toast.success(t('sidebar.projectCreated', { defaultValue: 'Project created' }))
      setCreateProjectDialogOpen(false)
    },
    [createProject, t]
  )

  // Collapsed state: completely hidden, use TitleBar button to expand
  if (!leftSidebarOpen) {
    return null
  }

  // ─── Nav items (top buttons) ───
  const navItems: NavButtonItem[] = [
    {
      key: 'new-chat',
      label: t('sidebar.newChat', { defaultValue: 'New Chat' }),
      icon: <Plus className="size-4 shrink-0" />,
      active: false,
      onClick: handleNewChat
    },
    {
      key: 'search',
      label: t('sidebar.searchLabel', { defaultValue: 'Search' }),
      icon: <Search className="size-4 shrink-0" />,
      active: false,
      onClick: () => setSearchOpen(true)
    }
  ]

  // ─── Extension items ───
  const extensionItems = [
    { id: 'draw', icon: <Image className="size-4" />, label: t('sidebar.drawLabel', { defaultValue: 'Draw' }), onClick: openDrawPage },
    { id: 'automation', icon: <Clock3 className="size-4" />, label: t('sidebar.automationLabel', { defaultValue: 'Automation' }), onClick: openTasksPage },
    { id: 'taskboard', icon: <SquareKanban className="size-4" />, label: t('sidebar.taskBoardLabel', { defaultValue: 'Task Board' }), onClick: openTaskBoardPage }
  ]

  const currentWidth = leftSidebarWidth || 260

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      style={{ width: currentWidth }}
    >
      {/* Title bar area */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-2">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground/90">
          Wishful Claw
        </div>
      </div>

      {/* Nav items + search + extensions */}
      <div className="space-y-1 px-2 py-1.5">
        {navItems.map(renderNavItem)}

        {/* Extensions dropdown (collapsible, hover-to-open) */}
        <DropdownMenu modal={false} open={extensionsOpen} onOpenChange={setExtensionsOpen}>
          {/* Wrapper extends past the sidebar edge to bridge the hover gap
              between trigger and content — prevents close/reopen flicker */}
          <div className="-mr-1.5 pr-1.5" onMouseEnter={openExtensions} onMouseLeave={closeExtensions}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-8 w-full items-center gap-2 px-2 text-[13px] font-medium transition-colors rounded-md',
                  extensionsOpen
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Plug className="size-4 shrink-0" />
                <span className="truncate">{t('sidebar.extensionsLabel', { defaultValue: 'Extensions' })}</span>
                <ChevronRight className="ml-auto size-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={6}
            className="w-40"
            onMouseEnter={openExtensions}
            onMouseLeave={closeExtensions}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            {extensionItems.map((ext) => (
              <DropdownMenuItem
                key={ext.id}
                onSelect={() => {
                  ext.onClick?.()
                  setExtensionsOpen(false)
                }}
              >
                {ext.icon}
                <span>{ext.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Project section header */}
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
          {t('sidebar.projects', { defaultValue: 'Projects' })}
        </span>

        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                title={t('sidebar.projectSortTitle', { defaultValue: 'Sort projects' })}
              >
                <ListFilter className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="px-2 py-1 text-[11px] text-muted-foreground">
                {t('sidebar.projectSortBy', { defaultValue: 'Sort by' })}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={projectSortMode}
                onValueChange={handleProjectSortModeChange}
              >
                {PROJECT_SORT_MODES.map((mode) => {
                  const Icon = mode === 'name' ? ArrowDownAZ : mode === 'createdAt' ? CalendarDays : ListFilter
                  const labelKey = mode === 'name'
                    ? 'sidebar.projectSortName'
                    : mode === 'createdAt'
                      ? 'sidebar.projectSortCreatedAt'
                      : 'sidebar.projectSortRecentlyUpdated'
                  return (
                    <DropdownMenuRadioItem key={mode} value={mode}>
                      <Icon className="size-4" />
                      {t(labelKey, { defaultValue: mode })}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleNewProject}
                className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                title={t('sidebar.newProject', { defaultValue: 'New Project' })}
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('sidebar.newProject', { defaultValue: 'New Project' })}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {/* Projects */}
        {sortedProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            sessions={projectSessions[project.id] ?? []}
            isExpanded={expandedProjects.has(project.id)}
            onToggleExpand={() => toggleProjectExpand(project.id)}
          />
        ))}

        {/* Unassigned sessions — collapsible section row, same interaction as projects */}
        {sortedUnassigned.length > 0 && (
          <div className="mt-2 select-none">
            <div
              onClick={() => setConversationsExpanded((v) => !v)}
              className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <MessageSquare className="size-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
              <span className="flex-1 truncate text-xs font-medium">
                {t('sidebar.conversations', { defaultValue: 'Conversations' })}
              </span>
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  conversationsExpanded && 'rotate-90'
                )}
              />
            </div>
            {conversationsExpanded && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 pl-2">
                {visibleUnassigned.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={activeSessionId === session.id}
                    onClick={() => navigateToSession(session.id)}
                  />
                ))}
                {hasHiddenUnassigned && (
                  <button
                    type="button"
                    onClick={() => setShowAllUnassigned(true)}
                    className="mt-0.5 rounded px-2 py-1 text-left text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t('sidebar.loadMoreSessions', {
                      defaultValue: 'Load more ({{count}} hidden)',
                      count: sortedUnassigned.length - UNASSIGNED_COLLAPSE_COUNT
                    })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {sortedProjects.length === 0 && sortedUnassigned.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <MessageSquare className="size-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground/60">
              {t('sidebar.noSessionsYet', { defaultValue: 'No sessions yet. Click "New Chat" to start.' })}
            </p>
          </div>
        )}
      </div>

      {/* Bottom: Settings + version */}
      <div className="border-t px-2 py-1.5">
        <button
          onClick={() => useUIStore.getState().openSettings('provider')}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="size-3.5" />
          {t('navRail.settings', { defaultValue: 'Settings' })}
          <span className="ml-auto text-[9px] text-muted-foreground/40 select-none">{APP_VERSION_LABEL}</span>
        </button>
      </div>

      <ResizeHandle />

      <WorkingFolderSelectorDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
        createMode
        projectName={t('sidebar.newProject', { defaultValue: 'New Project' })}
        onSelectLocalFolder={(folderPath, projectName) => handleCreateProjectWithDirectory(folderPath, null, projectName)}
        onSelectSshFolder={(folderPath, connectionId, projectName) =>
          handleCreateProjectWithDirectory(folderPath, connectionId, projectName)
        }
      />

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </aside>
  )
}
