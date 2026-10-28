import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { SessionGoalPlanTask, SessionGoalTask } from '@renderer/stores/goal-store-helpers'
import type { GoalLiveSnapshot } from '@renderer/stores/goal-history-store'
import { GoalPlanTaskStatusBadge } from './badges'
import { formatRoundDuration, planTaskChainRoot } from './helpers'
import type { GoalPlanSummary } from './types'

interface GoalPlanListProps {
  plans: GoalPlanSummary[]
  planTasks: SessionGoalPlanTask[]
  expandedPlanTasks: SessionGoalTask[]
  expandedPlanId: string | null
  onToggleExpanded: (planId: string | null) => void
  liveSnapshot: GoalLiveSnapshot | null
  selectedRunState: string
}

export function GoalPlanList({
  plans,
  planTasks,
  expandedPlanTasks,
  expandedPlanId,
  onToggleExpanded,
  liveSnapshot,
  selectedRunState
}: GoalPlanListProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{t('goal.history.plans')}</h3>
      <div className="space-y-1.5">
        {plans.map((plan, index) => {
          const planKey = plan.planId ?? `plan-${index}`
          const planRoot = planTaskChainRoot(plan.planId, plan.originalPlanId)
          const planRounds = planTasks.filter(
            (task) =>
              planTaskChainRoot(task.planId, task.originalPlanId) === planRoot ||
              task.planId === plan.planId
          )
          // While a round is still executing it has no summary/evaluation
          // yet — its title duplicates the task row below, so hide just
          // the executing row and keep finished rounds visible.
          const visibleRounds = planRounds.filter((r) => r.status !== 'executing')
          const expanded = expandedPlanId === planKey
          return (
            <div key={planKey} className="rounded-md border border-border/60 px-2.5 py-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left text-xs"
                onClick={() => onToggleExpanded(expanded ? null : planKey)}
              >
                <span className="min-w-0 truncate font-medium">
                  {plan.title ?? `Plan ${index + 1}`}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {planRounds.length > 0 ? (
                    <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                      {t('goal.history.roundsCount', { count: planRounds.length })}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    {t(
                      `goal.history.taskStatus.${
                        plan.status === 'active' && selectedRunState !== 'running'
                          ? // Goal not running: an "active" plan is not executing
                            // right now — show interrupted instead of a false 执行中.
                            'interrupted'
                          : (plan.status ?? 'pending')
                      }`
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{expanded ? '▴' : '▾'}</span>
                </span>
              </button>
              {plan.resultSummary ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{plan.resultSummary}</p>
              ) : null}
              {expanded ? (
                <>
                  {liveSnapshot ? (
                    <div className="mt-2 rounded-sm bg-blue-500/5 px-2 py-1.5">
                      <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {liveSnapshot.currentAction === 'executing'
                          ? t('goal.history.liveExecuting', {
                              title: liveSnapshot.currentTitle ?? '',
                              defaultValue: `Executing: ${liveSnapshot.currentTitle ?? ''}`
                            })
                          : liveSnapshot.currentAction === 'deciding'
                            ? t('goal.history.liveDeciding', {
                                defaultValue: 'Deciding next action…'
                              })
                            : liveSnapshot.currentAction}
                      </p>
                      {liveSnapshot.steps.length > 0 ? (
                        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-1">
                          {[...liveSnapshot.steps].reverse().map((s) => (
                            <div
                              key={s.step}
                              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                            >
                              <span className="shrink-0 font-mono">#{s.step}</span>
                              <span
                                className={cn(
                                  'shrink-0',
                                  s.succeeded
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-500'
                                )}
                              >
                                {s.succeeded ? '✓' : '✗'}
                              </span>
                              <span className="min-w-0 truncate">{s.title}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {expandedPlanTasks.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                        {t('goal.history.tasks', { defaultValue: 'Tasks' })}
                      </p>
                      {expandedPlanTasks.map((task) => (
                        <div key={task.taskId} className="rounded-sm bg-muted/30 px-2 py-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="min-w-0 truncate font-medium">
                              {task.ordinal + 1}. {task.title}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                              {task.status === 'active' && task.startedAt
                                ? formatRoundDuration(task.startedAt, null)
                                : null}
                              {t(`goal.history.taskStatus.${task.status}`)}
                            </span>
                          </div>
                          {task.resultSummary ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                              {task.resultSummary}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {visibleRounds.length > 0 ? (
                    // Finished rounds only — an executing round has no summary yet and its
                    // title duplicates the task row above, so it stays hidden while running.
                    <div className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
                      {visibleRounds.map((task) => (
                        <div key={task.id} className="rounded-sm bg-muted/40 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex items-center gap-1.5 font-medium">
                              {t('goal.history.round', { round: task.round })}
                              {task.adjusted ? (
                                <span className="rounded-sm bg-amber-500/15 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                                  {t('goal.history.adjusted')}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <GoalPlanTaskStatusBadge status={task.status} />
                              {task.startedAt
                                ? formatRoundDuration(task.startedAt, task.finishedAt)
                                : null}
                            </span>
                          </div>
                          {task.summary ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">{task.summary}</p>
                          ) : null}
                          {task.evaluationReasoning ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              <span className="font-medium">{t('goal.history.evaluation')}:</span>{' '}
                              {task.evaluationReasoning}
                            </p>
                          ) : null}
                          {task.steps && task.steps.length > 0 ? (
                            <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground/80">
                              {task.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : expandedPlanTasks.length === 0 ? (
                    <p className="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground/70">
                      {t('goal.history.noRoundRecords')}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
