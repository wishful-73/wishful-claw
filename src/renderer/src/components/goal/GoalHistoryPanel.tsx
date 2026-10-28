import * as React from 'react'
import { ArrowLeft, Loader2, Pause, Play, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { useChatStore } from '@renderer/stores/chat-store'
import {
  goalHistoryKey,
  goalPlanKey,
  goalProjectKey,
  useGoalHistoryStore
} from '@renderer/stores/goal-history-store'
import { formatGoalElapsedSeconds, formatGoalTokens } from '@renderer/lib/agent/goal-context'
import { GoalEventTimeline, useGoalActions } from './goal-session-views'
import { getGoalRuntimeControls, GoalStatusBadge } from './goal-session-utils'
import { useLiveGoalElapsedSeconds } from './goal-session-utils'
import { cancelGoalConfirm } from '@renderer/lib/tools/goal-native-ui'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { useGoalStore } from '@renderer/stores/goal-store'
import { Metric } from './goal-history/badges'
import { GoalHistoryList } from './goal-history/goal-history-list'
import { GoalPlanList } from './goal-history/goal-plan-list'
import {
  EMPTY_EVENTS,
  EMPTY_GOALS,
  EMPTY_PLANS,
  EMPTY_PLAN_TASKS,
  EMPTY_TASKS,
  GoalStatusValuesIsTerminal,
  matchesFilter,
  parsePlans,
  planTaskChainRoot
} from './goal-history/helpers'
import type { GoalHistoryFilter, GoalHistoryPanelProps, GoalPlanSummary } from './goal-history/types'

export type {
  GoalHistoryFilter,
  GoalHistoryPanelProps,
  GoalPlanSummary
} from './goal-history/types'

export function GoalHistoryPanel({
  projectId = null,
  initialSessionId,
  initialGoalId
}: GoalHistoryPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const projectKey = goalProjectKey(projectId)
  const goals = useGoalHistoryStore((state) => state.goalsByProject[projectKey] ?? EMPTY_GOALS)
  const loading = useGoalHistoryStore((state) => state.loadingProjects[projectKey] ?? false)
  const hasMoreGoals = useGoalHistoryStore(
    (state) => state.goalHasMoreByProject[projectKey] ?? false
  )
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
    selectedGoal ? (state.goalRunStatesBySession[selectedGoal.sessionId] ?? 'idle') : 'idle'
  )
  const selectedActions = useGoalActions(selectedGoal?.sessionId, selectedGoal ?? undefined)
  const selectedControls = getGoalRuntimeControls(selectedGoal ?? undefined, selectedRunState)
  const selectedKey = selectedGoal
    ? goalHistoryKey(selectedGoal.sessionId, selectedGoal.goalId)
    : ''
  const events = useGoalHistoryStore((state) =>
    selectedKey ? (state.eventsByGoal[selectedKey] ?? EMPTY_EVENTS) : EMPTY_EVENTS
  )
  const eventsLoading = useGoalHistoryStore((state) =>
    selectedKey ? (state.loadingGoals[selectedKey] ?? false) : false
  )
  const hasMoreEvents = useGoalHistoryStore((state) =>
    selectedKey ? (state.eventHasMoreByGoal[selectedKey] ?? false) : false
  )
  const planTasks = useGoalHistoryStore((state) =>
    selectedKey ? (state.planTasksByGoal[selectedKey] ?? EMPTY_PLAN_TASKS) : EMPTY_PLAN_TASKS
  )
  const goalPlans = useGoalHistoryStore((state) =>
    selectedKey ? (state.plansByGoal[selectedKey] ?? EMPTY_PLANS) : EMPTY_PLANS
  )
  // Tasks for the currently expanded plan (three-tier tree)
  const expandedPlanTaskKey =
    selectedGoal && expandedPlanId
      ? goalPlanKey(selectedGoal.sessionId, selectedGoal.goalId, expandedPlanId)
      : ''
  const expandedPlanTasks = useGoalHistoryStore((state) =>
    expandedPlanTaskKey ? (state.tasksByPlan[expandedPlanTaskKey] ?? EMPTY_TASKS) : EMPTY_TASKS
  )
  // Live in-memory snapshot (goal/live): 1s poll while the selected goal is
  // running — Worker memory, no SQLite round-trip.
  const liveSnapshot = useGoalHistoryStore((state) =>
    selectedGoal ? (state.liveByGoal[selectedGoal.goalId] ?? null) : null
  )
  // Live elapsed timer while the goal is running; falls back to the DB value.
  const activeRunStartedAt = useGoalStore((s) => {
    if (!selectedGoal) return null
    const activeRun = s.activeGoalRunsBySession[selectedGoal.sessionId]
    return activeRun && activeRun.goalId === selectedGoal.goalId ? activeRun.startedAt : null
  })
  const liveElapsedSeconds = useLiveGoalElapsedSeconds(
    selectedGoal ?? undefined,
    activeRunStartedAt,
    selectedRunState
  )

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
          void useGoalHistoryStore
            .getState()
            .loadPlanTasks(selectedGoal.sessionId, selectedGoal.goalId, plan.planId, true)
        }
      }
      void useGoalHistoryStore.getState().loadProjectGoals(projectId, true)
    }, 15000)
    return () => {
      window.clearInterval(liveTimer)
      window.clearInterval(dbTimer)
    }
  }, [
    projectId,
    selectedGoal?.goalId,
    selectedGoal?.sessionId,
    selectedGoal?.status,
    expandedPlanId
  ])

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
        useGoalHistoryStore
          .getState()
          .applyGoalStatus(
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
  }, [selectedActions, selectedGoal, t])

  if (selectedGoal) {
    const session = sessions.find((item) => item.id === selectedGoal.sessionId)
    const plansJsonParsed = parsePlans(selectedGoal) // Prefer goal_plans table data (three-tier) when available; fall back to plansJson.
    const allPlans: GoalPlanSummary[] =
      goalPlans.length > 0
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
      const root =
        planTaskChainRoot(plan.planId, plan.originalPlanId) ||
        plan.planId ||
        `plan-${allPlans.indexOf(plan)}`
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
    const planStartedAt =
      allPlans
        .map((p) => goalPlans.find((row) => row.planId === p.planId)?.startedAt ?? null)
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b)[0] ?? null
    const planFinishedAt =
      allPlans
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
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setSelectedGoalId(null)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">
              {session?.title ?? t('goal.history.deletedSession')}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {selectedGoal.sessionId}
            </div>
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
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {selectedGoal.objective}
            </p>
          </section>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric
              label={t('goal.tokensLabel')}
              value={formatGoalTokens(selectedGoal.tokensUsed)}
            />
            <Metric label={t('goal.timeLabel')} value={liveElapsedText} />
            <Metric
              label={t('goal.history.plans')}
              value={`${completedPlanCount} / ${plans.length}`}
            />
            <Metric
              label={t('goal.updatedAt')}
              value={new Date(selectedGoal.updatedAt).toLocaleString()}
            />
          </div>
          {selectedGoal.status === 'pending' || selectedGoal.status === 'active' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2">
              {selectedControls.canPause ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5"
                  disabled={selectedActions.transitioning !== null}
                  onClick={() => void selectedActions.setGoalStatus('paused')}
                >
                  <Pause className="size-3.5" />
                  {t('goal.pause')}
                </Button>
              ) : selectedControls.canResume ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5"
                  disabled={selectedActions.transitioning !== null}
                  onClick={() => void selectedActions.setGoalStatus('active')}
                >
                  {selectedActions.transitioning === 'starting' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
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
                {selectedActions.cancelling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {t('goal.cancel')}
              </Button>
              {selectedGoal.status === 'pending' ? (
                <span className="text-[11px] text-muted-foreground">
                  {t('goal.history.awaitingConfirmation')}
                </span>
              ) : null}
            </div>
          ) : null}
          {plans.length > 0 ? (
            <GoalPlanList
              plans={plans}
              planTasks={planTasks}
              expandedPlanTasks={expandedPlanTasks}
              expandedPlanId={expandedPlanId}
              onToggleExpanded={setExpandedPlanId}
              liveSnapshot={liveSnapshot}
              selectedRunState={selectedRunState}
            />
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
                onClick={() =>
                  void useGoalHistoryStore
                    .getState()
                    .loadMoreGoalEvents(selectedGoal.sessionId, selectedGoal.goalId)
                }
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
    <GoalHistoryList
      projectId={projectId}
      filteredGoals={filteredGoals}
      loading={loading}
      hasMoreGoals={hasMoreGoals}
      error={error}
      filter={filter}
      onFilterChange={setFilter}
      onSelectGoal={setSelectedGoalId}
    />
  )
}
