import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { SessionGoalPlanTask } from '@renderer/stores/goal-store-helpers'

export function GoalPlanTaskStatusBadge({
  status
}: {
  status: SessionGoalPlanTask['status']
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const cls =
    status === 'completed'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'failed'
        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
        : status === 'interrupted'
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
  return (
    <span className={cn('rounded-sm px-1 text-[10px]', cls)}>
      {t(`goal.history.taskStatus.${status}`)}
    </span>
  )
}

export function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  )
}
