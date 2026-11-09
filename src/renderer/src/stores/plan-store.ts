/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import { useChatStore } from './chat-store'

// --- Types ---

export type PlanStatus =
  | 'drafting'
  | 'awaiting_review'
  | 'approved'
  | 'implementing'
  | 'completed'
  | 'rejected'

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface PlanStep {
  id: number
  title: string
  status: PlanStepStatus
  result?: string | null
}

export interface Plan {
  id: string
  sessionId: string
  title: string
  status: PlanStatus
  filePath?: string
  content?: string
  specJson?: string
  steps?: PlanStep[]
  createdAt: number
  updatedAt: number
}

// --- DB persistence helpers (fire-and-forget) ---

function dbCreatePlan(plan: Plan): void {
  window.api.workerRequest('db/plans-create', {
    id: plan.id,
    sessionId: plan.sessionId,
    title: plan.title,
    status: plan.status,
    filePath: plan.filePath ?? null,
    content: plan.content ?? null,
    specJson: plan.specJson ?? null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  }).catch(() => {})
}

function dbUpdatePlan(id: string, patch: Record<string, unknown>): void {
  window.api.workerRequest('db/plans-update', { id, patch }).catch(() => {})
}

function dbDeletePlan(id: string): void {
  window.api.workerRequest('db/plans-delete', { id }).catch(() => {})
}

// --- Row → Plan conversion ---

interface PlanRow {
  id: string
  session_id: string
  title: string
  status: string
  file_path: string | null
  content: string | null
  spec_json: string | null
  created_at: number
  updated_at: number
}

function rowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    status: row.status as PlanStatus,
    filePath: row.file_path ?? undefined,
    content: row.content ?? undefined,
    specJson: row.spec_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function stripPlanPayload(plan: Plan): Plan {
  return {
    ...plan,
    content: undefined,
    specJson: undefined
  }
}

function releaseDormantPlanMemory(
  state: Pick<PlanStore, 'plans' | 'plansBySession' | 'activePlanId'>,
  sessionId?: string | null
): void {
  const residentSessionIds = new Set<string>()
  const activeChatSessionId = useChatStore.getState().activeSessionId
  if (activeChatSessionId) {
    residentSessionIds.add(activeChatSessionId)
  }
  if (sessionId) {
    residentSessionIds.add(sessionId)
  }

  const activePlanSessionId = state.activePlanId
    ? state.plans[state.activePlanId]?.sessionId
    : undefined
  if (activePlanSessionId) {
    residentSessionIds.add(activePlanSessionId)
  }

  for (const [planId, plan] of Object.entries(state.plans)) {
    if (residentSessionIds.has(plan.sessionId)) continue
    state.plans[planId] = stripPlanPayload(plan)
  }
}

// --- Store ---

interface PlanStore {
  plans: Record<string, Plan>
  plansBySession: Record<string, Plan>
  activePlanId: string | null
  _loaded: boolean

  // Initialization
  loadPlansFromDb: () => Promise<void>
  loadPlanForSession: (sessionId: string, force?: boolean) => Promise<Plan | undefined>
  releaseDormantPlans: (sessionId?: string | null) => void

  // CRUD
  createPlan: (
    sessionId: string,
    title: string,
    options?: Partial<Pick<Plan, 'status' | 'filePath' | 'content' | 'specJson'>>
  ) => Plan
  updatePlan: (planId: string, patch: Partial<Omit<Plan, 'id' | 'sessionId' | 'createdAt'>>) => void
  approvePlan: (planId: string) => void
  rejectPlan: (planId: string) => void
  beginImplementation: (planId: string) => void
  completePlan: (planId: string) => void
  deletePlan: (planId: string) => void
  syncPlanFromNative: (plan: Plan) => void

  // Queries
  getPlanBySession: (sessionId: string) => Plan | undefined
  getPendingReviewPlan: (sessionId: string) => Plan | undefined
  getActivePlan: () => Plan | undefined

  // Active plan
  setActivePlan: (planId: string | null) => void
}

