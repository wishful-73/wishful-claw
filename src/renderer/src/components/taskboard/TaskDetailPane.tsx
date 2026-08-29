/**
 * Task Board detail pane — selected global task info plus its permanent
 * dispatch records. Global task status (left select) and dispatch status
 * (per-row badges) are separate concepts and rendered distinctly. The pane
 * never shows target-session internal Todos.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ExternalLink, Loader2, Pencil, Plus, Send, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useTaskBoardStore } from '@renderer/stores/task-board-store'
import {
  GLOBAL_TASK_PRIORITIES,
  GLOBAL_TASK_STATUSES,
  parseTags,
  type GlobalDispatchKind,
  type GlobalTaskPriority,
  type GlobalTaskRow,
  type GlobalTaskStatus
} from './task-board-types'
import { DispatchKindBadge, DispatchStatusBadge, PriorityBadge, TaskStatusBadge } from './TaskBoardBadges'

interface TaskDetailPaneProps {
  task: GlobalTaskRow
  onEdit: () => void
  onDispatch: (initialSessionId: string | null, initialKind: GlobalDispatchKind) => void
  onChanged: () => void
}

/** Dispatches in completed/cancelled state can no longer be cancelled. */
const CANCELLABLE = new Set(['pending', 'sent', 'acknowledged', 'in_progress', 'blocked', 'failed'])

export function TaskDetailPane({ task, onEdit, onDispatch, onChanged }: TaskDetailPaneProps): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  const projects = useChatStore((s) => s.projects)
  const sessions = useChatStore((s) => s.sessions)
  const navigateToSession = useUIStore((s) => s.navigateToSession)

  const dispatches = useTaskBoardStore((s) => s.dispatches)
  const loadingDispatches = useTaskBoardStore((s) => s.loadingDispatches)
  const updateTask = useTaskBoardStore((s) => s.updateTask)
  const archiveTask = useTaskBoardStore((s) => s.archiveTask)
  const cancelDispatch = useTaskBoardStore((s) => s.cancelDispatch)
  const loadDispatches = useTaskBoardStore((s) => s.loadDispatches)

  const tags = useMemo(() => parseTags(task.tags), [task.tags])

  const sessionLabel = useCallback(
    (sessionId: string, projectId: string | null): string => {
      const session = sessions.find((s) => s.id === sessionId)
      const project = projects.find((p) => p.id === projectId)
      const sessionTitle = session?.title ?? t('detail.sessionMissing')
      return project ? `${project.name} / ${sessionTitle}` : sessionTitle
    },
    [sessions, projects, t]
  )

  const handleStatusChange = useCallback(
    async (status: GlobalTaskStatus) => {
      const ok = await updateTask(task.id, { status })
      if (ok) {
        onChanged()
      } else {
        toast.error(t('detail.updateFailed'))
      }
    },
    [task.id, updateTask, onChanged, t]
  )

  const handlePriorityChange = useCallback(
    async (priority: GlobalTaskPriority) => {
      const ok = await updateTask(task.id, { priority })
      if (ok) {
        onChanged()
      } else {
        toast.error(t('detail.updateFailed'))
      }
    },
    [task.id, updateTask, onChanged, t]
  )

  const handleArchiveToggle = useCallback(async () => {
    const ok = task.archived
      ? await updateTask(task.id, { archived: false })
      : await archiveTask(task.id)
    if (ok) {
      toast.success(task.archived ? t('detail.restored') : t('detail.archived'))
      onChanged()
    } else {
      toast.error(t('detail.updateFailed'))
    }
  }, [task.id, task.archived, updateTask, archiveTask, onChanged, t])

  const handleCancelDispatch = useCallback(
    async (dispatchId: string) => {
      const ok = await cancelDispatch(dispatchId)
      if (ok) {
        toast.success(t('detail.dispatchCancelled'))
        void loadDispatches(task.id)
      } else {
        toast.error(t('detail.dispatchCancelFailed'))
      }
    },
    [task.id, cancelDispatch, loadDispatches, t]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      {/* ── Task header ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold leading-snug">{task.title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" title={t('action.edit')} onClick={onEdit}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={task.archived ? t('detail.restore') : t('detail.archive')}
              onClick={() => void handleArchiveToggle()}
            >
              {task.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.due_at ? (
            <span className="text-xs text-muted-foreground">
              {t('detail.dueAt')}: {new Date(task.due_at).toLocaleString()}
            </span>
          ) : null}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}

        {task.description && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
        )}

        {/* Status / priority quick selects — global task status only */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">{t('detail.taskStatusLabel')}</label>
            <Select value={task.status} onValueChange={(value) => void handleStatusChange(value as GlobalTaskStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLOBAL_TASK_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">{t('field.priority')}</label>
            <Select value={task.priority} onValueChange={(value) => void handlePriorityChange(value as GlobalTaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLOBAL_TASK_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {t(`priority.${priority}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Dispatch records ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('detail.dispatchTitle')}</h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onDispatch(null, 'message')}>
              <Send className="size-3.5" />
              {t('detail.sendMessage')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onDispatch(null, 'work_request')}>
              <Plus className="size-3.5" />
              {t('detail.sendWorkRequest')}
            </Button>
          </div>
        </div>

        {loadingDispatches ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : dispatches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            {t('detail.noDispatches')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {dispatches.map((dispatch) => (
              <div key={dispatch.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <DispatchKindBadge kind={dispatch.kind} />
                  <DispatchStatusBadge status={dispatch.status} />
                  <span className="min-w-0 flex-1 truncate text-sm">{sessionLabel(dispatch.session_id, dispatch.project_id)}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('detail.openSession')}
                      onClick={() => navigateToSession(dispatch.session_id)}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('detail.followUp')}
                      onClick={() => onDispatch(dispatch.session_id, dispatch.kind)}
                    >
                      <Send className="size-3.5" />
                    </Button>
                    {CANCELLABLE.has(dispatch.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('detail.cancelDispatch')}
                        onClick={() => void handleCancelDispatch(dispatch.id)}
                      >
                        <XCircle className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {dispatch.instruction && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {dispatch.instruction}
                  </p>
                )}

                {dispatch.latest_report && (
                  <div className="mt-2 rounded bg-muted/60 p-2">
                    <p className="text-xs font-medium text-muted-foreground">{t('detail.latestReport')}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs">{dispatch.latest_report}</p>
                  </div>
                )}

                {dispatch.error && (
                  <p className="mt-2 text-xs text-red-500">{dispatch.error}</p>
                )}

                <p className="mt-2 text-[11px] text-muted-foreground/70">
                  {t('detail.updatedAt')}: {new Date(dispatch.updated_at).toLocaleString()}
                  {dispatch.completed_at ? ` · ${t('detail.completedAt')}: ${new Date(dispatch.completed_at).toLocaleString()}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
