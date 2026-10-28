import type { SessionGoal } from '@renderer/stores/goal-store'

export interface GoalHistoryPanelProps {
  projectId?: string | null
  initialSessionId?: string | null
  initialGoalId?: string | null
}

export type GoalHistoryFilter = 'all' | 'current' | 'complete' | 'failed' | 'aborted'

export interface GoalPlanSummary {
  planId?: string
  originalPlanId?: string | null
  title?: string
  status?: string
  resultSummary?: string | null
}

export type { SessionGoal }
