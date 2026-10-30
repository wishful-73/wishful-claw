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
import { buildWorkRequestDelivery } from '@renderer/lib/tools/global-work-request'
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

/**
 * Work request content — 措辞搬到 `lib/tools/global-work-request.ts`（iter-v3-5 S-278）。
 *
 * 以前这里与 C# 的 `AgentRuntimeGlobalTaskExecutor.SendWorkRequestAsync` 各写一份，
 * 已经漂移（一边教 `use_capability` 代理调法、一边教直接调工具）。现在渲染端只有
 * 一个措辞源，C# 那份由 `tests/global-dispatch-meta` 的源码闸钉住。
 */

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
      //    S-278：wire 文本（含协议说明）与落库文本分开，并把 dispatch 身份写进 meta，
      //    渲染端才认得出「这不是用户自己说的话」。任务标题取自看板当前快照。
      const taskTitle = get().tasks.find((task) => task.id === input.taskId)?.title
      const payload =
        input.kind === 'work_request'
          ? buildWorkRequestDelivery(dispatchId, input.taskId, input.instruction, taskTitle)
          : { content: input.instruction, displayContent: undefined, meta: undefined }
      const delivery = await handleProjectSendSessionMessage({
        sessionId: input.sessionId,
        content: payload.content,
        displayContent: payload.displayContent,
        meta: payload.meta,
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
