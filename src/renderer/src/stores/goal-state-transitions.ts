import type {
  ActiveGoalRun,
  GoalProgressState,
  GoalRunState,
  SessionGoal
} from './goal-store-helpers'

export interface GoalRuntimeState {
  goalsBySession: Record<string, SessionGoal>
  goalProgressBySession: Record<string, GoalProgressState>
  goalRunStatesBySession: Record<string, GoalRunState>
  activeGoalRunsBySession: Record<string, ActiveGoalRun>
}

export function isRuntimeGoalVisible(goal?: SessionGoal): goal is SessionGoal {
  return goal?.status === 'active'
}

export function removeRuntimeGoalState(
  state: GoalRuntimeState,
  sessionId: string,
  goalId: string
): GoalRuntimeState {
  const existingGoal = state.goalsBySession[sessionId]
  const existingProgress = state.goalProgressBySession[sessionId]
  const existingRun = state.activeGoalRunsBySession[sessionId]
  const goalsBySession = { ...state.goalsBySession }
  const goalProgressBySession = { ...state.goalProgressBySession }
  const goalRunStatesBySession = { ...state.goalRunStatesBySession }
  const activeGoalRunsBySession = { ...state.activeGoalRunsBySession }

  if (existingGoal?.goalId === goalId) delete goalsBySession[sessionId]
  if (existingProgress?.goalId === goalId) {
    delete goalProgressBySession[sessionId]
    delete goalRunStatesBySession[sessionId]
  }
  if (existingRun?.goalId === goalId) delete activeGoalRunsBySession[sessionId]

  return {
    goalsBySession,
    goalProgressBySession,
    goalRunStatesBySession,
    activeGoalRunsBySession
  }
}

export function applyGoalProgressState(
  state: GoalRuntimeState,
  progress: GoalProgressState,
  now = Date.now()
): GoalRuntimeState {
  const terminal = progress.status === 'complete'
    || progress.status === 'aborted'
  const goalsBySession = { ...state.goalsBySession }
  const goalProgressBySession = { ...state.goalProgressBySession }
  const goalRunStatesBySession = { ...state.goalRunStatesBySession }
  const activeGoalRunsBySession = { ...state.activeGoalRunsBySession }
  const existingGoal = goalsBySession[progress.sessionId]

  if (existingGoal && existingGoal.goalId === progress.goalId && progress.status) {
    goalsBySession[progress.sessionId] = {
      ...existingGoal,
      status: progress.status as SessionGoal['status'],
      updatedAt: progress.timestamp
    }
  }

  if (terminal) {
    if (existingGoal?.goalId === progress.goalId) {
      delete goalsBySession[progress.sessionId]
    }
    if (goalProgressBySession[progress.sessionId]?.goalId === progress.goalId) {
      delete goalProgressBySession[progress.sessionId]
      delete goalRunStatesBySession[progress.sessionId]
    }
    if (activeGoalRunsBySession[progress.sessionId]?.goalId === progress.goalId) {
      delete activeGoalRunsBySession[progress.sessionId]
    }
  } else {
    goalProgressBySession[progress.sessionId] = progress
    if (progress.runState) {
      goalRunStatesBySession[progress.sessionId] = progress.runState
      if (progress.runState === 'running') {
        const activeRun = activeGoalRunsBySession[progress.sessionId]
        if (!activeRun || activeRun.goalId !== progress.goalId) {
          activeGoalRunsBySession[progress.sessionId] = {
            goalId: progress.goalId,
            startedAt: now
          }
        }
      } else {
        delete activeGoalRunsBySession[progress.sessionId]
      }
    }
  }

  return {
    goalsBySession,
    goalProgressBySession,
    goalRunStatesBySession,
    activeGoalRunsBySession
  }
}

export function applyGoalStatusToProjects(
  goalsByProject: Record<string, SessionGoal[]>,
  projectKeys: string[],
  sessionId: string,
  goalId: string,
  status: SessionGoal['status'],
  updatedAt: number
): Record<string, SessionGoal[]> {
  let changed = false
  const next = { ...goalsByProject }
  for (const key of projectKeys) {
    const current = goalsByProject[key]
    if (!current) continue
    next[key] = current
      .map((goal) => {
        if (goal.goalId !== goalId || goal.sessionId !== sessionId) return goal
        changed = true
        return { ...goal, status, updatedAt }
      })
      .sort((a, b) => {
        const aCurrent = a.status === 'pending' || a.status === 'active' ? 1 : 0
        const bCurrent = b.status === 'pending' || b.status === 'active' ? 1 : 0
        return bCurrent - aCurrent || b.updatedAt - a.updatedAt
      })
  }
  return changed ? next : goalsByProject
}
