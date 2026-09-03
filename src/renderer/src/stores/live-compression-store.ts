import { create } from 'zustand'
import type { CompressionStatusMeta } from '@renderer/lib/api/types'

export interface LiveCompressionState {
  sessionId: string
  draft: string
  attempt: number
  maxAttempts: number
  startedAt: number
  operationId?: string
  trigger: 'auto' | 'manual'
  displayAnchor?: NonNullable<CompressionStatusMeta['displayAnchor']>
}

interface LiveCompressionStore {
  bySessionId: Record<string, LiveCompressionState>
  start: (
    sessionId: string,
    options?: {
      attempt?: number
      maxAttempts?: number
      operationId?: string
      trigger?: 'auto' | 'manual'
      displayAnchor?: NonNullable<CompressionStatusMeta['displayAnchor']>
    }
  ) => void
  appendDraft: (sessionId: string, text: string) => void
  clear: (sessionId: string) => void
}

export const useLiveCompressionStore = create<LiveCompressionStore>((set) => ({
  bySessionId: {},
  start: (sessionId, options) =>
    set((state) => {
      const existing = state.bySessionId[sessionId]
      const attempt = options?.attempt && options.attempt > 0 ? options.attempt : 1
      const resetDraft = !existing || attempt !== existing.attempt
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            sessionId,
            draft: resetDraft ? '' : existing.draft,
            attempt,
            maxAttempts:
              options?.maxAttempts && options.maxAttempts > 0
                ? options.maxAttempts
                : (existing?.maxAttempts ?? 1),
            startedAt: existing?.startedAt ?? Date.now(),
            ...(options?.operationId || existing?.operationId
              ? { operationId: options?.operationId ?? existing?.operationId }
              : {}),
            trigger: options?.trigger ?? existing?.trigger ?? 'auto',
            ...(options?.displayAnchor || existing?.displayAnchor
              ? { displayAnchor: options?.displayAnchor ?? existing?.displayAnchor }
              : {})
          }
        }
      }
    }),
  appendDraft: (sessionId, text) =>
    set((state) => {
      if (!text) return state
      const existing = state.bySessionId[sessionId]
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: existing
            ? { ...existing, draft: existing.draft + text }
            : {
                sessionId,
                draft: text,
                attempt: 1,
                maxAttempts: 1,
                startedAt: Date.now(),
                trigger: 'auto'
              }
        }
      }
    }),
  clear: (sessionId) =>
    set((state) => {
      if (!state.bySessionId[sessionId]) return state
      const next = { ...state.bySessionId }
      delete next[sessionId]
      return { bySessionId: next }
    })
}))

export function applyLiveCompressionStreamEvent(
  sessionId: string,
  event: {
    type: string
    text?: string
    attempt?: number
    maxAttempts?: number
    operationId?: string
    trigger?: 'auto' | 'manual'
    displayAnchor?: NonNullable<CompressionStatusMeta['displayAnchor']>
  }
): void {
  const store = useLiveCompressionStore.getState()
  switch (event.type) {
    case 'context_compression_started':
    case 'context_compression_start':
      store.start(sessionId, {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        operationId: event.operationId,
        trigger: event.trigger,
        displayAnchor: event.displayAnchor
      })
      break
    case 'context_compression_delta':
      if (event.text) store.appendDraft(sessionId, event.text)
      break
    case 'context_compressed':
      store.clear(sessionId)
      break
    default:
      break
  }
}