export const usePlanStore = create<PlanStore>()(
  immer((set, get) => ({
    plans: {},
    plansBySession: {},
    activePlanId: null,
    _loaded: false,

    loadPlansFromDb: async () => {
      try {
        const rows = await window.api.workerRequest<PlanRow[]>('db/plans-list', {})
        const plansBySession: Record<string, Plan> = {}
        const plans: Record<string, Plan> = {}

        for (const row of rows) {
          const plan = rowToPlan(row)
          plansBySession[plan.sessionId] = stripPlanPayload(plan)
        }

        const activeSessionId = useChatStore.getState().activeSessionId
        for (const planSummary of Object.values(plansBySession)) {
          plans[planSummary.id] = planSummary
        }
        if (activeSessionId) {
          const activePlanSummary = plansBySession[activeSessionId]
          if (activePlanSummary) {
            const activeRow = rows.find((row) => row.id === activePlanSummary.id)
            if (activeRow) {
              plans[activePlanSummary.id] = rowToPlan(activeRow)
            }
          }
        }

        set((state) => {
          state.plans = plans
          state.plansBySession = plansBySession
          state._loaded = true
          releaseDormantPlanMemory(state)
        })
      } catch (err) {
        console.error('[PlanStore] Failed to load from DB:', err)
        set({ _loaded: true })
      }
    },

    loadPlanForSession: async (sessionId, force = false) => {
      const cached = get().plansBySession[sessionId]
      const activeCached = cached ? get().plans[cached.id] : undefined
      if (cached && !force) {
        return activeCached ?? cached
      }

      try {
        const result = await window.api.workerRequest<{ success: boolean; plan?: PlanRow | null; error?: string | null }>(
          'db/plans-get-by-session',
          { sessionId }
        )
        if (!result.success || !result.plan) {
          set((state) => {
            const existing = state.plansBySession[sessionId]
            if (existing) {
              delete state.plansBySession[sessionId]
              delete state.plans[existing.id]
              if (state.activePlanId === existing.id) {
                state.activePlanId = null
              }
            }
            releaseDormantPlanMemory(state, sessionId)
          })
          return undefined
        }

        const plan = rowToPlan(result.plan)
        set((state) => {
          state.plansBySession[sessionId] = stripPlanPayload(plan)
          state.plans[plan.id] = plan
          releaseDormantPlanMemory(state, sessionId)
        })
        return plan
      } catch (err) {
        console.error('[PlanStore] Failed to load plan for session:', err)
        return cached
      }
    },

    releaseDormantPlans: (sessionId) => {
      set((state) => {
        releaseDormantPlanMemory(state, sessionId)
      })
    },

    createPlan: (sessionId, title, options = {}) => {
      const id = nanoid()
      const now = Date.now()
      const plan: Plan = {
        id,
        sessionId,
        title,
        status: options.status ?? 'drafting',
        filePath: options.filePath,
        content: undefined,
        specJson: options.specJson,
        createdAt: now,
        updatedAt: now
      }
      set((state) => {
        state.plans[id] = plan
        state.plansBySession[sessionId] = stripPlanPayload(plan)
        state.activePlanId = id
        releaseDormantPlanMemory(state, sessionId)
      })
      dbCreatePlan(plan)
      return plan
    },

    updatePlan: (planId, patch) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          Object.assign(plan, patch, { updatedAt: now })
          state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.sessionId)
        }
      })
      const dbPatch: Record<string, unknown> = { updatedAt: now }
      if (patch.title !== undefined) dbPatch.title = patch.title
      if (patch.status !== undefined) dbPatch.status = patch.status
      if (patch.filePath !== undefined) dbPatch.filePath = patch.filePath
      if (patch.specJson !== undefined) dbPatch.specJson = patch.specJson
      dbUpdatePlan(planId, dbPatch)
    },

    approvePlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'approved'
          plan.updatedAt = now
          state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.sessionId)
        }
      })
      dbUpdatePlan(planId, { status: 'approved', updatedAt: now })
    },

    rejectPlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'rejected'
          plan.updatedAt = now
          state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.sessionId)
        }
      })
      dbUpdatePlan(planId, { status: 'rejected', updatedAt: now })
    },

    beginImplementation: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'implementing'
          plan.updatedAt = now
          state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.sessionId)
        }
      })
      dbUpdatePlan(planId, { status: 'implementing', updatedAt: now })
    },

    completePlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'completed'
          plan.updatedAt = now
          state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.sessionId)
        }
      })
      dbUpdatePlan(planId, { status: 'completed', updatedAt: now })
    },

    deletePlan: (planId) => {
      const existingPlan = get().plans[planId]
      set((state) => {
        delete state.plans[planId]
        if (existingPlan?.sessionId) {
          delete state.plansBySession[existingPlan.sessionId]
        }
        if (state.activePlanId === planId) {
          state.activePlanId = null
        }
        releaseDormantPlanMemory(state)
      })
      dbDeletePlan(planId)
    },

    syncPlanFromNative: (plan) => {
      set((state) => {
        const previousPlanForSession = state.plansBySession[plan.sessionId]
        if (previousPlanForSession && previousPlanForSession.id !== plan.id) {
          delete state.plans[previousPlanForSession.id]
        }
        state.plans[plan.id] = plan
        state.plansBySession[plan.sessionId] = stripPlanPayload(plan)
        releaseDormantPlanMemory(state, plan.sessionId)
      })
    },

    getPlanBySession: (sessionId) => {
      const cached = get().plansBySession[sessionId]
      if (!cached) return undefined
      return get().plans[cached.id] ?? cached
    },

    getPendingReviewPlan: (sessionId) => {
      const plan = get().getPlanBySession(sessionId)
      return plan?.status === 'awaiting_review' ? plan : undefined
    },

    getActivePlan: () => {
      const { plans, activePlanId } = get()
      return activePlanId ? plans[activePlanId] : undefined
    },

    setActivePlan: (planId) =>
      set((state) => {
        state.activePlanId = planId
        const sessionId = planId ? state.plans[planId]?.sessionId : undefined
        releaseDormantPlanMemory(state, sessionId)
      })
  }))
)
