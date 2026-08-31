/**
 * Task Board store — global agent work items (global_tasks) and their dispatch
 * records (global_task_dispatches). This is the ONLY data source for the Task
 * Board; the session-scoped tasks table (agent Todos) is never read here.
 *
 * Reads/writes go through the generic worker bridge (window.api.workerRequest)
 * to the db/global-tasks-* and db/global-task-dispatches-* methods. Delivery of
 * messages / work requests reuses handleProjectSendSessionMessage — the same
 * sendMessage pipeline the global agent's reverse-request path uses.
 */

import { create } from 'zustand'
import { handleProjectSendSessionMessage } from '@renderer/lib/tools/project-send-message'
import {
  newDispatchId,
  newGlobalTaskId,
  type GlobalDispatchKind,
  type GlobalTaskDispatchRow,
  type GlobalTaskPriority,
  type GlobalTaskRow,
  type GlobalTaskStatus,
  type GlobalMutationResult
} from '@renderer/components/taskboard/task-board-types'

export interface TaskCreateInput {
  title: string
  description?: string
  status?: GlobalTaskStatus
  priority?: GlobalTaskPriority
  tags?: string[]
  dueAt?: number | null
}

export interface TaskPatch {
  title?: string
  description?: string
  status?: GlobalTaskStatus
  priority?: GlobalTaskPriority
  tags?: string[]
  dueAt?: number | null
  /** false restores a task from the archived view. */
  archived?: boolean
}

export interface DispatchSendInput {
  taskId: string
  sessionId: string
  projectId?: string | null
  workingFolder?: string | null
  kind: GlobalDispatchKind
  instruction: string
}

interface TaskBoardStore {
  tasks: GlobalTaskRow[]
  dispatches: GlobalTaskDispatchRow[]
  loadingTasks: boolean
  loadingDispatches: boolean
  selectedTaskId: string | null
  /** Task the dispatch list currently belongs to. */
  dispatchTaskId: string | null

  selectTask: (taskId: string | null) => void
  loadTasks: (includeArchived: boolean) => Promise<void>
  createTask: (input: TaskCreateInput) => Promise<string | null>
  updateTask: (taskId: string, patch: TaskPatch) => Promise<boolean>
  archiveTask: (taskId: string) => Promise<boolean>
  loadDispatches: (taskId: string) => Promise<void>
  cancelDispatch: (dispatchId: string) => Promise<boolean>
  /** Creates a dispatch record, then delivers it to the target session. */
  dispatchToSession: (input: DispatchSendInput) => Promise<{ ok: boolean; error?: string }>
  /** Updates a single dispatch row's status (best effort) then reloads the list. */
  refreshDispatchStatus: (
    dispatchId: string,
    status: GlobalTaskDispatchRow['status'],
    error: string | null
  ) => Promise<boolean>
}

function isMutationOk(result: unknown): result is GlobalMutationResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as GlobalMutationResult).success === true
  )
}

function mutationError(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null) {
    const error = (result as GlobalMutationResult).error
    if (typeof error === 'string' && error.length > 0) return error
  }
  return fallback
}

/** Work request content — mirrors AgentRuntimeGlobalTaskExecutor.SendWorkRequestAsync. */
function buildWorkRequestContent(dispatchId: string, taskId: string, instruction: string): string {
  return (
    `[GLOBAL AGENT WORK REQUEST] dispatch_id=${dispatchId} global_task_id=${taskId}\n\n` +
    `${instruction}\n\n` +
    'This work request was dispatched by the global agent (Task Board). Decide yourself how to ' +
    'execute it (including whether to create your own temporary Todos). When you finish, get ' +
    'blocked, or need to ask the global agent a follow-up question, call the reply_global_dispatch ' +
    `tool with dispatchId '${dispatchId}' so the global agent can track the outcome.`
  )
}

