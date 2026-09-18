import { nanoid } from 'nanoid'
import type { StateCreator } from 'zustand'
import type { Session, CreateSessionOptions, ChatMessage } from './types'
import { dbCreateSession, dbDeleteSession, dbUpdateSession, dbGetMessageCount, dbUpdateProject, dbListMessagesByTurns, dbGetSessionUsageStats } from './db-helpers'
import { removeSessionInputDraft } from '@renderer/lib/input-drafts'
import { normalizeSessionContext, resolveSessionProjectId } from '@renderer/lib/session-context'
import { useSettingsStore } from '@renderer/stores/settings-store'

// T-3: 运行时驻留会话的内存窗口收缩。
//
// 会话一旦在本进程内产生过消息（isRuntimeResident）就会跳过 DB 重载
// （见 loadRecentSessionMessages 的守卫），消息只增不减。用户主动上滚可以
// 临时加载更多历史（fetchOlderMessages / prependMessages），但每发一条新消息
// 就把窗口收缩回最近 N 轮 —— 更早的消息留在 DB，仍可经「加载更早」拉回。
//
// 轮 = 一条 user 消息，以及它之后的 assistant / tool 消息；
// N = 设置项 maxResidentTurns（「运行与性能」页，默认 15，范围 5–50）。

/**
 * 保留最近 `maxTurns` 轮，返回应保留的尾部切片与被裁掉的头部长度。
 * 不足 `maxTurns` 轮（或刚好从第 0 条开始）时原样返回，`removed` 为 0。
 */
function trimMessagesToRecentTurns<T extends { role: string }>(
  messages: T[],
  maxTurns: number
): { messages: T[]; removed: number } {
  let userSeen = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') continue
    userSeen += 1
    if (userSeen < maxTurns) continue
    if (index === 0) return { messages, removed: 0 }
    return { messages: messages.slice(index), removed: index }
  }
  return { messages, removed: 0 }
}

export interface SessionSlice {
  sessions: Session[]
  sessionsById: Record<string, number>
  activeSessionId: string | null
  forkSessionFromMessage?: (sessionId: string, messageId: string) => Promise<string | null>
  loadMessageWindowAround?: (sessionId: string, options?: { messageId?: string; sortOrder?: number }, windowSize?: number) => Promise<void>
  getLatestSessionByPlanId?: (planId: string) => Session | null

  createSession: (
    mode: Session['mode'],
    projectId?: string | null,
    options?: CreateSessionOptions
  ) => string
  deleteSession: (id: string) => Promise<void>
  setActiveSession: (id: string | null) => Promise<boolean>
  updateSessionTitle: (id: string, title: string) => void
  renameSession: (id: string, title: string) => void
  updateSessionIcon: (id: string, icon: string) => void
  updateSessionMode: (id: string, mode: Session['mode']) => void
  updateSessionCollaborationMode: (id: string, mode: Session['collaborationMode']) => void
  updateSessionPermissionMode: (id: string, mode: Session['permissionMode']) => void
  /** iter-32 S-73：会话级「请求上下文上限」开关。 */
  updateSessionContextCap: (id: string, enabled: boolean) => void
  setSessionModelManual: (sessionId: string, providerId: string, modelId: string) => void
  setSessionModelAuto: (sessionId: string) => void
  /** iter-29 / S-21: auto 模式下换服务商+模型，mode 保持 auto（不清绑定）。 */
  setSessionAutoFallbackTarget: (
    sessionId: string,
    providerId: string,
    modelId: string
  ) => void
  setSessionModelInherit: (sessionId: string) => void
  clearSessionMessages: (sessionId: string) => void
  clearSessionPromptSnapshot: (sessionId: string) => void
  applyBackgroundSnapshot?: (sessionId: string, snapshot: { patchedMessagesById: Record<string, unknown>; addedMessagesById: Record<string, unknown>; addedMessageIds: string[] }) => void
  togglePinSession: (sessionId: string) => void
  duplicateSession: (sessionId: string) => string | null
  restoreSession: (session: Session) => void
  clearAllSessions: () => void

