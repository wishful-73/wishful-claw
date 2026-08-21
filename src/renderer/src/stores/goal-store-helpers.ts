
export type SessionGoalStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usage_limited'
  | 'budget_limited'
  | 'complete'
  | 'aborted'
  | 'interrupted'
  | 'failed'
export type GoalRunState = 'idle' | 'running' | 'paused'
export type SessionGoalEventType =
  | 'created'
  | 'replaced'
  | 'objective_updated'
  | 'budget_updated'
  | 'status_changed'
  | 'usage_accounted'
  | 'usage_limited'
  | 'budget_limited'
  | 'completion_deferred'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'stall_paused'
  | 'auto_continue_blocked'
  | 'reopened'
  | 'reopened_from'
  | 'cleared'

export interface SessionGoal {
  sessionId: string
  goalId: string
  projectId?: string | null
  objective: string
  status: SessionGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  plansJson?: string | null
  planCount: number
  completedPlanCount: number
  currentPlanIndex: number
  workingFolder?: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionGoalEvent {
  id: string
  sessionId: string
  goalId?: string | null
  eventType: SessionGoalEventType
  message?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: number
}

export interface ActiveGoalRun {
  goalId: string
  startedAt: number
}

export const EMPTY_SESSION_GOAL_EVENTS: SessionGoalEvent[] = []

// 后端 GoalRow / GoalEventRow 通过 InfrastructureJsonContext（CamelCase）或
// GoalEventRow 序列化，字段名为 camelCase。前端按 backend 实际返回的字段名对齐。
export interface SessionGoalRow {
  sessionId: string
  goalId: string
  projectId: string | null
  objective: string
  status: SessionGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  plansJson: string | null
  planCount: number
  completedPlanCount: number
  currentPlanIndex: number
  workingFolder: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionGoalEventRow {
  id: string | number
  sessionId: string
  goalId: string | null
  eventType: SessionGoalEventType
  message: string | null
  metadataJson: string | null
  createdAt: number
}

export interface GoalPageResult {
  items: SessionGoalRow[]
  hasMore: boolean
  nextCurrentRank?: number | null
  nextUpdatedAt?: number | null
  nextGoalId?: string | null
}

export interface GoalEventPageResult {
  items: SessionGoalEventRow[]
  hasMore: boolean
  nextCreatedAt?: number | null
  nextEventId?: number | null
}

export interface GoalMutationResult {
  success?: boolean
  error?: string
  goal?: SessionGoalRow | null
}

export interface GoalActionResult {
  success: boolean
  action: string
  status: string
  runState: string
  goalId?: string | null
  error?: string | null
}

export interface GoalEventMutationResult {
  success?: boolean
  error?: string
  event?: SessionGoalEventRow | null
}

interface AccountGoalUsageInput {
  sessionId: string
  timeDeltaSeconds: number
  tokenDelta: number
  expectedGoalId?: string | null
}

export interface GoalProgressState {
  sessionId: string
  goalId: string
  objective?: string
  eventType: string
  message: string
  status: string
  runState?: GoalRunState
  currentPlanIndex: number
  planCount: number
  completedPlans: number
  timestamp: number
}

export interface GoalActivity {
  id: string
  sessionId: string
  goalId: string
  planId: string
  round: number
  kind: 'tool_call' | 'tool_result' | 'iteration'
  toolName: string | null
  toolCallId: string | null
  status: string | null
  iteration: number | null
  timestamp: number
}

export interface GoalStore {
  goalsBySession: Record<string, SessionGoal>
  goalEventsBySession: Record<string, SessionGoalEvent[]>
  activeGoalRunsBySession: Record<string, ActiveGoalRun>
  goalProgressBySession: Record<string, GoalProgressState>
  goalRunStatesBySession: Record<string, GoalRunState>
  goalActivitiesByGoal: Record<string, GoalActivity[]>
  _loaded: boolean