export const useTaskBoardStore = create<TaskBoardStore>((set, get) => ({
  tasks: [],
  dispatches: [],
  loadingTasks: false,
  loadingDispatches: false,
  selectedTaskId: null,
  dispatchTaskId: null,

  selectTask: (taskId) => {
    set({ selectedTaskId: taskId })
    if (taskId) {
      void get().loadDispatches(taskId)
    } else {
      set({ dispatches: [], dispatchTaskId: null })
    }
  },

  loadTasks: async (includeArchived) => {
    set({ loadingTasks: true })
    try {
      const rows = await window.api.workerRequest<GlobalTaskRow[]>('db/global-tasks-list', {
        includeArchived
      })
      set({ tasks: Array.isArray(rows) ? rows : [] })
    } catch (err) {
      console.error('[TaskBoard] failed to load global tasks:', err)
    } finally {
      set({ loadingTasks: false })
    }
  },

  createTask: async (input) => {
    const taskId = newGlobalTaskId()
    try {
      const result = await window.api.workerRequest<GlobalMutationResult>('db/global-tasks-create', {
        id: taskId,
        title: input.title,
        description: input.description ?? '',
        status: input.status ?? 'pending',
        priority: input.priority ?? 'normal',
        tags: input.tags ?? [],
        dueAt: input.dueAt ?? undefined
      })
      if (!isMutationOk(result)) {
        console.error('[TaskBoard] create failed:', mutationError(result, 'unknown error'))
        return null
      }
      return taskId
    } catch (err) {
      console.error('[TaskBoard] failed to create global task:', err)
      return null
    }
  },

  updateTask: async (taskId, patch) => {
    try {
      const updatePatch: Record<string, unknown> = {}
      if (patch.title !== undefined) updatePatch.title = patch.title
      if (patch.description !== undefined) updatePatch.description = patch.description
      if (patch.status !== undefined) updatePatch.status = patch.status
      if (patch.priority !== undefined) updatePatch.priority = patch.priority
      if (patch.tags !== undefined) updatePatch.tags = patch.tags
      if (patch.dueAt !== undefined) updatePatch.dueAt = patch.dueAt
      if (patch.archived !== undefined) updatePatch.archived = patch.archived

      const result = await window.api.workerRequest<GlobalMutationResult>('db/global-tasks-update', {
        id: taskId,
        patch: updatePatch
      })
      return isMutationOk(result)
    } catch (err) {
      console.error('[TaskBoard] failed to update global task:', err)
      return false
    }
  },

  archiveTask: async (taskId) => {
    try {
      const result = await window.api.workerRequest<GlobalMutationResult>('db/global-tasks-archive', {
        id: taskId
      })
      return isMutationOk(result)
    } catch (err) {
      console.error('[TaskBoard] failed to archive global task:', err)
      return false
    }
  },

  loadDispatches: async (taskId) => {
    set({ loadingDispatches: true })
    try {
      const rows = await window.api.workerRequest<GlobalTaskDispatchRow[]>(
        'db/global-task-dispatches-list',
        { globalTaskId: taskId }
      )
      // Guard against a race where the user switched task mid-flight.
      if (get().selectedTaskId === taskId) {
        set({ dispatches: Array.isArray(rows) ? rows : [], dispatchTaskId: taskId })
      }
    } catch (err) {
      console.error('[TaskBoard] failed to load dispatches:', err)
    } finally {
      set({ loadingDispatches: false })
    }
  },

  cancelDispatch: async (dispatchId) => {
    try {
      const result = await window.api.workerRequest<GlobalMutationResult>(
        'db/global-task-dispatches-cancel',
        { id: dispatchId }
      )
      return isMutationOk(result)
    } catch (err) {
      console.error('[TaskBoard] failed to cancel dispatch:', err)
      return false
    }
  },

  dispatchToSession: async (input) => {
    const dispatchId = newDispatchId()
    try {
      // 1. Record the dispatch first so it survives even if delivery fails.
      const createResult = await window.api.workerRequest<GlobalMutationResult>(
        'db/global-task-dispatches-create',
        {
          id: dispatchId,
          globalTaskId: input.taskId,
          sessionId: input.sessionId,
          projectId: input.projectId ?? undefined,
          kind: input.kind,
          instruction: input.instruction,
          status: 'pending'
        }
      )
      if (!isMutationOk(createResult)) {
        return { ok: false, error: mutationError(createResult, 'Failed to create dispatch record') }
      }

      // 2. Deliver through the existing sendMessage pipeline.
      const content =
        input.kind === 'work_request'
          ? buildWorkRequestContent(dispatchId, input.taskId, input.instruction)
          : input.instruction
      const delivery = await handleProjectSendSessionMessage({
        sessionId: input.sessionId,
        content,
        workingFolder: input.workingFolder ?? undefined,
        projectId: input.projectId ?? undefined
      })

      // 3. Reflect delivery outcome on the dispatch record.
      await get().refreshDispatchStatus(
        dispatchId,
        delivery.success ? 'sent' : 'failed',
        delivery.success ? null : (delivery.error ?? 'Delivery failed')
      )
      return delivery.success
        ? { ok: true }
        : { ok: false, error: delivery.error ?? 'Delivery failed' }
    } catch (err) {
      console.error('[TaskBoard] dispatch failed:', err)
      void get().refreshDispatchStatus(dispatchId, 'failed', err instanceof Error ? err.message : String(err))
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  /** Updates a single dispatch row's status (best effort) then reloads the list. */
  refreshDispatchStatus: async (dispatchId, status, error) => {
    let ok = false
    try {
      const result = await window.api.workerRequest<GlobalMutationResult>('db/global-task-dispatches-update', {
        id: dispatchId,
        patch: { status, ...(error ? { error } : {}) }
      })
      ok = isMutationOk(result)
      if (!ok) {
        console.error('[TaskBoard] failed to mark dispatch status:', mutationError(result, 'unknown error'))
      }
    } catch (err) {
      console.error('[TaskBoard] failed to mark dispatch status:', err)
    }
    const taskId = get().dispatchTaskId
    if (taskId) await get().loadDispatches(taskId)
    return ok
  }
}))
