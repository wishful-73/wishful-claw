import * as React from 'react'
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Target, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chat-store'
import {
  goalHistoryKey,
  goalProjectKey,
  useGoalHistoryStore
} from '@renderer/stores/goal-history-store'
import { formatGoalElapsedSeconds, formatGoalTokens } from '@renderer/lib/agent/goal-context'
import { GoalEventTimeline, useGoalActions } from './goal-session-views'
import { getGoalRuntimeControls, GoalStatusBadge } from './goal-session-utils'
import { useLiveGoalElapsedSeconds } from './goal-session-utils'
import { cancelGoalConfirm } from '@renderer/lib/tools/goal-native-ui'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import {
  useGoalStore,
  type SessionGoal,
  type SessionGoalStatus
} from '@renderer/stores/goal-store'
import {
  type SessionGoalEvent,
  type SessionGoalPlanTask,
  type SessionGoalPlan,
  type SessionGoalTask
} from '@renderer/stores/goal-store-helpers'
import { goalPlanKey } from '@renderer/stores/goal-history-store'

const EMPTY_GOALS: SessionGoal[] = []
const EMPTY_EVENTS: SessionGoalEvent[] = []
const EMPTY_PLAN_TASKS: SessionGoalPlanTask[] = []
const EMPTY_PLANS: SessionGoalPlan[] = []
const EMPTY_TASKS: SessionGoalTask[] = []

/** Terminal DB statuses keep their badge; everything else renders by runState. */
function GoalStatusValuesIsTerminal(status: SessionGoalStatus): boolean {
  return status === 'complete' || status === 'aborted'
}

interface GoalHistoryPanelProps {
  projectId?: string | null
  initialSessionId?: string | null
  initialGoalId?: string | null
}

type GoalHistoryFilter = 'all' | 'current' | 'complete' | 'failed' | 'aborted'

interface GoalPlanSummary {
  planId?: string
  originalPlanId?: string | null
  title?: string
  status?: string
  resultSummary?: string | null
}

/**
 * adjust 会更换 planId（OriginalPlanId 指向最初的 id）。
 * 每轮执行记录与计划摘要按"链根 planId"匹配，保证调整前后轮次都归到同一计划卡片。
 */
function planTaskChainRoot(planId?: string | null, originalPlanId?: string | null): string {
  return originalPlanId ?? planId ?? ''
}

function matchesFilter(status: SessionGoalStatus, filter: GoalHistoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return status === 'pending' || status === 'active'
  return status === filter
}

