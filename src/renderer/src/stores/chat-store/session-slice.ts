import { nanoid } from 'nanoid'
import type { StateCreator } from 'zustand'
import type { Session, CreateSessionOptions, ChatMessage } from './types'
import { dbCreateSession, dbDeleteSession, dbUpdateSession, dbGetMessageCount, dbUpdateProject, dbListMessagesByTurns } from './db-helpers'
import { removeSessionInputDraft } from '@renderer/lib/input-drafts'

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
  deleteSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionTitle: (id: string, title: string) => void
  renameSession: (id: string, title: string) => void
  updateSessionIcon: (id: string, icon: string) => void
  updateSessionMode: (id: string, mode: Session['mode']) => void
  setSessionModelManual: (sessionId: string, providerId: string, modelId: string) => void
  setSessionModelAuto: (sessionId: string) => void
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

export const createSessionSlice: StateCreator<SessionSlice, [['zustand/immer', never]], [], SessionSlice> = (set, get) => ({
  sessions: [],
  sessionsById: {},
  activeSessionId: null,

  createSession: (mode, projectId, options) => {
    const id = nanoid()
    const now = Date.now()
    const preserveProjectless = options?.preserveProjectless === true

    let targetProjectId = preserveProjectless
      ? (projectId ?? null)
      : (projectId ?? get()['activeProjectId' as keyof SessionSlice] as string | null ?? null)

    // Try to find a default project if none specified
    if (!targetProjectId && !preserveProjectless) {
      const projects = (get() as unknown as { projects: Array<{ id: string; pluginId?: string }> }).projects
      targetProjectId = projects?.find((p) => !p.pluginId)?.id ?? projects?.[0]?.id ?? null
    }

    const newSession: Session = {
      id,
      title: 'New Conversation',
      mode,
      messages: [],
      messageCount: 0,
      messagesLoaded: true,
      loadedRangeStart: 0,
      loadedRangeEnd: 0,
      totalTurns: 0,
      lastKnownMessageCount: 0,
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
      state.activeSessionId = id
      if (targetProjectId) {
        const proj = (state as unknown as { projects: Array<{ id: string; updatedAt: number }> }).projects.find((p) => p.id === targetProjectId)
        if (proj) proj.updatedAt = now
      }
    })

    void dbCreateSession(newSession)
    if (targetProjectId) {
      void dbUpdateProject(targetProjectId, { updatedAt: now })
    }
    return id
  },

  deleteSession: (id) => {
    set((state) => {
      const idx = findSessionIndex(state.sessions, id)
      if (idx !== -1) {
        state.sessions.splice(idx, 1)
        syncSessionsById(state)
      }
      if (state.activeSessionId === id) {
        state.activeSessionId = state.sessions[0]?.id ?? null
      }
    })
    void dbDeleteSession(id)
    void window.api.workerRequest('agent/clear-session', { sessionId: id })
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
        useUIStore.getState().removeRightPanelTabsForSession(id)
      })
      .catch((err) => {
        console.warn('[chat-store] Failed to clean right-panel tabs for deleted session:', err)
      })
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id })
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

  clearSessionMessages: (sessionId) => {
    set((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.messages = []
        session.messageCount = 0
        session.updatedAt = Date.now()
      }
    })
    void window.api.workerRequest("agent/clear-session", { sessionId })
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
      state.activeSessionId = newId
    })
    void dbCreateSession(copy)
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
      state.activeSessionId = null
    })
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
        session.updatedAt = Date.now()
      }
    })
  },

  beginUserTurn: (sessionId, userMsg, assistantMsg, streamingMessageId) => {
    const now = Date.now()
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
      session.updatedAt = now
      if (sessionProjectId) {
        const proj = (state as unknown as { projects: Array<{ id: string; updatedAt: number }> }).projects.find((p) => p.id === sessionProjectId)
        if (proj) proj.updatedAt = now
      }
      if (streamingMessageId) {
        ;(state as unknown as { streamingMessages: Record<string, string> }).streamingMessages[sessionId] = streamingMessageId
        ;(state as unknown as { streamingMessageId: string | null }).streamingMessageId = streamingMessageId
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
          if (!target) return
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

      set((state) => {
        const target = state.sessions.find((s) => s.id === sessionId)
        if (!target) return
        target.messages = messages
        target.messageCount = actualCount
        target.messagesLoaded = true
        // loadedRangeStart = created_at timestamp of the earliest loaded message.
        // If hasMore is false, we've loaded everything from the beginning.
        target.loadedRangeStart = hasMore ? rangeStart : 0
        target.loadedRangeEnd = rangeStart + messages.length
        target.totalTurns = totalTurns
        target.lastKnownMessageCount = actualCount
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