  // Message operations
  addMessage: (sessionId: string, msg: ChatMessage) => void
  /**
   * S-57：把「立即插入」送进当前轮的那条用户消息回显到聊天窗。
   * 不开新一轮、不碰 streaming 状态，只做插入 + 时间戳/计数维护。
   */
  insertUserMessageIntoRunningTurn: (sessionId: string, msg: ChatMessage) => void
  beginUserTurn: (
    sessionId: string,
    userMsg: ChatMessage | null,
    assistantMsg: ChatMessage | null,
    streamingMessageId: string | null
  ) => void
  updateMessage: (sessionId: string, msgId: string, patch: Partial<ChatMessage>) => void
  removeMessageById: (sessionId: string, msgId: string) => boolean
  appendTextDelta: (sessionId: string, msgId: string, text: string) => void
  appendThinkingDelta: (sessionId: string, msgId: string, thinking: string) => void
  removeLastAssistantMessage: (sessionId: string) => boolean
  removeLastUserMessage: (sessionId: string) => void
  truncateMessagesFrom: (sessionId: string, fromIndex: number) => void
  replaceSessionMessages: (sessionId: string, messages: ChatMessage[]) => void

  // Helpers
  getActiveSession: () => Session | undefined
  getSessionMessages: (sessionId: string) => ChatMessage[]

  // Message loading
  loadRecentSessionMessages: (sessionId: string, force?: boolean, limit?: number) => Promise<void>
  fetchOlderMessages: (sessionId: string, limit?: number) => Promise<{ messages: ChatMessage[]; rangeStart: number; hasMore: boolean; totalTurns: number }>
  prependMessages: (sessionId: string, messages: ChatMessage[], rangeStart: number, hasMore: boolean, totalTurns?: number) => void
}

function syncSessionsById(state: { sessions: Session[]; sessionsById: Record<string, number> }): void {
  state.sessionsById = {}
  for (let i = 0; i < state.sessions.length; i++) {
    state.sessionsById[state.sessions[i].id] = i
  }
}

function findSessionIndex(sessions: Session[], id: string): number {
  return sessions.findIndex((s) => s.id === id)
}

let pendingSessionSwitch: { id: string | null; promise: Promise<boolean> } | null = null

