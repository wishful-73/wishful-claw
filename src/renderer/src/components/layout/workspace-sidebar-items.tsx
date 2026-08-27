import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Plus, Pin, Trash2, Pencil, Folder, FolderOpen, Eraser, Copy, Archive, Loader2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore, type Session, type Project } from '@renderer/stores/chat-store'
import { cn } from '@renderer/lib/utils'
import { toast } from 'sonner'
import { MoreHorizontal } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import * as React from 'react'

// ─── Helpers ───


export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) {
    // Cross-day: show yesterday with time
    const date = new Date(timestamp)
    const h = date.getHours().toString().padStart(2, '0')
    const m = date.getMinutes().toString().padStart(2, '0')
    return `昨天 ${h}:${m}`
  }
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(timestamp)
  return date.toLocaleDateString()
}

// --- Project sort ---

export const PROJECT_SORT_MODES = ['updatedAt', 'name', 'createdAt'] as const
export type ProjectSortMode = (typeof PROJECT_SORT_MODES)[number]

const PROJECT_SORT_STORAGE_KEY = 'wishfulClaw.workspaceSidebar.projectSortMode'

export function readProjectSortMode(): ProjectSortMode {
  try {
    const stored = window.localStorage.getItem(PROJECT_SORT_STORAGE_KEY)
    if (stored === 'updatedAt' || stored === 'name' || stored === 'createdAt') return stored
  } catch {
    // ignore
  }
  return 'updatedAt'
}

export function writeProjectSortMode(mode: ProjectSortMode): void {
  try {
    window.localStorage.setItem(PROJECT_SORT_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt - a.updatedAt
  })
}

export function sortProjects(
  projects: Project[],
  mode: ProjectSortMode = 'updatedAt',
  collator?: Intl.Collator
): Project[] {
  const nameCollator = collator ?? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...projects].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    if (mode === 'name') {
      return (
        nameCollator.compare(a.name, b.name) ||
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id)
      )
    }
    if (mode === 'createdAt') {
      return (
        b.createdAt - a.createdAt ||
        nameCollator.compare(a.name, b.name) ||
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id)
      )
    }
    return (
      b.updatedAt - a.updatedAt ||
      nameCollator.compare(a.name, b.name) ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id)
    )
  })
}

// ─── Session Item ───

interface SessionItemProps {
  session: Session
  isActive: boolean
  onClick: () => void
}

