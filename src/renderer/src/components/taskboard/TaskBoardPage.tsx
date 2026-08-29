/**
 * Task Board page — the global agent's workbench. Data source is global_tasks
 * + global_task_dispatches only (never the session-scoped tasks table).
 * Replaces the former PlaceholderPage behind the sidebar "Task Board" entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Loader2, Plus, RefreshCw, Search, SquareKanban } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useTaskBoardStore } from '@renderer/stores/task-board-store'
import {
  GLOBAL_TASK_STATUSES,
  parseTags,
  type GlobalDispatchKind,
  type GlobalTaskRow,
  type GlobalTaskStatus
} from './task-board-types'
import { PriorityBadge, TaskStatusBadge } from './TaskBoardBadges'
import { TaskDetailPane } from './TaskDetailPane'
import { TaskFormDialog } from './TaskFormDialog'
import { DispatchDialog } from './DispatchDialog'

type StatusFilter = 'all' | GlobalTaskStatus

export function TaskBoardPage(): React.JSX.Element {
  const { t } = useTranslation('taskboard')

  const tasks = useTaskBoardStore((s) => s.tasks)
  const loadingTasks = useTaskBoardStore((s) => s.loadingTasks)
  const selectedTaskId = useTaskBoardStore((s) => s.selectedTaskId)
  const selectTask = useTaskBoardStore((s) => s.selectTask)
  const loadTasks = useTaskBoardStore((s) => s.loadTasks)

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<GlobalTaskRow | null>(null)
  const [dispatchDialog, setDispatchDialog] = useState<{
    open: boolean
    initialSessionId: string | null
    initialKind: GlobalDispatchKind
  }>({ open: false, initialSessionId: null, initialKind: 'work_request' })

  const refresh = useCallback(() => {
    void loadTasks(true)
  }, [loadTasks])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visibleTasks = useMemo(() => {
    const lowered = keyword.trim().toLowerCase()
    return tasks.filter((task) => {
      if (showArchived ? task.archived !== 1 : task.archived === 1) return false
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (lowered) {
        const haystack = `${task.title} ${task.description} ${parseTags(task.tags).join(' ')}`.toLowerCase()
        if (!haystack.includes(lowered)) return false
      }
      return true
    })
  }, [tasks, keyword, statusFilter, showArchived])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  )

  const openDispatchDialog = useCallback((initialSessionId: string | null, initialKind: GlobalDispatchKind) => {
    setDispatchDialog({ open: true, initialSessionId, initialKind })
  }, [])

  const handleTaskSaved = useCallback(() => {
    refresh()
    // A newly archived/restored task may leave the selection stale.
    if (selectedTaskId) {
      void useTaskBoardStore.getState().loadDispatches(selectedTaskId)
    }
  }, [refresh, selectedTaskId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
        <SquareKanban className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{t('title')}</h1>
        <span className="text-xs text-muted-foreground">{t('subtitle')}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-8 w-44 pl-7 text-xs"
            />
          </div>

          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              {GLOBAL_TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Archive className="size-3.5" />
            {t('archivedView')}
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          </label>

          <Button variant="ghost" size="icon" className="size-8" title={t('refresh')} onClick={refresh}>
            <RefreshCw className={loadingTasks ? 'size-4 animate-spin' : 'size-4'} />
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setEditingTask(null)
              setFormOpen(true)
            }}
          >
            <Plus className="size-3.5" />
            {t('newTask')}
          </Button>
        </div>
      </div>

      {/* ── Body: list + detail ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: task list */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border/60">
          {loadingTasks && tasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
              <p className="text-xs text-muted-foreground/70">{t('emptyHint')}</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              {visibleTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => selectTask(task.id)}
                  className={`mb-1.5 flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors ${
                    task.id === selectedTaskId
                      ? 'border-primary/40 bg-accent'
                      : 'border-border/50 hover:bg-accent/50'
                  }`}
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug">{task.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <TaskStatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                  </span>
                  {task.due_at ? (
                    <span className="text-[11px] text-muted-foreground">
                      {t('detail.dueAt')}: {new Date(task.due_at).toLocaleString()}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail */}
        <div className="min-w-0 flex-1">
          {selectedTask ? (
            <TaskDetailPane
              task={selectedTask}
              onEdit={() => {
                setEditingTask(selectedTask)
                setFormOpen(true)
              }}
              onDispatch={openDispatchDialog}
              onChanged={handleTaskSaved}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <SquareKanban className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t('selectTaskHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ── */}
      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingTask={editingTask}
        onSaved={handleTaskSaved}
      />
      {selectedTask && (
        <DispatchDialog
          open={dispatchDialog.open}
          onOpenChange={(open) => setDispatchDialog((prev) => ({ ...prev, open }))}
          taskId={selectedTask.id}
          initialSessionId={dispatchDialog.initialSessionId}
          initialKind={dispatchDialog.initialKind}
          onSent={handleTaskSaved}
        />
      )}
    </div>
  )
}