export const createSessionSlice: StateCreator<SessionSlice, [['zustand/immer', never]], [], SessionSlice> = (set, get) => ({
  sessions: [],
  sessionsById: {},
  activeSessionId: null,

  createSession: (mode, projectId, options) => {
    const id = nanoid()
    const now = Date.now()
    const settings = useSettingsStore.getState()
    const requestedScope = options?.scope ??
      (options?.preserveProjectless === true || !projectId ? 'global' : 'project')
    const context = normalizeSessionContext(
      {
        scope: requestedScope,
        collaborationMode: options?.collaborationMode,
        permissionMode: options?.permissionMode,
        contextCapEnabled: options?.contextCapEnabled,
        projectId
      },
      {
        projectCollaborationMode: settings.projectSessionDefaultCollaborationMode,
        coworkPermissionMode: settings.coworkDefaultPermissionMode
      }
    )
    const targetProjectId = context.projectId ?? null

    const newSession: Session = {
      id,
      title: 'New Conversation',
      mode,
      ...context,
      messages: [],
      messageCount: 0,
      messagesLoaded: true,
      loadedRangeStart: 0,
      loadedRangeEnd: 0,
      totalTurns: 0,
      lastKnownMessageCount: 0,
      isRuntimeResident: false,
      createdAt: now,
      updatedAt: now,
      projectId: targetProjectId ?? undefined,
      workingFolder: options?.workingFolder ?? undefined,
      sshConnectionId: options?.sshConnectionId ?? undefined,
      planId: options?.planId ?? undefined,
      modelSelectionMode: 'inherit'
    }

    set((state) => {
      state.sessions.push(newSession)
      syncSessionsById(state)
      if (targetProjectId) {
        const proj = (state as unknown as { projects: Array<{ id: string; updatedAt: number }> }).projects.find((p) => p.id === targetProjectId)
        if (proj) proj.updatedAt = now
      }
    })

    void dbCreateSession(newSession)
    if (targetProjectId) {
      void dbUpdateProject(targetProjectId, { updatedAt: now })
    }
    if (options?.activate !== false) {
      void get().setActiveSession(id)
    }
    return id
  },

  deleteSession: async (id) => {
    const wasActive = get().activeSessionId === id
    const nextActiveId = wasActive
      ? get().sessions.find((session) => session.id !== id)?.id ?? null
      : null
    if (wasActive) {
      const switched = await get().setActiveSession(nextActiveId)
      if (!switched) return
    }

    set((state) => {
      const idx = findSessionIndex(state.sessions, id)
      if (idx !== -1) {
        state.sessions.splice(idx, 1)
        syncSessionsById(state)
      }
    })
    void dbDeleteSession(id)
    void window.api.workerRequest('agent/clear-session', { sessionId: id })
    // Cascade: drop the deleted session's agent Todo rows (DB + memory cache).
    // Dynamic import avoids a chat-store → task-store → chat-store cycle.
    void import('@renderer/stores/task-store')
      .then(({ useTaskStore }) => {
        useTaskStore.getState().deleteSessionTasks(id)
        // The fallback switch to sessions[0] above bypasses setActiveSession,
        // so load the new active session's tasks here.
        const nextActive = get().activeSessionId
        if (nextActive) {
          void useTaskStore.getState().loadTasksForSession(nextActive)
        }
      })
      .catch((err) => {
        console.warn('[chat-store] Failed to clean tasks for deleted session:', err)
      })
    // Drop the persisted composer draft so deleted sessions leave no orphans.
    void removeSessionInputDraft(id)
    void import('@renderer/hooks/use-chat-actions')
      .then(({ clearPendingSessionMessages }) => clearPendingSessionMessages(id))
      .catch((err) => {
        console.warn('[chat-store] Failed to clear queued messages for deleted session:', err)
      })
    // Close any right-panel tabs still bound to the deleted session (dynamic
    // import avoids a chat-store → ui-store circular dependency at load time).
    void import('@renderer/stores/ui-store')
      .then(({ useUIStore }) => {
        // 上面的回落在 immer 事务里直写 activeSessionId、不经 setActiveSession，
        // 作用域锚点必须在这里补一次，否则删掉当前会话后锚点停在已删 id，右侧
        // 面板的 tab 过滤结果恒空（面板空白，直到用户手动再切一次会话）。
        const nextActiveId = get().activeSessionId
        const ui = useUIStore.getState()
        ui.syncSessionScopedState(nextActiveId, resolveSessionProjectId(get().sessions, nextActiveId))
        // 先同步作用域再清 tab：closeRightPanelTab 的收起判据读的是当前作用域。
        ui.removeRightPanelTabsForSession(id)
      })
      .catch((err) => {
        console.warn('[chat-store] Failed to clean right-panel tabs for deleted session:', err)
      })
    // S-21 收口：限额切换链路是内存态、按会话 id 存 —— 会话删了就随它一起丢，
    // 否则该表只会靠 TTL 惰性回收，删掉的会话会一直挂着。
    void import('@renderer/lib/agent/provider-auto-fallback')
      .then(({ clearAutoFallbackAttempts }) => clearAutoFallbackAttempts(id))
      .catch((err) => {
        console.warn('[chat-store] Failed to clear failover chain for deleted session:', err)
      })
  },

  setActiveSession: (id) => {
    const currentId = get().activeSessionId
    if (currentId === id) return Promise.resolve(true)
    if (pendingSessionSwitch?.id === id) return pendingSessionSwitch.promise

    const promise = (async (): Promise<boolean> => {
      const { useUIStore } = await import('@renderer/stores/ui-store')
      const ui = useUIStore.getState()
      const prepared = await ui.prepareSessionSwitch(id)
      if (!prepared) return false

      set({ activeSessionId: id })
      ui.syncSessionScopedState(id, resolveSessionProjectId(get().sessions, id))

      // Keep the session-scoped task store in sync with the visible session.
      void import('@renderer/stores/task-store')
        .then(({ useTaskStore }) => {
          if (id) {
            void useTaskStore.getState().loadTasksForSession(id)
          } else {
            useTaskStore.getState().clearTasks()
          }
        })
        .catch((err) => {
          console.warn('[chat-store] Failed to sync session tasks:', err)
        })
      return true
    })()
    pendingSessionSwitch = { id, promise }
    void promise.then(
      () => {
        if (pendingSessionSwitch?.promise === promise) pendingSessionSwitch = null
      },
      () => {
        if (pendingSessionSwitch?.promise === promise) pendingSessionSwitch = null
      }
    )
    return promise
  },

  updateSessionTitle: (id, title) => {
    const now = Date.now()
    set((state) => {
      const session = state.sessions.find((s) => s.id === id)
      if (session) {
        session.title = title
        session.updatedAt = now
      }
    })
    void dbUpdateSession(id, { title, updatedAt: now })
  },

  updateSessionIcon: (id, icon) => {
    const now = Date.now()
    set((state) => {
      const session = state.sessions.find((s) => s.id === id)
      if (session) {
        session.icon = icon
        session.updatedAt = now
      }
    })
    void dbUpdateSession(id, { icon, updatedAt: now })
  },

  renameSession: (id, title) => {
    const now = Date.now()
    set((state) => {
      const session = state.sessions.find((s) => s.id === id)
      if (session) {
        session.title = title
        session.updatedAt = now
      }
    })
    void dbUpdateSession(id, { title, updatedAt: now })
  },

  updateSessionMode: (id, mode) => {
    const now = Date.now()
    set((state) => {
      const session = state.sessions.find((s) => s.id === id)
      if (session) {
        session.mode = mode
        session.updatedAt = now
      }
    })
    void dbUpdateSession(id, { mode, updatedAt: now })
  },

  updateSessionCollaborationMode: (id, mode) => {
    const session = get().sessions.find((item) => item.id === id)
    if (!session) return
    const settings = useSettingsStore.getState()
    const context = normalizeSessionContext(
      { ...session, collaborationMode: mode },
      {
        projectCollaborationMode: settings.projectSessionDefaultCollaborationMode,
        coworkPermissionMode: settings.coworkDefaultPermissionMode
      }
    )
    const now = Date.now()
    set((state) => {
      const target = state.sessions.find((item) => item.id === id)
      if (!target) return
      Object.assign(target, context, { updatedAt: now })
    })
    void dbUpdateSession(id, { ...context, updatedAt: now })
  },

  updateSessionPermissionMode: (id, mode) => {
    const session = get().sessions.find((item) => item.id === id)
    if (!session) return
    const settings = useSettingsStore.getState()
    const context = normalizeSessionContext(
      { ...session, permissionMode: mode },
      {
        projectCollaborationMode: settings.projectSessionDefaultCollaborationMode,
        coworkPermissionMode: settings.coworkDefaultPermissionMode
      }
    )
    const now = Date.now()
    set((state) => {
      const target = state.sessions.find((item) => item.id === id)
      if (!target) return
      Object.assign(target, context, { updatedAt: now })
    })
    void dbUpdateSession(id, { ...context, updatedAt: now })
  },

  updateSessionContextCap: (id, enabled) => {
    const session = get().sessions.find((item) => item.id === id)
    if (!session) return
    const settings = useSettingsStore.getState()
    const context = normalizeSessionContext(
      { ...session, contextCapEnabled: enabled },
      {
        projectCollaborationMode: settings.projectSessionDefaultCollaborationMode,
        coworkPermissionMode: settings.coworkDefaultPermissionMode
      }
    )
    const now = Date.now()
    set((state) => {
      const target = state.sessions.find((item) => item.id === id)
      if (!target) return
      Object.assign(target, context, { updatedAt: now })
    })
    void dbUpdateSession(id, { ...context, updatedAt: now })
  },

  clearSessionMessages: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.messages = []
        session.messageCount = 0
        session.messagesLoaded = true
        session.loadedRangeStart = 0
        session.loadedRangeEnd = 0
        session.totalTurns = 0
        session.lastKnownMessageCount = 0
        session.isRuntimeResident = false
        session.updatedAt = Date.now()
      }
    })
    void window.api.workerRequest("agent/clear-session", { sessionId })
    // Clearing the conversation also drops its session-scoped agent Todos
    // (DB rows are removed via db:tasks:delete-by-session inside the store).
    void import('@renderer/stores/task-store')
      .then(({ useTaskStore }) => {
        useTaskStore.getState().deleteSessionTasks(sessionId)
      })
      .catch((err) => {
        console.warn('[chat-store] Failed to clear tasks for cleared session:', err)
      })
    void import('@renderer/hooks/use-chat-actions')
      .then(({ clearPendingSessionMessages }) => clearPendingSessionMessages(sessionId))
      .catch((err) => {
        console.warn('[chat-store] Failed to clear queued messages for cleared session:', err)
      })
  },

  clearSessionPromptSnapshot: (_sessionId: string) => {
    // TODO: stub - clear session prompt snapshot
  },

  togglePinSession: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.pinned = !session.pinned
        session.updatedAt = Date.now()
      }
    })
  },

  duplicateSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return null
    const newId = nanoid()
    const now = Date.now()
    const copy: Session = {
      ...session,
      id: newId,
      title: `${session.title} (copy)`,
      messages: session.messages.map((m) => ({ ...m, id: `${m.id}_copy_${nanoid(6)}` })),
      createdAt: now,
      updatedAt: now,
      pinned: false
    }
    set((state) => {
      state.sessions.push(copy)
      syncSessionsById(state)
    })
    void dbCreateSession(copy)
    void get().setActiveSession(newId)
    return newId
  },

  restoreSession: (session) => {
    set((state) => {
      const existing = state.sessions.find((s) => s.id === session.id)
      if (existing) {
        Object.assign(existing, session)
      } else {
        state.sessions.push(session)
        syncSessionsById(state)
      }
    })
  },

  clearAllSessions: () => {
    const sessionIds = get().sessions.map((session) => session.id)
    set((state) => {
      state.sessions = []
      state.sessionsById = {}
    })
    void get().setActiveSession(null)
    void import('@renderer/hooks/use-chat-actions')
      .then(({ clearPendingSessionMessages }) => {
        for (const sessionId of sessionIds) clearPendingSessionMessages(sessionId)
      })
      .catch((err) => {
        console.warn('[chat-store] Failed to clear queued messages for all sessions:', err)
      })
  },

  addMessage: (sessionId, msg) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.messages.push(msg)
        session.messageCount = session.messages.length
        session.messagesLoaded = true
        session.isRuntimeResident = true
        session.updatedAt = Date.now()
      }
    })
  },

  insertUserMessageIntoRunningTurn: (sessionId, msg) => {
    const now = Date.now()
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      // 插在正在流式输出的那条 assistant 之前：用户是在 agent 输出到一半时插的话，
      // 追加到末尾会变成两条 user 连在一起。找不到流式消息（例如已 loop_end）就退回落末尾。
      const streamingId = (state as unknown as { streamingMessages?: Record<string, string> })
        .streamingMessages?.[sessionId]
      const at = streamingId ? session.messages.findIndex((m) => m.id === streamingId) : -1
      if (at >= 0) session.messages.splice(at, 0, msg)
      else session.messages.push(msg)
      session.messageCount = session.messages.length
      session.messagesLoaded = true
      session.isRuntimeResident = true
      session.updatedAt = now
    })
  },

  beginUserTurn: (sessionId, userMsg, assistantMsg, streamingMessageId) => {
    const now = Date.now()
    // T-3: 每次发消息读一次最新配置（「运行与性能」页可调），立即生效。
    const maxResidentTurns = useSettingsStore.getState().maxResidentTurns
    let sessionProjectId: string | undefined
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      sessionProjectId = session.projectId
      if (userMsg) {
        session.messages.push(userMsg)
      }
      if (assistantMsg) {
        session.messages.push(assistantMsg)
      }
      session.messageCount = session.messages.length
      session.messagesLoaded = true
      session.isRuntimeResident = true
      session.updatedAt = now
      // T-3: 发新消息时把驻留窗口收缩回最近 maxResidentTurns 轮。
      // 只裁内存，DB 不动；游标（loadedRangeStart）跟到新的最早一条，
      // 否则「加载更早」会越过被裁掉的这一段。
      const trimmed = trimMessagesToRecentTurns(session.messages, maxResidentTurns)
      if (trimmed.removed > 0) {
        session.messages = trimmed.messages
        session.messageCount = trimmed.messages.length
        session.loadedRangeStart = trimmed.messages[0]?.createdAt ?? 0
      }
      if (sessionProjectId) {
        const proj = (state as unknown as { projects: Array<{ id: string; updatedAt: number }> }).projects.find((p) => p.id === sessionProjectId)
        if (proj) proj.updatedAt = now
      }
      if (streamingMessageId) {
        const streaming = state as unknown as {
          streamingMessages: Record<string, string>
          streamingMessageId: string | null
        }
        // iter-30 BUG-B：同 setStreamingMessageId —— 已挂着的活跃 run 不能被顶掉，
        // 否则正在跑的那条流会失去渲染端入口。
        if (!streaming.streamingMessages[sessionId]) {
          streaming.streamingMessages[sessionId] = streamingMessageId
        }
        streaming.streamingMessageId = streamingMessageId
      }
    })
    if (sessionProjectId) {
      void dbUpdateProject(sessionProjectId, { updatedAt: now })
    }
  },

  updateMessage: (sessionId, msgId, patch) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const msg = session.messages.find((m) => m.id === msgId)
      if (msg) {
        Object.assign(msg, patch)
      }
    })
  },

  removeMessageById: (sessionId, msgId) => {
    let removed = false
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const idx = session.messages.findIndex((m) => m.id === msgId)
      if (idx !== -1) {
        session.messages.splice(idx, 1)
        session.messageCount = session.messages.length
        removed = true
      }
    })
    return removed
  },

  appendTextDelta: (sessionId, msgId, text) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const msg = session.messages.find((m) => m.id === msgId)
      if (msg) {
        msg.text += text
      }
    })
  },

  appendThinkingDelta: (sessionId, msgId, thinking) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const msg = session.messages.find((m) => m.id === msgId)
      if (msg) {
        msg.thinking = (msg.thinking ?? '') + thinking
      }
    })
  },

  removeLastAssistantMessage: (sessionId) => {
    let removed = false
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].role === 'assistant') {
          session.messages.splice(i, 1)
          session.messageCount = session.messages.length
          removed = true
          break
        }
      }
    })
    return removed
  },

  removeLastUserMessage: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].role === 'user') {
          session.messages.splice(i, 1)
          session.messageCount = session.messages.length
          break
        }
      }
    })
  },

  truncateMessagesFrom: (sessionId, fromIndex) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.messages = session.messages.slice(0, fromIndex)
      session.messageCount = session.messages.length
    })
  },

  replaceSessionMessages: (sessionId, messages) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.messages = messages
      session.messageCount = messages.length
      session.updatedAt = Date.now()
    })
  },

  setSessionModelManual: (sessionId, providerId, modelId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.providerId = providerId
      session.modelId = modelId
      session.modelSelectionMode = 'manual'
      session.updatedAt = Date.now()
    })
    const session = get().sessions.find((s) => s.id === sessionId)
    if (session) void dbUpdateSession(sessionId, { providerId, modelId, modelSelectionMode: 'manual' })
  },

  setSessionAutoFallbackTarget: (sessionId, providerId, modelId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      // auto 模式保持不变：下一次失败还要继续往下切。
      session.providerId = providerId
      session.modelId = modelId
      session.modelSelectionMode = 'auto'
      session.updatedAt = Date.now()
    })
    void dbUpdateSession(sessionId, { providerId, modelId, modelSelectionMode: 'auto' })
  },

  setSessionModelAuto: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.modelSelectionMode = 'auto'
      session.updatedAt = Date.now()
    })
    void dbUpdateSession(sessionId, { modelSelectionMode: 'auto' })
  },

  setSessionModelInherit: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.modelSelectionMode = 'inherit'
      session.providerId = undefined
      session.modelId = undefined
      session.updatedAt = Date.now()
    })
    void dbUpdateSession(sessionId, { modelSelectionMode: 'inherit', providerId: undefined, modelId: undefined })
  },

  getActiveSession: () => {
    const state = get()
    return state.sessions.find((s) => s.id === state.activeSessionId)
  },

  getSessionMessages: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    return session?.messages ?? []
  },

  loadRecentSessionMessages: async (sessionId, _force, _limit) => {
    const state = get()
    const session = state.sessions.find((s) => s.id === sessionId)
    if (!session) return

    if (session.isRuntimeResident) {
      return
    }

    // Already loaded and no change
    if (!_force && session.messagesLoaded && session.messages.length > 0) {
      return
    }

    try {
      // Load the most recent N conversation turns (user -> assistant round-trips).
      // This replaces the old offset-based pagination with turn-based loading.
      const actualCount = await dbGetMessageCount(sessionId)

      // No messages in DB
      if (actualCount === 0) {
        set((state) => {
          const target = state.sessions.find((s) => s.id === sessionId)
          if (!target || target.isRuntimeResident) return
          target.messages = []
          target.messagesLoaded = true
          target.messageCount = 0
          target.loadedRangeStart = 0
          target.loadedRangeEnd = 0
          target.totalTurns = 0
          target.lastKnownMessageCount = 0
        })
        return
      }

      const { messages, rangeStart, hasMore, totalTurns } = await dbListMessagesByTurns({
        sessionId,
        turns: _limit ?? 5
      })

      // Whole-session usage baseline (status bar), rebased on every load.
      //
      // T-14: the DB rollup already covers every persisted message, so the live
      // accumulator (fed by `message_end`) is cleared in the same pass — leaving it
      // in place double-counts the messages the baseline just counted. The previous
      // "only take a baseline when no live total exists yet" rule silently dropped
      // the whole history for any session that had already run a turn before its
      // messages were first loaded, which is why output/total did not add up while
      // the backend-owned cache counters still looked right.
      const usageBaseline = await dbGetSessionUsageStats(sessionId)

      set((state) => {
        const target = state.sessions.find((s) => s.id === sessionId)
        if (!target || target.isRuntimeResident) return
        target.messages = messages
        target.messageCount = actualCount
        target.messagesLoaded = true
        // loadedRangeStart = created_at timestamp of the earliest loaded message.
        // If hasMore is false, we've loaded everything from the beginning.
        target.loadedRangeStart = hasMore ? rangeStart : 0
        target.loadedRangeEnd = rangeStart + messages.length
        target.totalTurns = totalTurns
        target.lastKnownMessageCount = actualCount
        if (usageBaseline) {
          target.usageBaseline = {
            // The rollup's totalInput is billable (cache excluded), but addUsageToTotals
            // accumulates usage.inputTokens as the full input (cache included). Add the cache
            // counters back so both sides share one footing — otherwise the session total
            // under-counts input and cache read can appear to exceed it.
            inputTokens:
              usageBaseline.totalInput +
              usageBaseline.totalCacheRead +
              usageBaseline.totalCacheCreation,
            outputTokens: usageBaseline.totalOutput,
            cacheReadTokens: usageBaseline.totalCacheRead,
            cacheCreationTokens: usageBaseline.totalCacheCreation,
            reasoningTokens: usageBaseline.totalReasoning,
            totalDurationMs: usageBaseline.totalDurationMs,
            // Kept for consumers that read it directly; addUsageToTotals recomputes
            // billable input as inputTokens minus the cache counters.
            billableInputTokens: usageBaseline.totalInput
          }
          // The baseline supersedes everything accumulated so far (see above).
          target.sessionUsageTotals = undefined
        }
      })
      // No backend rebuild here: the Worker conversation is restored lazily
      // inside agent/run on the first send of the session.
    } catch (err) {
      console.error('[DB] loadRecentSessionMessages failed:', err)
      set((state) => {
        const target = state.sessions.find((s) => s.id === sessionId)
        if (!target) return
        target.messagesLoaded = true
      })
    }
  },

  fetchOlderMessages: async (sessionId, _limit) => {
    const state = get()
    const session = state.sessions.find((s) => s.id === sessionId)
    if (!session) return { messages: [], rangeStart: 0, hasMore: false, totalTurns: 0 }
    if (session.loadedRangeStart <= 0) return { messages: [], rangeStart: 0, hasMore: false, totalTurns: 0 }

    try {
      const { messages, rangeStart, hasMore, totalTurns } = await dbListMessagesByTurns({
        sessionId,
        turns: _limit ?? 5,
        beforeCreatedAt: session.loadedRangeStart
      })
      if (messages.length === 0) return { messages: [], rangeStart: 0, hasMore: false, totalTurns }
      const existingIds = new Set(session.messages.map((m) => m.id))
      const newMessages = messages.filter((m) => !existingIds.has(m.id))
      return { messages: newMessages, rangeStart, hasMore, totalTurns }
    } catch (err) {
      console.error('[DB] fetchOlderMessages failed:', err)
      return { messages: [], rangeStart: 0, hasMore: false, totalTurns: 0 }
    }
  },

  prependMessages: (sessionId, messages, rangeStart, hasMore, totalTurns) => {
    set((state) => {
      const target = state.sessions.find((s) => s.id === sessionId)
      if (!target) return
      target.messages = [...messages, ...target.messages]
      target.loadedRangeStart = hasMore ? rangeStart : 0
      target.loadedRangeEnd = target.loadedRangeStart + target.messages.length
      if (totalTurns !== undefined) {
        target.totalTurns = totalTurns
      }
    })
  },

  loadMessageWindowAround: async (sessionId, options, _windowSize) => {
    const state = get()
    const session = state.sessions.find((s) => s.id === sessionId)
    if (!session) return

    // If the target message is already loaded, do nothing — the scroll utility handles the jump.
    if (options?.messageId && session.messages.some((m) => m.id === options.messageId)) {
      return
    }

    // Use the target's createdAt to load a window of turns around it.
    const targetCreatedAt = options?.sortOrder
    if (targetCreatedAt === undefined) return

    try {
      // Load 5 turns ending just after the target (so the target is included)
      const { messages, rangeStart, hasMore, totalTurns } = await dbListMessagesByTurns({
        sessionId,
        turns: _windowSize ?? 5,
        // beforeSortOrder = target + 1 so the target is included in the range
        beforeCreatedAt: targetCreatedAt + 1
      })

      if (messages.length === 0) return

      set((state) => {
        const target = state.sessions.find((s) => s.id === sessionId)
        if (!target) return
        if (target.isRuntimeResident) {
          const existingIds = new Set(target.messages.map((message) => message.id))
          target.messages = [...target.messages, ...messages.filter((message) => !existingIds.has(message.id))]
            .sort((left, right) => left.createdAt - right.createdAt)
          target.messageCount = Math.max(target.messageCount, target.messages.length)
          target.messagesLoaded = true
          target.totalTurns = Math.max(target.totalTurns ?? 0, totalTurns)
          return
        }
        target.messages = messages
        target.messagesLoaded = true
        target.loadedRangeStart = hasMore ? rangeStart : 0
        target.loadedRangeEnd = rangeStart + messages.length
        target.totalTurns = totalTurns
      })
    } catch (err) {
      console.error('[DB] loadMessageWindowAround failed:', err)
    }
  }
})
