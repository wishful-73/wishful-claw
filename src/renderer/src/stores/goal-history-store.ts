import { create } from 'zustand'
import {
  DB_GOALS_LIST_PAGE_MSGPACK_CHANNEL,
  DB_GOAL_EVENTS_LIST_PAGE_MSGPACK_CHANNEL,
  DB_GOAL_PLAN_TASKS_LIST_MSGPACK_CHANNEL,
  DB_GOAL_PLANS_LIST_MSGPACK_CHANNEL,
  DB_GOAL_TASKS_LIST_MSGPACK_CHANNEL
} from '@shared/messagepack/binary-ipc'
import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import {
  mutationError,
  rowToEvent,
  rowToGoal,
  rowToPlanTask,
  rowToPlan,
  rowToTask,
  type GoalEventPageResult,
  type GoalPageResult,
  type SessionGoal,
  type SessionGoalEvent,
  type SessionGoalPlan,
  type SessionGoalPlanTask,
  type SessionGoalPlanTaskRow,
  type SessionGoalPlanRow,
  type SessionGoalTask,
  type SessionGoalTaskRow
} from './goal-store-helpers'
import { applyGoalStatusToProjects } from './goal-state-transitions'

interface GoalPageCursor {
  currentRank: number
  updatedAt: number
  goalId: string
}

interface GoalEventPageCursor {
  createdAt: number
  eventId: number
}

interface GoalHistoryState {
  goalsByProject: Record<string, SessionGoal[]>
  eventsByGoal: Record<string, SessionGoalEvent[]>
  planTasksByGoal: Record<string, SessionGoalPlanTask[]>
  plansByGoal: Record<string, SessionGoalPlan[]>
  tasksByPlan: Record<string, SessionGoalTask[]>
  goalCursorsByProject: Record<string, GoalPageCursor | null>
  eventCursorsByGoal: Record<string, GoalEventPageCursor | null>
  goalHasMoreByProject: Record<string, boolean>
  eventHasMoreByGoal: Record<string, boolean>
  loadingProjects: Record<string, boolean>
  loadingGoals: Record<string, boolean>
  errorsByProject: Record<string, string | undefined>
  applyGoalSnapshot: (goal: SessionGoal) => void
  applyGoalStatus: (
    projectId: string | null | undefined,
    sessionId: string,
    goalId: string,
    status: SessionGoal['status'],
    updatedAt: number
  ) => void
  refreshLoadedProjects: () => void
  loadProjectGoals: (projectId: string | null, force?: boolean) => Promise<SessionGoal[]>
  loadMoreProjectGoals: (projectId: string | null) => Promise<SessionGoal[]>
  loadGoalEvents: (
    sessionId: string,
    goalId: string,
    force?: boolean
  ) => Promise<SessionGoalEvent[]>
  loadMoreGoalEvents: (sessionId: string, goalId: string) => Promise<SessionGoalEvent[]>
  loadGoalPlanTasks: (sessionId: string, goalId: string, force?: boolean) => Promise<SessionGoalPlanTask[]>
  loadGoalPlans: (sessionId: string, goalId: string, force?: boolean) => Promise<SessionGoalPlan[]>
  loadPlanTasks: (sessionId: string, goalId: string, planId: string, force?: boolean) => Promise<SessionGoalTask[]>
}

export function goalProjectKey(projectId: string | null): string {
  return projectId ?? '__global__'
}

export function goalHistoryKey(sessionId: string, goalId: string): string {
  return `${sessionId}\u0000${goalId}`
}

export function goalPlanKey(sessionId: string, goalId: string, planId: string): string {
  return `${sessionId}\u0000${goalId}\u0000${planId}`
}