function GoalPlanTaskStatusBadge({ status }: { status: SessionGoalPlanTask['status'] }): React.JSX.Element {
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

function formatRoundDuration(startedAt: number, finishedAt?: number | null): string {
  if (!startedAt) return ''
  const end = finishedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  if (minutes < 60) return rem > 0 ? `${minutes}m${rem}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

function parsePlans(goal: SessionGoal): GoalPlanSummary[] {
  if (!goal.plansJson) return []
  try {
    const value = JSON.parse(goal.plansJson)
    return Array.isArray(value) ? value as GoalPlanSummary[] : []
  } catch {
    return []
  }
}

export function GoalHistoryPanel({
  projectId = null,
  initialSessionId,
  initialGoalId
}: GoalHistoryPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const projectKey = goalProjectKey(projectId)
  const goals = useGoalHistoryStore((state) => state.goalsByProject[projectKey] ?? EMPTY_GOALS)
  const loading = useGoalHistoryStore((state) => state.loadingProjects[projectKey] ?? false)
  const hasMoreGoals = useGoalHistoryStore((state) => state.goalHasMoreByProject[projectKey] ?? false)
  const error = useGoalHistoryStore((state) => state.errorsByProject[projectKey])
  const sessions = useChatStore((state) => state.sessions)
  const [selectedGoalId, setSelectedGoalId] = React.useState<string | null>(initialGoalId ?? null)
  const [filter, setFilter] = React.useState<GoalHistoryFilter>('all')
  const [expandedPlanId, setExpandedPlanId] = React.useState<string | null>(null)

  React.useEffect(() => {
    void useGoalHistoryStore.getState().loadProjectGoals(projectId)
  }, [projectId])

  React.useEffect(() => {
    if (initialGoalId) {
      setSelectedGoalId(initialGoalId)
      return
    }
    if (!initialSessionId) return
    const match = goals.find((goal) => goal.sessionId === initialSessionId)
    if (match) setSelectedGoalId(match.goalId)
  }, [goals, initialGoalId, initialSessionId])

  const filteredGoals = React.useMemo(
    () => goals.filter((goal) => matchesFilter(goal.status, filter)),
    [filter, goals]
  )
  const selectedGoal = goals.find((goal) => goal.goalId === selectedGoalId) ?? null
  const selectedRunState = useGoalStore((state) =>
    selectedGoal ? state.goalRunStatesBySession[selectedGoal.sessionId] ?? 'idle' : 'idle'
  )
  const selectedActions = useGoalActions(selectedGoal?.sessionId, selectedGoal ?? undefined)
  const selectedControls = getGoalRuntimeControls(selectedGoal ?? undefined, selectedRunState)
  const selectedKey = selectedGoal
    ? goalHistoryKey(selectedGoal.sessionId, selectedGoal.goalId)
    : ''
  const events = useGoalHistoryStore((state) =>
    selectedKey ? state.eventsByGoal[selectedKey] ?? EMPTY_EVENTS : EMPTY_EVENTS
  )
  const eventsLoading = useGoalHistoryStore((state) =>
    selectedKey ? state.loadingGoals[selectedKey] ?? false : false
  )
  const hasMoreEvents = useGoalHistoryStore((state) =>
    selectedKey ? state.eventHasMoreByGoal[selectedKey] ?? false : false
  )
  const planTasks = useGoalHistoryStore((state) =>
    selectedKey ? state.planTasksByGoal[selectedKey] ?? EMPTY_PLAN_TASKS : EMPTY_PLAN_TASKS
  )
  const goalPlans = useGoalHistoryStore((state) =>
    selectedKey ? state.plansByGoal[selectedKey] ?? EMPTY_PLANS : EMPTY_PLANS
  )
  // Tasks for the currently expanded plan (three-tier tree)
  const expandedPlanTaskKey = (selectedGoal && expandedPlanId)
    ? goalPlanKey(selectedGoal.sessionId, selectedGoal.goalId, expandedPlanId)
    : ''
  const expandedPlanTasks = useGoalHistoryStore((state) =>
    expandedPlanTaskKey ? state.tasksByPlan[expandedPlanTaskKey] ?? EMPTY_TASKS : EMPTY_TASKS
  )
  // Live in-memory snapshot (goal/live): 1s poll while the selected goal is
  // running — Worker memory, no SQLite round-trip.
  const liveSnapshot = useGoalHistoryStore((state) =>
    selectedGoal ? state.liveByGoal[selectedGoal.goalId] ?? null : null
  )
  // Live elapsed timer while the goal is running; falls back to the DB value.
  const activeRunStartedAt = useGoalStore((s) => {
    if (!selectedGoal) return null
    const activeRun = s.activeGoalRunsBySession[selectedGoal.sessionId]
    return activeRun && activeRun.goalId === selectedGoal.goalId ? activeRun.startedAt : null
  })
  const liveElapsedSeconds = useLiveGoalElapsedSeconds(selectedGoal ?? undefined, activeRunStartedAt, selectedRunState)

  React.useEffect(() => {
    if (!selectedGoal) return
    void useGoalHistoryStore
      .getState()
      .loadGoalEvents(selectedGoal.sessionId, selectedGoal.goalId)
    void useGoalHistoryStore
      .getState()
      .loadGoalPlanTasks(selectedGoal.sessionId, selectedGoal.goalId)
    void useGoalHistoryStore
      .getState()
      .loadGoalPlans(selectedGoal.sessionId, selectedGoal.goalId)
  }, [selectedGoal?.goalId, selectedGoal?.sessionId])

  // Load tasks for a plan when it is expanded
  React.useEffect(() => {
    if (!selectedGoal || !expandedPlanId) return
    void useGoalHistoryStore
      .getState()
      .loadPlanTasks(selectedGoal.sessionId, selectedGoal.goalId, expandedPlanId)
  }, [selectedGoal?.goalId, selectedGoal?.sessionId, expandedPlanId])

  // 刷新事件时（loadMore / 轮询）同步刷新每轮执行记录，保证进行中 goal 实时更新。
  // goalPlans 通过 ref 读取：直接放进依赖数组会形成"轮询结果重置轮询计时器"
  // 的自触发循环（每次 loadGoalPlans 都产生新数组引用）。
  const goalPlansRef = React.useRef(goalPlans)
  React.useEffect(() => {
    goalPlansRef.current = goalPlans
  }, [goalPlans])

  React.useEffect(() => {
    if (!selectedGoal || selectedGoal.status !== 'active') return
    // Primary poll: 1s in-memory live snapshot (goal/live) — no DB cost.
    const liveTimer = window.setInterval(() => {
      void useGoalHistoryStore.getState().loadGoalLive(selectedGoal.goalId)
    }, 1000)
    // Fallback poll: 15s DB refresh keeps persisted history (plans/tasks/goal
    // row) in sync for the moment the goal finishes and live goes null.
    const dbTimer = window.setInterval(() => {
      void useGoalHistoryStore
        .getState()
        .loadGoalPlanTasks(selectedGoal.sessionId, selectedGoal.goalId, true)
      void useGoalHistoryStore
        .getState()
        .loadGoalPlans(selectedGoal.sessionId, selectedGoal.goalId, true)
      if (expandedPlanId) {
        const plan = goalPlansRef.current.find((p) => p.planId === expandedPlanId)
        if (plan) {
          void useGoalHistoryStore.getState().loadPlanTasks(
            selectedGoal.sessionId, selectedGoal.goalId, plan.planId, true
          )
        }
      }
      void useGoalHistoryStore.getState().loadProjectGoals(projectId, true)
    }, 15000)
    return () => {
      window.clearInterval(liveTimer)
      window.clearInterval(dbTimer)
    }
  }, [projectId, selectedGoal?.goalId, selectedGoal?.sessionId, selectedGoal?.status, expandedPlanId])

  const cancelSelectedGoal = React.useCallback(async (): Promise<void> => {
    if (!selectedGoal) return
    if (selectedGoal.status === 'pending') {
      const confirmed = await confirm({
        title: t('goal.cancelConfirmTitle'),
        description: t('goal.cancelConfirmDesc'),
        confirmLabel: t('goal.cancelConfirmYes'),
        cancelLabel: t('goal.cancelConfirmNo'),
        variant: 'destructive'
      })
      if (!confirmed) return
      const resolved = cancelGoalConfirm(selectedGoal.goalId, selectedGoal.sessionId)
      if (resolved) {
        useGoalHistoryStore.getState().applyGoalStatus(
          selectedGoal.projectId,
          selectedGoal.sessionId,
          selectedGoal.goalId,
          'aborted',
          Date.now()
        )
        return
      }
      await useGoalStore.getState().cancelGoal(selectedGoal.sessionId, selectedGoal.goalId)
      return
    }
    await selectedActions.cancelGoal()
  }, [selectedActions, selectedGoal, t, tCommon])

  if (selectedGoal) {
    const session = sessions.find((item) => item.id === selectedGoal.sessionId)
    const plansJsonParsed = parsePlans(selectedGoal)    // Prefer goal_plans table data (three-tier) when available; fall back to plansJson.
    const allPlans: GoalPlanSummary[] = goalPlans.length > 0
      ? goalPlans.map((p) => ({
          planId: p.planId,
          originalPlanId: p.originalPlanId,
          title: p.title,
          status: p.status,
          resultSummary: p.resultSummary
        }))
      : plansJsonParsed
    // Adjust replaces the planId and marks the old row superseded — collapse
    // each chain (root → adjusted versions) into its latest card so the list
    // doesn't show a stale duplicate next to the live one.
    const latestByChainRoot = new Map<string, GoalPlanSummary>()
    for (const plan of allPlans) {
      const root = planTaskChainRoot(plan.planId, plan.originalPlanId) || plan.planId || `plan-${allPlans.indexOf(plan)}`
      const existing = latestByChainRoot.get(root)
      if (!existing || (plan.status !== 'superseded' && existing.status === 'superseded')) {
        latestByChainRoot.set(root, plan)
      }
    }
    const plans = Array.from(latestByChainRoot.values())
    // Progress counters derived from the plan rows themselves — the
    // session_goals row is only refreshed on poll and lags behind.
    const completedPlanCount = plans.filter((p) => p.status === 'complete').length
    // Elapsed: live timer while running; otherwise derive from plan timeline
    // (first started → last finished) since session_goals.time_used_seconds
    // is never accounted (the usage channel has no caller yet).
    const planStartedAt = allPlans
      .map((p) => goalPlans.find((row) => row.planId === p.planId)?.startedAt ?? null)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b)[0] ?? null
    const planFinishedAt = allPlans
      .map((p) => goalPlans.find((row) => row.planId === p.planId)?.completedAt ?? null)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => b - a)[0] ?? null
    const derivedElapsedSeconds = planStartedAt
      ? Math.max(0, Math.floor(((planFinishedAt ?? Date.now()) - planStartedAt) / 1000))
      : selectedGoal.timeUsedSeconds
    const liveElapsedText = formatGoalElapsedSeconds(
      liveElapsedSeconds > 0 ? liveElapsedSeconds : derivedElapsedSeconds
    )
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelectedGoalId(null)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{session?.title ?? t('goal.history.deletedSession')}</div>
            <div className="truncate text-[10px] text-muted-foreground">{selectedGoal.sessionId}</div>
          </div>
          {selectedRunState === 'running' ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
              <Loader2 className="size-2.5 animate-spin" />
              {t('goal.status.running', { defaultValue: 'Running' })}
            </span>
          ) : selectedRunState === 'paused' ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
              {t('goal.status.paused')}
            </span>
          ) : !GoalStatusValuesIsTerminal(selectedGoal.status) ? (
            // Non-terminal goal not currently running: show the RUNTIME state
            // (idle), not the DB business status — "进行中" would falsely imply
            // the orchestrator is executing right now.
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('goal.status.idle', { defaultValue: 'Idle' })}
            </span>
          ) : (
            <GoalStatusBadge status={selectedGoal.status} />
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{t('goal.objectiveLabel')}</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">{selectedGoal.objective}</p>
          </section>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric label={t('goal.tokensLabel')} value={formatGoalTokens(selectedGoal.tokensUsed)} />
            <Metric label={t('goal.timeLabel')} value={liveElapsedText} />
            <Metric label={t('goal.history.plans')} value={`${completedPlanCount} / ${plans.length}`} />
            <Metric label={t('goal.updatedAt')} value={new Date(selectedGoal.updatedAt).toLocaleString()} />
          </div>
          {selectedGoal.status === 'pending' || selectedGoal.status === 'active' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2">
              {selectedControls.canPause ? (
                <Button variant="outline" size="sm" className="h-7 gap-1.5" disabled={selectedActions.transitioning !== null} onClick={() => void selectedActions.setGoalStatus('paused')}>
                  <Pause className="size-3.5" />
                  {t('goal.pause')}
                </Button>
              ) : selectedControls.canResume ? (
                <Button variant="outline" size="sm" className="h-7 gap-1.5" disabled={selectedActions.transitioning !== null} onClick={() => void selectedActions.setGoalStatus('active')}>
                  {selectedActions.transitioning === 'starting' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {selectedRunState === 'idle' ? t('goal.start') : t('goal.resume')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-destructive"
                disabled={selectedActions.cancelling}
                onClick={() => void cancelSelectedGoal()}
              >
                {selectedActions.cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
                {t('goal.cancel')}
              </Button>
              {selectedGoal.status === 'pending' ? (
                <span className="text-[11px] text-muted-foreground">{t('goal.history.awaitingConfirmation')}</span>
              ) : null}
            </div>
          ) : null}
          {plans.length > 0 ? (
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
                        onClick={() => setExpandedPlanId(expanded ? null : planKey)}
                      >
                        <span className="min-w-0 truncate font-medium">{plan.title ?? `Plan ${index + 1}`}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {planRounds.length > 0 ? (
                            <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                              {t('goal.history.roundsCount', { count: planRounds.length })}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground">
                            {t(`goal.history.taskStatus.${
                              plan.status === 'active' && selectedRunState !== 'running'
                                ? // Goal not running: an "active" plan is not executing
                                  // right now — show interrupted instead of a false 执行中.
                                  'interrupted'
                                : plan.status ?? 'pending'
                            }`)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{expanded ? '▴' : '▾'}</span>
                        </span>
                      </button>
                      {plan.resultSummary ? <p className="mt-1 text-[11px] text-muted-foreground">{plan.resultSummary}</p> : null}
                      {expanded ? (
                        <>
                        {liveSnapshot ? (
                          <div className="mt-2 rounded-sm bg-blue-500/5 px-2 py-1.5">
                            <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" />
                              {liveSnapshot.currentAction === 'executing'
                                ? t('goal.history.liveExecuting', { title: liveSnapshot.currentTitle ?? '', defaultValue: `Executing: ${liveSnapshot.currentTitle ?? ''}` })
                                : liveSnapshot.currentAction === 'deciding'
                                  ? t('goal.history.liveDeciding', { defaultValue: 'Deciding next action…' })
                                  : liveSnapshot.currentAction}
                            </p>
                            {liveSnapshot.steps.length > 0 ? (
                              <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-1">
                                {[...liveSnapshot.steps].reverse().map((s) => (
                                  <div key={s.step} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <span className="shrink-0 font-mono">#{s.step}</span>
                                    <span className={cn('shrink-0', s.succeeded ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
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
                                    <p className="mt-0.5 text-[10px] text-muted-foreground/80">{task.resultSummary}</p>
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
                                    {task.startedAt ? formatRoundDuration(task.startedAt, task.finishedAt) : null}
                                  </span>
                                </div>
                                {task.summary ? <p className="mt-1 text-[11px] text-muted-foreground">{task.summary}</p> : null}
                                {task.evaluationReasoning ? (
                                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                                    <span className="font-medium">{t('goal.history.evaluation')}:</span> {task.evaluationReasoning}
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
          ) : null}
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{t('goal.timeline')}</h3>
            {eventsLoading && events.length === 0 ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <GoalEventTimeline events={events} maxItems={events.length} />
            )}
            {hasMoreEvents ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-[11px]"
                disabled={eventsLoading}
                onClick={() => void useGoalHistoryStore.getState().loadMoreGoalEvents(selectedGoal.sessionId, selectedGoal.goalId)}
              >
                {eventsLoading ? t('goal.history.loadingMore') : t('goal.history.loadMore')}
              </Button>
            ) : null}
          </section>
        </div>
      </div>
    )
  }

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
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border/50 px-2 py-2">
        {(['all', 'current', 'complete', 'failed', 'aborted'] as GoalHistoryFilter[]).map((item) => (
          <Button
            key={item}
            variant={filter === item ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => setFilter(item)}
          >
            {t(`goal.history.filters.${item}`)}
          </Button>
        ))}
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
                  className={cn('w-full rounded-lg border border-border/60 p-2.5 text-left transition-colors hover:bg-muted/50')}
                  onClick={() => setSelectedGoalId(goal.goalId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <GoalStatusBadge status={goal.status} />
                    <span className="text-[10px] text-muted-foreground">{new Date(goal.updatedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/90">{goal.objective}</p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {session?.title ?? t('goal.history.deletedSession')} · {goal.sessionId}
                  </p>
                  <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                    <span>{t('goal.history.planProgress', { completed: goal.completedPlanCount, total: goal.planCount })}</span>
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

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  )
}
