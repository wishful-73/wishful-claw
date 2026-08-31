import { create } from 'zustand'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '../lib/agent-runtime-sync'
import { invokeMessagePackBinary } from '../lib/ipc/messagepack-ipc-client'
import { dbCreateTask, dbUpdateTask, dbDeleteTask, dbDeleteTasksBySession, rowToTask, buildDbPatch, TaskRow, TaskStore } from './task-store-helpers'
import { useChatStore } from '@renderer/stores/chat-store'
import { DB_TASKS_LIST_BY_SESSION_MSGPACK_CHANNEL } from '@shared/messagepack/binary-ipc'
import type { TaskItem } from './task-store-helpers'

const EMPTY_TASKS: TaskItem[] = []

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tasksBySession: {},
  currentSessionId: null,

  loadTasksForSession: async (sessionId) => {
    // Show cached tasks immediately to avoid stale UI while DB is loading.
    set((state) => {
      const cached = state.tasksBySession[sessionId] ?? []
      return { currentSessionId: sessionId, tasks: cached, todos: cached }
    })

    try {
      const rows = await invokeMessagePackBinary<TaskRow[]>(
        DB_TASKS_LIST_BY_SESSION_MSGPACK_CHANNEL,
        sessionId
      )
      const tasks = rows.map(rowToTask)
      set((state) => {
        const nextTasksBySession = { ...state.tasksBySession, [sessionId]: tasks }
        // If user switched again before this async request resolved,
        // only refresh the cache and keep current visible list intact.
        if (state.currentSessionId !== sessionId) {
          return { tasksBySession: nextTasksBySession }
        }
        return { tasks, todos: tasks, tasksBySession: nextTasksBySession }
      })
    } catch (err) {
      console.error('[TaskStore] Failed to load tasks for session:', err)
    }
  },

  addTask: (task) => {
    const now = Date.now()
    const newTask: TaskItem = {
      ...task,
      blocks: task.blocks ?? [],
      blockedBy: task.blockedBy ?? [],
      createdAt: task.createdAt ?? now,
      updatedAt: now
    }
    let sortOrder = 0
    set((state) => {
      const sessionId = newTask.sessionId
      if (!sessionId) {
        sortOrder = state.tasks.length
        const updated = [...state.tasks, newTask]
        return { tasks: updated, todos: updated }
      }

      const sessionTasks =
        state.tasksBySession[sessionId] ?? (state.currentSessionId === sessionId ? state.tasks : [])
      sortOrder = sessionTasks.length
      const nextSessionTasks = [...sessionTasks, newTask]
      const nextTasksBySession = { ...state.tasksBySession, [sessionId]: nextSessionTasks }

      if (
        state.currentSessionId === sessionId ||
        (!state.currentSessionId && state.tasks.length === 0)
      ) {
        return {
          currentSessionId: state.currentSessionId ?? sessionId,
          tasks: nextSessionTasks,
          todos: nextSessionTasks,
          tasksBySession: nextTasksBySession
        }
      }
      return { tasksBySession: nextTasksBySession }
    })
    dbCreateTask(newTask, sortOrder)
    if (newTask.sessionId) {
      useChatStore.getState().clearSessionPromptSnapshot(newTask.sessionId)
    }
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({ kind: 'task_add', task: newTask })
    }
    return newTask
  },

  getTask: (id) => {
    const state = get()
    const current = state.tasks.find((t) => t.id === id)
    if (current) return current

    for (const sessionTasks of Object.values(state.tasksBySession)) {
      const found = sessionTasks.find((t) => t.id === id)
      if (found) return found
    }

    return undefined
  },

  updateTask: (id, patch) => {
    const now = Date.now()
    let updatedTask: TaskItem | undefined

    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }

      const sessionEntries = Object.entries(state.tasksBySession)
      if (state.currentSessionId && !state.tasksBySession[state.currentSessionId]) {
        sessionEntries.push([state.currentSessionId, state.tasks])
      }

      for (const [sessionId, sessionTasks] of sessionEntries) {
        const idx = sessionTasks.findIndex((t) => t.id === id)
        if (idx === -1) continue

        const updated = { ...sessionTasks[idx], ...patch, updatedAt: now }
        const nextSessionTasks = [...sessionTasks]
        nextSessionTasks[idx] = updated
        nextTasksBySession[sessionId] = nextSessionTasks
        updatedTask = updated

        if (state.currentSessionId === sessionId) {
          return {
            tasks: nextSessionTasks,
            todos: nextSessionTasks,
            tasksBySession: nextTasksBySession
          }
        }
        return { tasksBySession: nextTasksBySession }
      }

      return {}
    })

    // Persist even when task is currently off-screen (another active session).
    if (updatedTask) {
      dbUpdateTask(id, buildDbPatch(patch, now))
      if (updatedTask.sessionId) {
        useChatStore.getState().clearSessionPromptSnapshot(updatedTask.sessionId)
      }
      if (!isAgentRuntimeSyncSuppressed()) {
        emitAgentRuntimeSync({ kind: 'task_update', id, patch })
      }
    }
    return updatedTask
  },

  deleteTask: (id) => {
    const existingTask = get().getTask(id)
    let deleted = false

    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }
      const sessionEntries = Object.entries(state.tasksBySession)
      if (state.currentSessionId && !state.tasksBySession[state.currentSessionId]) {
        sessionEntries.push([state.currentSessionId, state.tasks])
      }

      for (const [sessionId, sessionTasks] of sessionEntries) {
        const hasTarget = sessionTasks.some((t) => t.id === id)
        if (!hasTarget) continue

        const cleaned = sessionTasks
          .filter((t) => t.id !== id)
          .map((t) => ({
            ...t,
            blocks: t.blocks.filter((b) => b !== id),
            blockedBy: t.blockedBy.filter((b) => b !== id)
          }))
        nextTasksBySession[sessionId] = cleaned
        deleted = true

        if (state.currentSessionId === sessionId) {
          return { tasks: cleaned, todos: cleaned, tasksBySession: nextTasksBySession }
        }
        return { tasksBySession: nextTasksBySession }
      }

      return {}
    })

    if (!deleted) return false
    dbDeleteTask(id)
    if (existingTask?.sessionId) {
      useChatStore.getState().clearSessionPromptSnapshot(existingTask.sessionId)
    }
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({ kind: 'task_delete', id })
    }
    return true
  },

  getTasks: () => get().tasks,

  getTasksBySession: (sessionId) => {
    const state = get()
    if (state.currentSessionId === sessionId) return state.tasks
    return state.tasksBySession[sessionId] ?? EMPTY_TASKS
  },

  getActiveTask: () => get().tasks.find((t) => t.status === 'in_progress'),

  getProgress: () => {
    const { tasks } = get()
    const total = tasks.length
    const completed = tasks.filter((t) => t.status === 'completed').length
    return {
      total,
      completed,
      percentage: total === 0 ? 0 : Math.round((completed / total) * 100)
    }
  },

  clearTasks: () => set({ tasks: [], todos: [], currentSessionId: null }),

  releaseDormantSessionTasks: (residentSessionIds) => {
    const residentSet = new Set(residentSessionIds)
    set((state) => {
      for (const sessionId of Object.keys(state.tasksBySession)) {
        if (!residentSet.has(sessionId)) {
          delete state.tasksBySession[sessionId]
        }
      }

      if (state.currentSessionId && !residentSet.has(state.currentSessionId)) {
        return { tasks: [], todos: [], currentSessionId: null }
      }
      return {}
    })
  },

  deleteSessionTasks: (sessionId) => {
    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }
      delete nextTasksBySession[sessionId]

      if (state.currentSessionId !== sessionId) {
        return { tasksBySession: nextTasksBySession }
      }

      return {
        tasks: [],
        todos: [],
        currentSessionId: null,
        tasksBySession: nextTasksBySession
      }
    })
    dbDeleteTasksBySession(sessionId)
    useChatStore.getState().clearSessionPromptSnapshot(sessionId)
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({ kind: 'task_delete_session', sessionId })
    }
  },

  applySyncedTaskAdd: (task) => {
    const syncedTask: TaskItem = {
      ...task,
      blocks: task.blocks ?? [],
      blockedBy: task.blockedBy ?? []
    }

    set((state) => {
      const sessionId = syncedTask.sessionId
      if (!sessionId) {
        if (state.tasks.some((item) => item.id === syncedTask.id)) {
          const tasks = state.tasks.map((item) => (item.id === syncedTask.id ? syncedTask : item))
          return { tasks, todos: tasks }
        }
        const tasks = [...state.tasks, syncedTask]
        return { tasks, todos: tasks }
      }

      const sessionTasks =
        state.tasksBySession[sessionId] ?? (state.currentSessionId === sessionId ? state.tasks : [])
      const existingIndex = sessionTasks.findIndex((item) => item.id === syncedTask.id)
      const nextSessionTasks = [...sessionTasks]
      if (existingIndex !== -1) {
        nextSessionTasks[existingIndex] = syncedTask
      } else {
        nextSessionTasks.push(syncedTask)
      }

      const nextTasksBySession = { ...state.tasksBySession, [sessionId]: nextSessionTasks }
      if (state.currentSessionId === sessionId) {
        return {
          tasks: nextSessionTasks,
          todos: nextSessionTasks,
          tasksBySession: nextTasksBySession
        }
      }
      return { tasksBySession: nextTasksBySession }
    })
  },

  applySyncedTaskUpdate: (id, patch) => {
    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }

      const sessionEntries = Object.entries(state.tasksBySession)
      if (state.currentSessionId && !state.tasksBySession[state.currentSessionId]) {
        sessionEntries.push([state.currentSessionId, state.tasks])
      }

      for (const [sessionId, sessionTasks] of sessionEntries) {
        const idx = sessionTasks.findIndex((task) => task.id === id)
        if (idx === -1) continue

        const nextSessionTasks = [...sessionTasks]
        nextSessionTasks[idx] = { ...nextSessionTasks[idx], ...patch }
        nextTasksBySession[sessionId] = nextSessionTasks

        if (state.currentSessionId === sessionId) {
          return {
            tasks: nextSessionTasks,
            todos: nextSessionTasks,
            tasksBySession: nextTasksBySession
          }
        }
        return { tasksBySession: nextTasksBySession }
      }

      const taskIndex = state.tasks.findIndex((task) => task.id === id)
      if (taskIndex !== -1) {
        const tasks = [...state.tasks]
        tasks[taskIndex] = { ...tasks[taskIndex], ...patch }
        return { tasks, todos: tasks }
      }

      return {}
    })
  },

  applySyncedTaskDelete: (id) => {
    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }
      const sessionEntries = Object.entries(state.tasksBySession)
      if (state.currentSessionId && !state.tasksBySession[state.currentSessionId]) {
        sessionEntries.push([state.currentSessionId, state.tasks])
      }

      for (const [sessionId, sessionTasks] of sessionEntries) {
        const hasTarget = sessionTasks.some((task) => task.id === id)
        if (!hasTarget) continue

        const cleaned = sessionTasks
          .filter((task) => task.id !== id)
          .map((task) => ({
            ...task,
            blocks: task.blocks.filter((item) => item !== id),
            blockedBy: task.blockedBy.filter((item) => item !== id)
          }))
        nextTasksBySession[sessionId] = cleaned

        if (state.currentSessionId === sessionId) {
          return { tasks: cleaned, todos: cleaned, tasksBySession: nextTasksBySession }
        }
        return { tasksBySession: nextTasksBySession }
      }

      const hasCurrent = state.tasks.some((task) => task.id === id)
      if (!hasCurrent) return {}
      const tasks = state.tasks.filter((task) => task.id !== id)
      return { tasks, todos: tasks }
    })
  },

  applySyncedDeleteSessionTasks: (sessionId) => {
    set((state) => {
      const nextTasksBySession = { ...state.tasksBySession }
      delete nextTasksBySession[sessionId]

      if (state.currentSessionId !== sessionId) {
        return { tasksBySession: nextTasksBySession }
      }

      return {
        tasks: [],
        todos: [],
        currentSessionId: null,
        tasksBySession: nextTasksBySession
      }
    })
  },

  // --- Backward-compatible aliases ---
  todos: [],

  setTodos: (todos) => {
    const now = Date.now()
    const tasks = todos.map((t) => ({
      ...t,
      blocks: t.blocks ?? [],
      blockedBy: t.blockedBy ?? [],
      createdAt: t.createdAt ?? now,
      updatedAt: now
    }))
    set((state) => {
      if (!state.currentSessionId) return { tasks, todos: tasks }
      return {
        tasks,
        todos: tasks,
        tasksBySession: {
          ...state.tasksBySession,
          [state.currentSessionId]: tasks
        }
      }
    })
  },

  getTodos: () => get().tasks,

  getActiveTodo: () => get().tasks.find((t) => t.status === 'in_progress')
}))

export type { TaskItem } from "./task-store-helpers"
