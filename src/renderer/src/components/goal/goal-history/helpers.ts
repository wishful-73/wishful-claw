import type { SessionGoal, SessionGoalStatus } from '@renderer/stores/goal-store'
import type {
  SessionGoalEvent,
  SessionGoalPlan,
  SessionGoalPlanTask,
  SessionGoalTask
} from '@renderer/stores/goal-store-helpers'
import type { GoalHistoryFilter, GoalPlanSummary } from './types'

export const EMPTY_GOALS: SessionGoal[] = []
export const EMPTY_EVENTS: SessionGoalEvent[] = []
export const EMPTY_PLAN_TASKS: SessionGoalPlanTask[] = []
export const EMPTY_PLANS: SessionGoalPlan[] = []
export const EMPTY_TASKS: SessionGoalTask[] = []

/** Terminal DB statuses keep their badge; everything else renders by runState. */
export function GoalStatusValuesIsTerminal(status: SessionGoalStatus): boolean {
  return status === 'complete' || status === 'aborted'
}

/**
 * adjust 会更换 planId（OriginalPlanId 指向最初的 id）。
 * 每轮执行记录与计划摘要按"链根 planId"匹配，保证调整前后轮次都归到同一计划卡片。
 */
export function planTaskChainRoot(planId?: string | null, originalPlanId?: string | null): string {
  return originalPlanId ?? planId ?? ''
}

export function matchesFilter(status: SessionGoalStatus, filter: GoalHistoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return status === 'pending' || status === 'active'
  return status === filter
}

export function formatRoundDuration(startedAt: number, finishedAt?: number | null): string {
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

export function parsePlans(goal: SessionGoal): GoalPlanSummary[] {
  if (!goal.plansJson) return []
  try {
    const value = JSON.parse(goal.plansJson)
    return Array.isArray(value) ? (value as GoalPlanSummary[]) : []
  } catch {
    return []
  }
}