export function SessionItem({ session, isActive, onClick }: SessionItemProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const deleteSession = useChatStore((s) => s.deleteSession)
  const updateSessionTitle = useChatStore((s) => s.updateSessionTitle)
  const clearSessionMessages = useChatStore((s) => s.clearSessionMessages)
  const duplicateSession = useChatStore((s) => s.duplicateSession)
  const togglePinSession = useChatStore((s) => s.togglePinSession)
  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const isStreaming = useChatStore((s) => Boolean(s.streamingMessages[session.id]))

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleRename = useCallback(() => {
    setEditTitle(session.title)
    setIsEditing(true)
  }, [session.title])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      updateSessionTitle(session.id, trimmed)
    }
    setIsEditing(false)
  }, [editTitle, session.id, session.title, updateSessionTitle])

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('sidebar.deleteSessionConfirmTitle', {
        defaultValue: 'Delete this session?'
      }),
      description: t('sidebar.deleteSessionConfirmDesc', {
        defaultValue:
          '"{{title}}" and its message history will be permanently deleted. This cannot be undone.',
        title: session.title
      }),
      variant: 'destructive'
    })
    if (!ok) return
    deleteSession(session.id)
  }, [session.id, session.title, deleteSession, t])

  const handleClear = useCallback(() => {
    clearSessionMessages(session.id)
    toast.success(t('sidebar.conversationCleared', { defaultValue: 'Conversation cleared' }))
  }, [session.id, clearSessionMessages, t])

  const handleDuplicate = useCallback(() => {
    const newId = duplicateSession(session.id)
    if (newId) {
      navigateToSession(newId)
      toast.success(t('sidebar.sessionDuplicated', { defaultValue: 'Session duplicated' }))
    }
  }, [session.id, duplicateSession, navigateToSession, t])

  if (isEditing) {
    return (
      <div className="px-2 py-1">
        <input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit()
            if (e.key === 'Escape') setIsEditing(false)
          }}
          className="w-full rounded border border-ring bg-background px-2 py-1 text-xs focus:outline-none"
        />
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            isActive
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
        >
          {session.pinned && <Pin className="size-3 shrink-0 text-primary/60" />}
          {isStreaming && (
            <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
          )}
          <span className="flex-1 truncate">{session.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground/40">
            {formatRelativeTime(session.updatedAt)}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleRename}>
          <Pencil className="mr-2 size-3.5" />
          {t('sidebar.rename', { defaultValue: 'Rename' })}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDuplicate}>
          <Copy className="mr-2 size-3.5" />
          {t('sidebar.duplicate', { defaultValue: 'Duplicate' })}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => togglePinSession(session.id)}>
          <Pin className="mr-2 size-3.5" />
          {session.pinned
            ? t('sidebar.unpin', { defaultValue: 'Unpin' })
            : t('sidebar.pin', { defaultValue: 'Pin' })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleClear}>
          <Eraser className="mr-2 size-3.5" />
          {t('sidebar.clearMessages', { defaultValue: 'Clear messages' })}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDelete} className="text-destructive">
          <Trash2 className="mr-2 size-3.5" />
          {t('sidebar.deleteSession', { defaultValue: 'Delete session' })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ─── Project Item ───

interface ProjectItemProps {
  project: Project
  sessions: Session[]
  isExpanded: boolean
  onToggleExpand: () => void
}

export function ProjectItem({ project, sessions, isExpanded, onToggleExpand }: ProjectItemProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const setActiveProjectHome = useChatStore((s) => s.setActiveProjectHome)
  const deleteProject = useChatStore((s) => s.deleteProject)
  const renameProject = useChatStore((s) => s.renameProject)
  const togglePinProject = useChatStore((s) => s.togglePinProject)
  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const navigateToArchive = useUIStore((s) => s.navigateToArchive)
  const navigateToGit = useUIStore((s) => s.navigateToGit)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const isActive = activeProjectId === project.id
  const sortedSessions = useMemo(() => sortSessions(sessions), [sessions])
  // Project-level running indicator: spins when any session under this
  // project is streaming (matches OpenCowork's project row spinner).
  const hasStreamingSession = useChatStore(
    (s) => sessions.some((session) => Boolean(s.streamingMessages[session.id]))
  )

  // Show the first N sessions by default; "load more" reveals the rest.
  // Reset when the underlying list changes (session deleted/added).
  const SESSION_COLLAPSE_COUNT = 5
  const [showAllSessions, setShowAllSessions] = React.useState(false)
  React.useEffect(() => {
    setShowAllSessions(false)
  }, [sessions])
  const hasHiddenSessions = !showAllSessions && sortedSessions.length > SESSION_COLLAPSE_COUNT
  const visibleSessions = hasHiddenSessions
    ? sortedSessions.slice(0, SESSION_COLLAPSE_COUNT)
    : sortedSessions

  const handleClick = useCallback(() => {
    setActiveProjectHome(project.id)
  }, [project.id, setActiveProjectHome])

  const handleRename = useCallback(() => {
    setEditName(project.name)
    setIsEditing(true)
  }, [project.name])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== project.name) {
      renameProject(project.id, trimmed)
    }
    setIsEditing(false)
  }, [editName, project.id, project.name, renameProject])

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('sidebar.deleteProjectConfirmTitle', {
        defaultValue: 'Delete this project?'
      }),
      description: t('sidebar.deleteProjectConfirmDesc', {
        defaultValue:
          'Project "{{name}}" and its sessions will be removed from the app. Files on disk are NOT deleted.',
        name: project.name
      }),
      variant: 'destructive'
    })
    if (!ok) return
    await deleteProject(project.id)
    toast.success(t('sidebar.projectDeleted', { defaultValue: 'Project deleted' }))
  }, [project.id, project.name, deleteProject, t])

  const handleChangeFolder = useCallback(async () => {
    if (!project.workingFolder) {
      toast.error(t('sidebar.noWorkingFolder', { defaultValue: 'No working folder set' }))
      return
    }
    // shell.openPath returns string (empty on success, error message on failure)
    const result = await ipcClient.invoke(IPC.SHELL_OPEN_PATH, { path: project.workingFolder })
    if (typeof result === 'string' && result.length > 0) {
      toast.error(t('sidebar.openFailed', { defaultValue: 'Failed to open folder' }), {
        description: result
      })
    }
  }, [project.workingFolder, t])

  const handleNewSessionInProject = useCallback(() => {
    // Navigate to project home. Session is created when user sends a message.
    setActiveProjectHome(project.id)
    const uiStore = useUIStore.getState()
    if (uiStore.mode === 'chat') {
      uiStore.setMode('cowork')
    }
    uiStore.navigateToProject(project.id)
  }, [project.id, setActiveProjectHome])

  if (isEditing) {
    return (
      <div className="px-2 py-1">
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit()
            if (e.key === 'Escape') setIsEditing(false)
          }}
          className="w-full rounded border border-ring bg-background px-2 py-1 text-xs font-medium focus:outline-none"
        />
      </div>
    )
  }

  return (
    <div className="select-none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => {
              // Two independent actions on click:
              // 1. Set as active project (highlight + navigate)
              // 2. Toggle expand/collapse
              // Neither action affects the other.
              handleClick()
              onToggleExpand()
            }}
            className={cn(
              'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors',
              isActive && activeSessionId === null
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            {project.pinned && <Pin className="size-3 shrink-0 text-primary/60" />}
            {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-sky-500 dark:text-sky-400" /> : <Folder className="size-3.5 shrink-0 text-sky-500 dark:text-sky-400" />}
            {hasStreamingSession && (
              <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
            )}
            <span className="flex-1 truncate text-xs font-medium">{project.name}</span>
            
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleNewSessionInProject()
                }}
                className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                title={t('sidebar.newSessionInProject', { defaultValue: 'New session here' })}
              >
                <Plus className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                    title={t('sidebar.moreActions', { defaultValue: 'More actions' })}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleNewSessionInProject}>
                    <Plus className="mr-2 size-3.5" />
                    {t('sidebar.newSessionInProject', { defaultValue: 'New session here' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRename}>
                    <Pencil className="mr-2 size-3.5" />
                    {t('sidebar.rename', { defaultValue: 'Rename' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => togglePinProject(project.id)}>
                    <Pin className="mr-2 size-3.5" />
                    {project.pinned
                      ? t('sidebar.unpin', { defaultValue: 'Unpin' })
                      : t('sidebar.pin', { defaultValue: 'Pin' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleChangeFolder}>
                    <FolderOpen className="mr-2 size-3.5" />
                    {t('sidebar.changeFolder', { defaultValue: 'Change working folder' })}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigateToArchive(project.id)}>
                    <Archive className="mr-2 size-3.5" />
                    {t('sidebar.archive', { defaultValue: 'Archive' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigateToGit(project.id)}>
                    <GitBranch className="mr-2 size-3.5" />
                    {t('sidebar.git', { defaultValue: 'Git' })}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    <Trash2 className="mr-2 size-3.5" />
                    {t('sidebar.deleteProject', { defaultValue: 'Delete project' })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleNewSessionInProject}>
            <Plus className="mr-2 size-3.5" />
            {t('sidebar.newSessionInProject', { defaultValue: 'New session here' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleRename}>
            <Pencil className="mr-2 size-3.5" />
            {t('sidebar.rename', { defaultValue: 'Rename' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => togglePinProject(project.id)}>
            <Pin className="mr-2 size-3.5" />
            {project.pinned
              ? t('sidebar.unpin', { defaultValue: 'Unpin' })
              : t('sidebar.pin', { defaultValue: 'Pin' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleChangeFolder}>
            <FolderOpen className="mr-2 size-3.5" />
            {t('sidebar.changeFolder', { defaultValue: 'Change working folder' })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => navigateToArchive(project.id)}>
            <Archive className="mr-2 size-3.5" />
            {t('sidebar.archive', { defaultValue: 'Archive' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => navigateToGit(project.id)}>
            <GitBranch className="mr-2 size-3.5" />
            {t('sidebar.git', { defaultValue: 'Git' })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 size-3.5" />
            {t('sidebar.deleteProject', { defaultValue: 'Delete project' })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Sessions under this project */}
      {isExpanded && sortedSessions.length > 0 && (
        <div className="ml-3 mt-0.5 flex flex-col gap-0.5 pl-2">
          {visibleSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onClick={() => navigateToSession(session.id)}
            />
          ))}
          {hasHiddenSessions && (
            <button
              type="button"
              onClick={() => setShowAllSessions(true)}
              className="mt-0.5 rounded px-2 py-1 text-left text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              {t('sidebar.loadMoreSessions', {
                defaultValue: 'Load more ({{count}} hidden)',
                count: sortedSessions.length - SESSION_COLLAPSE_COUNT
              })}
            </button>
          )}
        </div>
      )}
      {isExpanded && sortedSessions.length === 0 && (
        <div className="ml-6 py-1 text-[10px] text-muted-foreground/40">
          {t('sidebar.noSessions', { defaultValue: 'No sessions' })}
        </div>
      )}
    </div>
  )
}

// ─── Resize Handle ───