export const useGoalHistoryStore = create<GoalHistoryState>((set, get) => ({
  goalsByProject: {},
  eventsByGoal: {},
  planTasksByGoal: {},
  plansByGoal: {},
  tasksByPlan: {},
  goalCursorsByProject: {},
  eventCursorsByGoal: {},
  goalHasMoreByProject: {},
  eventHasMoreByGoal: {},
  loadingProjects: {},
  loadingGoals: {},
  errorsByProject: {},

  applyGoalSnapshot: (goal) => {
    const key = goalProjectKey(goal.projectId ?? null)
    set((state) => {
      const current = state.goalsByProject[key]
      if (!current) return {}
      const goals = [goal, ...current.filter((item) => item.goalId !== goal.goalId)]
        .sort((a, b) => {
          const aCurrent = a.status === 'pending' || a.status === 'active' ? 1 : 0
          const bCurrent = b.status === 'pending' || b.status === 'active' ? 1 : 0
          return bCurrent - aCurrent || b.updatedAt - a.updatedAt
        })
      return { goalsByProject: { ...state.goalsByProject, [key]: goals } }
    })
  },

  applyGoalStatus: (projectId, sessionId, goalId, status, updatedAt) => {
    set((state) => {
      const keys = projectId === undefined
        ? Object.keys(state.goalsByProject)
        : [goalProjectKey(projectId)]
      const goalsByProject = applyGoalStatusToProjects(
        state.goalsByProject,
        keys,
        sessionId,
        goalId,
        status,
        updatedAt
      )
      return goalsByProject === state.goalsByProject ? {} : { goalsByProject }
    })
  },

  refreshLoadedProjects: () => {
    for (const key of Object.keys(get().goalsByProject)) {
      void get().loadProjectGoals(key === '__global__' ? null : key, true)
    }
  },

  loadProjectGoals: async (projectId, force = false) => {
    const key = goalProjectKey(projectId)
    const cached = get().goalsByProject[key]
    if (cached && !force) return cached

    set((state) => ({
      loadingProjects: { ...state.loadingProjects, [key]: true },
      errorsByProject: { ...state.errorsByProject, [key]: undefined }
    }))
    try {
      const page = await invokeMessagePackBinary<GoalPageResult>(
        DB_GOALS_LIST_PAGE_MSGPACK_CHANNEL,
        { projectId, limit: 30 }
      )
      const goals = page.items.map(rowToGoal)
      set((state) => ({
        goalsByProject: { ...state.goalsByProject, [key]: goals },
        goalHasMoreByProject: { ...state.goalHasMoreByProject, [key]: page.hasMore },
        goalCursorsByProject: {
          ...state.goalCursorsByProject,
          [key]: page.hasMore && page.nextCurrentRank != null && page.nextUpdatedAt != null && page.nextGoalId
            ? { currentRank: page.nextCurrentRank, updatedAt: page.nextUpdatedAt, goalId: page.nextGoalId }
            : null
        },
        loadingProjects: { ...state.loadingProjects, [key]: false }
      }))
      return goals
    } catch (error) {
      const message = mutationError(error)
      set((state) => ({
        loadingProjects: { ...state.loadingProjects, [key]: false },
        errorsByProject: { ...state.errorsByProject, [key]: message }
      }))
      return cached ?? []
    }
  },

  loadMoreProjectGoals: async (projectId) => {
    const key = goalProjectKey(projectId)
    const state = get()
    const cached = state.goalsByProject[key] ?? []
    const cursor = state.goalCursorsByProject[key]
    if (!cursor || !state.goalHasMoreByProject[key] || state.loadingProjects[key]) return cached

    set((current) => ({
      loadingProjects: { ...current.loadingProjects, [key]: true },
      errorsByProject: { ...current.errorsByProject, [key]: undefined }
    }))
    try {
      const page = await invokeMessagePackBinary<GoalPageResult>(
        DB_GOALS_LIST_PAGE_MSGPACK_CHANNEL,
        {
          projectId,
          limit: 30,
          cursorCurrentRank: cursor.currentRank,
          cursorUpdatedAt: cursor.updatedAt,
          cursorGoalId: cursor.goalId
        }
      )
      const appended = page.items.map(rowToGoal)
      const seen = new Set(cached.map((goal) => goal.goalId))
      const goals = [...cached, ...appended.filter((goal) => !seen.has(goal.goalId))]
      set((current) => ({
        goalsByProject: { ...current.goalsByProject, [key]: goals },
        goalHasMoreByProject: { ...current.goalHasMoreByProject, [key]: page.hasMore },
        goalCursorsByProject: {
          ...current.goalCursorsByProject,
          [key]: page.hasMore && page.nextCurrentRank != null && page.nextUpdatedAt != null && page.nextGoalId
            ? { currentRank: page.nextCurrentRank, updatedAt: page.nextUpdatedAt, goalId: page.nextGoalId }
            : null
        },
        loadingProjects: { ...current.loadingProjects, [key]: false }
      }))
      return goals
    } catch (error) {
      const message = mutationError(error)
      set((current) => ({
        loadingProjects: { ...current.loadingProjects, [key]: false },
        errorsByProject: { ...current.errorsByProject, [key]: message }
      }))
      return cached
    }
  },

  loadGoalEvents: async (sessionId, goalId, force = false) => {
    const key = goalHistoryKey(sessionId, goalId)
    const cached = get().eventsByGoal[key]
    if (cached && !force) return cached

    set((state) => ({ loadingGoals: { ...state.loadingGoals, [key]: true } }))
    try {
      const page = await invokeMessagePackBinary<GoalEventPageResult>(
        DB_GOAL_EVENTS_LIST_PAGE_MSGPACK_CHANNEL,
        { sessionId, goalId, limit: 50 }
      )
      const events = page.items.map(rowToEvent)
      set((state) => ({
        eventsByGoal: { ...state.eventsByGoal, [key]: events },
        eventHasMoreByGoal: { ...state.eventHasMoreByGoal, [key]: page.hasMore },
        eventCursorsByGoal: {
          ...state.eventCursorsByGoal,
          [key]: page.hasMore && page.nextCreatedAt != null && page.nextEventId != null
            ? { createdAt: page.nextCreatedAt, eventId: page.nextEventId }
            : null
        },
        loadingGoals: { ...state.loadingGoals, [key]: false }
      }))
      return events
    } catch {
      set((state) => ({ loadingGoals: { ...state.loadingGoals, [key]: false } }))
      return cached ?? []
    }
  },

  loadMoreGoalEvents: async (sessionId, goalId) => {
    const key = goalHistoryKey(sessionId, goalId)
    const state = get()
    const cached = state.eventsByGoal[key] ?? []
    const cursor = state.eventCursorsByGoal[key]
    if (!cursor || !state.eventHasMoreByGoal[key] || state.loadingGoals[key]) return cached

    set((current) => ({ loadingGoals: { ...current.loadingGoals, [key]: true } }))
    try {
      const page = await invokeMessagePackBinary<GoalEventPageResult>(
        DB_GOAL_EVENTS_LIST_PAGE_MSGPACK_CHANNEL,
        {
          sessionId,
          goalId,
          limit: 50,
          cursorCreatedAt: cursor.createdAt,
          cursorEventId: cursor.eventId
        }
      )
      const appended = page.items.map(rowToEvent)
      const seen = new Set(cached.map((event) => event.id))
      const events = [...cached, ...appended.filter((event) => !seen.has(event.id))]
      set((current) => ({
        eventsByGoal: { ...current.eventsByGoal, [key]: events },
        eventHasMoreByGoal: { ...current.eventHasMoreByGoal, [key]: page.hasMore },
        eventCursorsByGoal: {
          ...current.eventCursorsByGoal,
          [key]: page.hasMore && page.nextCreatedAt != null && page.nextEventId != null
            ? { createdAt: page.nextCreatedAt, eventId: page.nextEventId }
            : null
        },
        loadingGoals: { ...current.loadingGoals, [key]: false }
      }))
      return events
    } catch {
      set((current) => ({ loadingGoals: { ...current.loadingGoals, [key]: false } }))
      return cached
    }
  },

  loadGoalPlanTasks: async (sessionId, goalId, force = false) => {
    const key = goalHistoryKey(sessionId, goalId)
    const cached = get().planTasksByGoal[key]
    if (cached && !force) return cached

    set((state) => ({ loadingGoals: { ...state.loadingGoals, [key]: true } }))
    try {
      const rows = await invokeMessagePackBinary<SessionGoalPlanTaskRow[]>(
        DB_GOAL_PLAN_TASKS_LIST_MSGPACK_CHANNEL,
        { sessionId, goalId }
      )
      const tasks = (rows ?? []).map(rowToPlanTask)
      set((state) => ({
        planTasksByGoal: { ...state.planTasksByGoal, [key]: tasks },
        loadingGoals: { ...state.loadingGoals, [key]: false }
      }))
      return tasks
    } catch {
      set((state) => ({ loadingGoals: { ...state.loadingGoals, [key]: false } }))
      return cached ?? []
    }
  },

  loadGoalPlans: async (sessionId, goalId, force = false) => {
    const key = goalHistoryKey(sessionId, goalId)
    const cached = get().plansByGoal[key]
    if (cached && !force) return cached

    try {
      const rows = await invokeMessagePackBinary<SessionGoalPlanRow[]>(
        DB_GOAL_PLANS_LIST_MSGPACK_CHANNEL,
        { sessionId, goalId }
      )
      const plans = (rows ?? []).map(rowToPlan).sort((a, b) => a.ordinal - b.ordinal)
      set((state) => ({
        plansByGoal: { ...state.plansByGoal, [key]: plans }
      }))
      return plans
    } catch {
      return cached ?? []
    }
  },

  loadPlanTasks: async (sessionId, goalId, planId, force = false) => {
    const key = goalPlanKey(sessionId, goalId, planId)
    const cached = get().tasksByPlan[key]
    if (cached && !force) return cached

    try {
      const rows = await invokeMessagePackBinary<SessionGoalTaskRow[]>(
        DB_GOAL_TASKS_LIST_MSGPACK_CHANNEL,
        { sessionId, goalId, planId }
      )
      const tasks = (rows ?? []).map(rowToTask).sort((a, b) => a.ordinal - b.ordinal)
      set((state) => ({
        tasksByPlan: { ...state.tasksByPlan, [key]: tasks }
      }))
      return tasks
    } catch {
      return cached ?? []
    }
  }
}))
