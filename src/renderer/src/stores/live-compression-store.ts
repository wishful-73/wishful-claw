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

// Compression deltas arrive one chunk at a time, and one IPC read can decode
// hundreds of them. Notifying subscribers per chunk exceeds React's nested-update
// limit ("Maximum update depth exceeded"), so text accumulates here and reaches
// subscribers at most once per frame. The draft is display-only — the Worker's
// compact artifacts are the durable summary — so coalescing loses nothing.
const pendingDrafts = new Map<string, string[]>()
let flushScheduled = false

function flushPendingDrafts(): void {
  if (pendingDrafts.size === 0) return
  const batches = Array.from(pendingDrafts, ([sessionId, chunks]) => [sessionId, chunks.join('')] as const)
  pendingDrafts.clear()
  useLiveCompressionStore.setState((state) => {
    const bySessionId = { ...state.bySessionId }
    for (const [sessionId, text] of batches) {
      const existing = bySessionId[sessionId]
      bySessionId[sessionId] = existing
        ? { ...existing, draft: existing.draft + text }
        : {
            sessionId,
            draft: text,
            attempt: 1,
            maxAttempts: 1,
            startedAt: Date.now(),
            trigger: 'auto' as const
          }
    }
    return { bySessionId }
  })
}

function scheduleDraftFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  const flush = (): void => {
    flushScheduled = false
    flushPendingDrafts()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else setTimeout(flush, 16)
}

export const useLiveCompressionStore = create<LiveCompressionStore>((set) => ({
  bySessionId: {},
  start: (sessionId, options) => {
    // Merge buffered text first: a retry that keeps the same attempt number
    // continues the existing draft, and a reset must not resurrect it later.
    flushPendingDrafts()
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
    })
  },
  appendDraft: (sessionId, text) => {
    if (!text) return
    const pending = pendingDrafts.get(sessionId)
    if (pending) pending.push(text)
    else pendingDrafts.set(sessionId, [text])
    scheduleDraftFlush()
  },
  clear: (sessionId) => {
    // The live card is replaced by the persisted summary, so a tail that never
    // made it to a frame is dropped instead of being flushed back in.
    pendingDrafts.delete(sessionId)
    flushPendingDrafts()
    set((state) => {
      if (!state.bySessionId[sessionId]) return state
      const next = { ...state.bySessionId }
      delete next[sessionId]
      return { bySessionId: next }
    })
  }
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
