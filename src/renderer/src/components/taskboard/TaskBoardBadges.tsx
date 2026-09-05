/**
 * Task Board badges — visually distinguish global task status, dispatch status,
 * priority and dispatch kind. Global task status and dispatch status use
 * separate palettes on purpose: dispatch status must never be mistaken for a
 * live view into the target session's internal execution.
 */

import { useTranslation } from 'react-i18next'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type {
  GlobalDispatchKind,
  GlobalDispatchStatus,
  GlobalTaskPriority,
  GlobalTaskStatus
} from './task-board-types'

const TASK_STATUS_CLASSES: Record<GlobalTaskStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  blocked: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-green-500/15 text-green-600 dark:text-green-400',
  cancelled: 'bg-muted text-muted-foreground line-through'
}

const DISPATCH_STATUS_CLASSES: Record<GlobalDispatchStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  acknowledged: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  in_progress: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-500/15 text-green-600 dark:text-green-400',
  blocked: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground line-through'
}

const PRIORITY_CLASSES: Record<GlobalTaskPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-secondary text-secondary-foreground',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  urgent: 'bg-red-500/15 text-red-600 dark:text-red-400'
}

export function TaskStatusBadge({ status }: { status: GlobalTaskStatus }): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  return (
    <Badge variant="outline" className={cn('border-transparent', TASK_STATUS_CLASSES[status] ?? TASK_STATUS_CLASSES.pending)}>
      {t(`status.${status}`)}
    </Badge>
  )
}

export function DispatchStatusBadge({ status }: { status: GlobalDispatchStatus }): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  return (
    <Badge
      variant="outline"
      className={cn('border-transparent', DISPATCH_STATUS_CLASSES[status] ?? DISPATCH_STATUS_CLASSES.pending)}
    >
      {t(`dispatchStatus.${status}`)}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: GlobalTaskPriority }): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  return (
    <Badge variant="outline" className={cn('border-transparent', PRIORITY_CLASSES[priority] ?? PRIORITY_CLASSES.normal)}>
      {t(`priority.${priority}`)}
    </Badge>
  )
}

export function DispatchKindBadge({ kind }: { kind: GlobalDispatchKind }): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  return (
    <Badge variant="outline" className="border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400">
      {t(`kind.${kind}`)}
    </Badge>
  )
}