  loadGoalsFromDb: () => Promise<void>
  loadGoalForSession: (sessionId: string, force?: boolean) => Promise<SessionGoal | undefined>
  loadGoalEventsForSession: (
    sessionId: string,
    options?: { goalId?: string | null; limit?: number; force?: boolean }
  ) => Promise<SessionGoalEvent[]>
  getGoalBySession: (sessionId: string) => SessionGoal | undefined
  getGoalEventsBySession: (sessionId: string) => SessionGoalEvent[]
  createGoal: (args: {
    sessionId: string
    objective: string
    tokenBudget?: number | null
  }) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  setGoal: (args: {
    sessionId: string
    objective: string
    status?: SessionGoalStatus
    tokenBudget?: number | null
  }) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  updateGoal: (
    sessionId: string,
    patch: Partial<Pick<SessionGoal, 'objective' | 'status' | 'tokenBudget'>>
  ) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  confirmGoal: (sessionId: string, goalId: string) => Promise<{ success: boolean; error?: string }>
  cancelGoal: (
    sessionId: string,
    goalId?: string | null
  ) => Promise<{ success: boolean; error?: string }>
  accountGoalUsage: (
    input: AccountGoalUsageInput
  ) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  addGoalEvent: (args: {
    sessionId: string
    goalId?: string | null
    eventType: SessionGoalEventType
    message?: string | null
    metadata?: Record<string, unknown> | null
  }) => Promise<{ success: boolean; event?: SessionGoalEvent; error?: string }>
  startGoalRun: (sessionId: string, goalId: string, startedAt?: number) => void
  finishGoalRun: (sessionId: string, goalId?: string | null) => void
  applySyncedGoal: (goal: SessionGoal) => void
  applySyncedGoalEvent: (event: SessionGoalEvent) => void
  applyGoalAction: (sessionId: string, goalId: string, action: GoalActionResult) => void
  applyGoalRunState: (input: {
    sessionId: string
    goalId: string
    status?: string
    runState: GoalRunState
    startedAt?: number
  }) => void
  applyGoalProgress: (progress: GoalProgressState) => void
  clearGoalProgress: (sessionId: string, goalId?: string | null) => void
  applyGoalActivity: (activity: GoalActivity) => void
  clearGoalActivities: (goalId: string) => void
}

export function rowToGoal(row: SessionGoalRow): SessionGoal {
  return {
    sessionId: row.sessionId,
    goalId: row.goalId,
    projectId: row.projectId,
    objective: row.objective,
    status: row.status,
    tokenBudget: row.tokenBudget,
    tokensUsed: row.tokensUsed,
    timeUsedSeconds: row.timeUsedSeconds,
    plansJson: row.plansJson,
    planCount: row.planCount,
    completedPlanCount: row.completedPlanCount,
    currentPlanIndex: row.currentPlanIndex,
    workingFolder: row.workingFolder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function rowToEvent(row: SessionGoalEventRow): SessionGoalEvent {
  let metadata: Record<string, unknown> | null = null
  if (row.metadataJson) {
    try {
      const parsed = JSON.parse(row.metadataJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>
      }
    } catch {
      metadata = null
    }
  }

  return {
    id: String(row.id),
    sessionId: row.sessionId,
    goalId: row.goalId,
    eventType: row.eventType,
    message: row.message,
    metadata,
    createdAt: row.createdAt
  }
}

export function isGoalRow(value: GoalMutationResult | SessionGoalRow): value is SessionGoalRow {
  return 'sessionId' in value
}

export function asGoal(
  result: GoalMutationResult | SessionGoalRow | null | undefined
): SessionGoal | null {
  if (!result) return null
  const row = isGoalRow(result) ? result : result.goal
  return row ? rowToGoal(row) : null
}

export function mutationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let _goalEventsIpcUnavailable = false
let goalEventsIpcUnavailableWarned = false

export function isGoalEventsIpcUnavailable(): boolean { return _goalEventsIpcUnavailable }
export function markGoalEventsIpcUnavailable(error: unknown): boolean {
  const message = mutationError(error)
  if (!message.includes('No handler registered') || !message.includes('db:goal-events')) {
    return false
  }

  _goalEventsIpcUnavailable = true
  if (!goalEventsIpcUnavailableWarned) {
    goalEventsIpcUnavailableWarned = true
    console.warn(
      '[GoalStore] Goal event IPC is unavailable. Restart Electron to enable goal event history.'
    )
  }
  return true
}

type GoalStoreSetter = (
  partial: Partial<GoalStore> | ((state: GoalStore) => Partial<GoalStore>)
) => void

export function upsertGoal(setState: GoalStoreSetter, goal: SessionGoal): void {
  setState((state) => ({
    goalsBySession: {
      ...state.goalsBySession,
      [goal.sessionId]: goal
    }
  }))
}

export function upsertGoalEvent(setState: GoalStoreSetter, event: SessionGoalEvent): void {
  setState((state) => {
    const existing = state.goalEventsBySession[event.sessionId] ?? []
    const next = [event, ...existing.filter((item) => item.id !== event.id)]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
    return {
      goalEventsBySession: {
        ...state.goalEventsBySession,
        [event.sessionId]: next
      }
    }
  })
}


// ─── Goal Plan Task（每轮执行记录）───

export interface SessionGoalPlanTask {
  id: string
  sessionId: string
  goalId: string
  planId: string
  originalPlanId?: string | null
  planTitle?: string | null
  round: number
  status: 'executing' | 'completed' | 'failed' | 'interrupted'
  description?: string | null
  steps?: string[] | null
  summary?: string | null
  evaluationReasoning?: string | null
  evaluationSatisfied?: boolean | null
  adjusted: boolean
  startedAt: number
  finishedAt?: number | null
}

export interface SessionGoalPlanTaskRow {
  id: number
  sessionId: string
  goalId: string
  planId: string
  originalPlanId: string | null
  planTitle: string | null
  round: number
  status: string
  description: string | null
  stepsJson: string | null
  summary: string | null
  evaluationReasoning: string | null
  evaluationSatisfied: boolean | null
  adjusted: boolean
  startedAt: number
  finishedAt: number | null
}

export function rowToPlanTask(row: SessionGoalPlanTaskRow): SessionGoalPlanTask {
  let steps: string[] | null = null
  if (row.stepsJson) {
    try {
      const parsed = JSON.parse(row.stepsJson)
      if (Array.isArray(parsed)) steps = parsed.filter((s): s is string => typeof s === 'string')
    } catch {
      steps = null
    }
  }
  return {
    id: String(row.id),
    sessionId: row.sessionId,
    goalId: row.goalId,
    planId: row.planId,
    originalPlanId: row.originalPlanId,
    planTitle: row.planTitle,
    round: row.round,
    status: (['executing', 'completed', 'failed', 'interrupted'] as const).includes(
      row.status as SessionGoalPlanTask['status']
    )
      ? (row.status as SessionGoalPlanTask['status'])
      : 'executing',
    description: row.description,
    steps,
    summary: row.summary,
    evaluationReasoning: row.evaluationReasoning,
    evaluationSatisfied: row.evaluationSatisfied,
    adjusted: row.adjusted || (row.originalPlanId != null && row.originalPlanId !== row.planId && row.round > 1),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  }
}

// ─── Goal Plan (definition, not execution attempt) ───
export interface SessionGoalPlan {
  planId: string
  goalId: string
  sessionId: string
  ordinal: number
  originalPlanId?: string | null
  title: string
  description: string
  contentJson?: string | null
  status: 'pending' | 'active' | 'complete' | 'aborted'
  retryCount: number
  resultSummary?: string | null
  createdAt: number
  updatedAt: number
  startedAt?: number | null
  completedAt?: number | null
}

export interface SessionGoalPlanRow {
  planId: string
  goalId: string
  sessionId: string
  ordinal: number
  originalPlanId: string | null
  title: string
  description: string
  contentJson: string | null
  status: string
  retryCount: number
  resultSummary: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
}

export function rowToPlan(row: SessionGoalPlanRow): SessionGoalPlan {
  return {
    planId: row.planId,
    goalId: row.goalId,
    sessionId: row.sessionId,
    ordinal: row.ordinal,
    originalPlanId: row.originalPlanId,
    title: row.title,
    description: row.description,
    contentJson: row.contentJson,
    status: (['pending', 'active', 'complete', 'aborted'] as const).includes(row.status as SessionGoalPlan['status'])
      ? row.status as SessionGoalPlan['status']
      : 'pending',
    retryCount: row.retryCount,
    resultSummary: row.resultSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  }
}

// ─── Goal Task (definition, not execution attempt) ───
export interface SessionGoalTask {
  taskId: string
  goalId: string
  planId: string
  sessionId: string
  ordinal: number
  title: string
  description: string
  contentJson?: string | null
  status: 'pending' | 'active' | 'complete' | 'aborted'
  retryCount: number
  resultSummary?: string | null
  createdAt: number
  updatedAt: number
  startedAt?: number | null
  completedAt?: number | null
}

export interface SessionGoalTaskRow {
  taskId: string
  goalId: string
  planId: string
  sessionId: string
  ordinal: number
  title: string
  description: string
  contentJson: string | null
  status: string
  retryCount: number
  resultSummary: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
}

export function rowToTask(row: SessionGoalTaskRow): SessionGoalTask {
  return {
    taskId: row.taskId,
    goalId: row.goalId,
    planId: row.planId,
    sessionId: row.sessionId,
    ordinal: row.ordinal,
    title: row.title,
    description: row.description,
    contentJson: row.contentJson,
    status: (['pending', 'active', 'complete', 'aborted'] as const).includes(row.status as SessionGoalTask['status'])
      ? row.status as SessionGoalTask['status']
      : 'pending',
    retryCount: row.retryCount,
    resultSummary: row.resultSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  }
}

// ─── Goal Execution Run (attempt) ───
export interface GoalExecutionRun {
  attemptId: string
  goalId: string
  planId?: string | null
  taskId?: string | null
  attemptNo: number
  status: 'executing' | 'completed' | 'failed' | 'interrupted'
  summary?: string | null
  error?: string | null
  startedAt: number
  finishedAt?: number | null
}

export interface GoalExecutionRunRow {
  attemptId: string
  goalId: string
  planId: string | null
  taskId: string | null
  attemptNo: number
  status: string
  summary: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export function rowToExecutionRun(row: GoalExecutionRunRow): GoalExecutionRun {
  return {
    attemptId: row.attemptId,
    goalId: row.goalId,
    planId: row.planId,
    taskId: row.taskId,
    attemptNo: row.attemptNo,
    status: (['executing', 'completed', 'failed', 'interrupted'] as const).includes(row.status as GoalExecutionRun['status'])
      ? row.status as GoalExecutionRun['status']
      : 'executing',
    summary: row.summary,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  }
}
