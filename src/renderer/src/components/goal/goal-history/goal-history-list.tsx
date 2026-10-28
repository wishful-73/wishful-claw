import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Target } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useGoalHistoryStore } from '@renderer/stores/goal-history-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { GoalStatusBadge } from '../goal-session-utils'
import { formatGoalElapsedSeconds } from '@renderer/lib/agent/goal-context'
import type { SessionGoal } from '@renderer/stores/goal-store'
import type { GoalHistoryFilter } from './types'

interface GoalHistoryListProps {
  projectId: string | null
  filteredGoals: SessionGoal[]
  loading: boolean
  hasMoreGoals: boolean
  error?: string
  filter: GoalHistoryFilter
  onFilterChange: (filter: GoalHistoryFilter) => void
  onSelectGoal: (goalId: string) => void
}

export function GoalHistoryList({
  projectId,
  filteredGoals,
  loading,
  hasMoreGoals,
  error,
  filter,
  onFilterChange,
  onSelectGoal
}: GoalHistoryListProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const sessions = useChatStore((state) => state.sessions)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold">{t('goal.history.title')}</h3>
          <p className="text-[11px] text-muted-foreground">{t('goal.history.subtitle')}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={loading}
          onClick={() => void useGoalHistoryStore.getState().loadProjectGoals(projectId, true)}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border/50 px-2 py-2">
        {(['all', 'current', 'complete', 'failed', 'aborted'] as GoalHistoryFilter[]).map(
          (item) => (
            <Button
              key={item}
              variant={filter === item ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 shrink-0 px-2 text-[11px]"
              onClick={() => onFilterChange(item)}
            >
              {t(`goal.history.filters.${item}`)}
            </Button>
          )
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? <p className="p-2 text-xs text-destructive">{error}</p> : null}
        {!loading && filteredGoals.length === 0 && !hasMoreGoals ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Target className="size-6 opacity-60" />
            <p className="text-xs">{t('goal.history.empty')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredGoals.map((goal) => {
              const session = sessions.find((item) => item.id === goal.sessionId)
              return (
                <button
                  key={goal.goalId}
                  type="button"
                  className={cn(
                    'w-full rounded-lg border border-border/60 p-2.5 text-left transition-colors hover:bg-muted/50'
                  )}
                  onClick={() => onSelectGoal(goal.goalId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <GoalStatusBadge status={goal.status} />
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(goal.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/90">
                    {goal.objective}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {session?.title ?? t('goal.history.deletedSession')} · {goal.sessionId}
                  </p>
                  <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                    <span>
                      {t('goal.history.planProgress', {
                        completed: goal.completedPlanCount,
                        total: goal.planCount
                      })}
                    </span>
                    <span>{formatGoalElapsedSeconds(goal.timeUsedSeconds)}</span>
                  </div>
                </button>
              )
            })}
            {hasMoreGoals ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full text-[11px]"
                disabled={loading}
                onClick={() => void useGoalHistoryStore.getState().loadMoreProjectGoals(projectId)}
              >
                {loading ? t('goal.history.loadingMore') : t('goal.history.loadMore')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
