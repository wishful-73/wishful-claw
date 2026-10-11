/**
 * Global PM → project session queue handlers
 *
 * Handles the reverse-requests that let the global session (project manager)
 * observe and intervene in another session's pending message queue:
 *   - `project/session-queue`                → read queue + live run state
 *   - `project/remove-session-queue-message` → drop one queued message
 *   - `project/clear-session-queue`          → drop every queued message
 *   - `project/resume-session-queue`         → lift a paused queue dispatch
 *   - `project/stop-session-run`             → stop the running turn (queue kept)
 *
 * The queue lives in renderer memory only (`use-chat-actions` pending store), so
 * these reuse exactly the API the queue panel in `InputArea` uses — no DB, no new
 * state. The queue handlers never interrupt the active run: removing a queued
 * message only prevents it from being dispatched. Stopping the run is a separate
 * tool (`project/stop-session-run`) that goes through the same `cancelStream` the
 * UI stop button uses.
 *
 * Stopping freezes the queue along the way (`cancelStream` pauses dispatch, and the
 * aborted loop end pauses it again) — that is the user-facing "stop means the queue
 * waits for me" rule, but it has no automatic way out. `project/resume-session-queue`
 * is the PM-side equivalent of the「继续」button in the queue panel: it lifts the
 * pause so the queued messages run again.
 */

import { useChatStore } from '@renderer/stores/chat-store'
import { dbGetSession } from '@renderer/stores/chat-store/db-helpers'
import {
  clearPendingSessionMessages,
  dispatchNextQueuedMessageForSession,
  getPendingSessionMessages,
  hasActiveSessionRunForSession,
  isPendingSessionDispatchPaused,
  removePendingSessionMessage,
  resumePendingSessionDispatch
} from '@renderer/hooks/use-chat-actions'

/** Per-message text preview cap — keeps a long queued prompt from flooding tool output. */
const TEXT_PREVIEW_LIMIT = 200

interface SessionQueueMessagePreview {
  id: string
  text: string
}

interface SessionQueueResult {
  success: boolean
  sessionId?: string
  /** Whether the session exists at all — separates "empty queue" from "unknown session". */
  found?: boolean
  hasActiveRun?: boolean
  dispatchPaused?: boolean
  count?: number
  messages?: SessionQueueMessagePreview[]
  removed?: number
  cleared?: number
  result?: string
  error?: string
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > TEXT_PREVIEW_LIMIT
    ? `${normalized.slice(0, TEXT_PREVIEW_LIMIT)}…`
    : normalized
}

/**
 * A session that is neither in the store nor in the DB cannot have a queue we
 * can see — reported as `found: false` rather than as an empty queue.
 */
async function ensureSessionExists(sessionId: string): Promise<boolean> {
  if (useChatStore.getState().sessions.some((session) => session.id === sessionId)) return true
  return (await dbGetSession(sessionId)) != null
}

export async function handleProjectGetSessionQueue(params: unknown): Promise<SessionQueueResult> {
  const { sessionId } = (params ?? {}) as { sessionId?: string }
  if (!sessionId) {
    return { success: false, error: 'Missing required field: sessionId' }
  }
  if (!(await ensureSessionExists(sessionId))) {
    return {
      success: false,
      found: false,
      sessionId,
      error: `Session "${sessionId}" does not exist.`
    }
  }

  const messages = getPendingSessionMessages(sessionId).map((message) => ({
    id: message.id,
    text: previewText(message.text)
  }))
  const hasActiveRun = hasActiveSessionRunForSession(sessionId)
  const dispatchPaused = isPendingSessionDispatchPaused(sessionId)

  const summary =
    messages.length === 0
      ? `Session "${sessionId}" has no queued messages.`
      : `Session "${sessionId}" has ${messages.length} queued message(s).`
  const runState = hasActiveRun ? ' A turn is currently running.' : ' No turn is running.'
  const pausedState = dispatchPaused ? ' Queue dispatch is paused.' : ''
  // Message ids ride along in the text: the C# side only forwards `result`.
  const detailLines = messages.map(
    (message, index) => `[${index + 1}] id=${message.id} text=${JSON.stringify(message.text)}`
  )
  const detail = detailLines.length > 0 ? `\n${detailLines.join('\n')}` : ''

  return {
    success: true,
    sessionId,
    found: true,
    hasActiveRun,
    dispatchPaused,
    count: messages.length,
    messages,
    result: `${summary}${runState}${pausedState}${detail}`
  }
}

export async function handleProjectRemoveSessionQueueMessage(
  params: unknown
): Promise<SessionQueueResult> {
  const { sessionId, messageId } = (params ?? {}) as { sessionId?: string; messageId?: string }
  if (!sessionId || !messageId) {
    return { success: false, error: 'Missing required fields: sessionId, messageId' }
  }
  if (!(await ensureSessionExists(sessionId))) {
    return {
      success: false,
      found: false,
      sessionId,
      error: `Session "${sessionId}" does not exist.`
    }
  }

  const removed = removePendingSessionMessage(sessionId, messageId)
  if (!removed) {
    return {
      success: false,
      sessionId,
      found: true,
      removed: 0,
      error:
        `Queued message "${messageId}" was not found in session "${sessionId}". ` +
        'Call get_session_queue for the current ids.'
    }
  }

  return {
    success: true,
    sessionId,
    found: true,
    removed: 1,
    result:
      `Removed queued message "${messageId}" from session "${sessionId}". ` +
      'The running turn was not affected.'
  }
}

export async function handleProjectClearSessionQueue(params: unknown): Promise<SessionQueueResult> {
  const { sessionId } = (params ?? {}) as { sessionId?: string }
  if (!sessionId) {
    return { success: false, error: 'Missing required field: sessionId' }
  }
  if (!(await ensureSessionExists(sessionId))) {
    return {
      success: false,
      found: false,
      sessionId,
      error: `Session "${sessionId}" does not exist.`
    }
  }

  const cleared = clearPendingSessionMessages(sessionId)
  return {
    success: true,
    sessionId,
    found: true,
    cleared,
    result:
      cleared > 0
        ? `Cleared ${cleared} queued message(s) from session "${sessionId}". ` +
          'The running turn was not affected.'
        : `Session "${sessionId}" had no queued messages.`
  }
}

export async function handleProjectStopSessionRun(params: unknown): Promise<SessionQueueResult> {
  const { sessionId } = (params ?? {}) as { sessionId?: string }
  if (!sessionId) {
    return { success: false, error: 'Missing required field: sessionId' }
  }
  if (!(await ensureSessionExists(sessionId))) {
    return {
      success: false,
      found: false,
      sessionId,
      error: `Session "${sessionId}" does not exist.`
    }
  }

  // Same predicate `cancelStream` itself uses: a session can look "active" (a send is
  // starting, or a status flag is set) without having a cancellable stream, and
  // cancelStream silently returns in that case. Checking anything wider here would
  // report a stop that never happened.
  const runId = useChatStore.getState().streamingMessages[sessionId]
  if (!runId) {
    return {
      success: false,
      sessionId,
      found: true,
      error: `Session "${sessionId}" has no running turn to stop.`
    }
  }

  await useChatStore.getState().cancelStream(sessionId)

  const queued = getPendingSessionMessages(sessionId).length
  return {
    success: true,
    sessionId,
    found: true,
    count: queued,
    result:
      `Stopped the running turn of session "${sessionId}". ` +
      (queued > 0
        ? `${queued} queued message(s) are kept, but their dispatch is now paused — ` +
          'exactly what happens when the user presses stop in the UI. ' +
          'Call resume_session_queue to let them run, or send the session a new message. '
        : 'The queue was empty. ') +
      'You can send the session a new message now.'
  }
}

export async function handleProjectResumeSessionQueue(params: unknown): Promise<SessionQueueResult> {
  const { sessionId } = (params ?? {}) as { sessionId?: string }
  if (!sessionId) {
    return { success: false, error: 'Missing required field: sessionId' }
  }
  if (!(await ensureSessionExists(sessionId))) {
    return {
      success: false,
      found: false,
      sessionId,
      error: `Session "${sessionId}" does not exist.`
    }
  }

  const queued = getPendingSessionMessages(sessionId).length
  const wasPaused = resumePendingSessionDispatch(sessionId)
  // Lifting the pause is the whole job when a turn is running: the turn's own
  // loop-end dispatch used to refuse because the flag was set, and now it won't.
  const hasActiveRun = hasActiveSessionRunForSession(sessionId)

  if (hasActiveRun) {
    return {
      success: true,
      sessionId,
      found: true,
      hasActiveRun: true,
      dispatchPaused: false,
      count: queued,
      result:
        `Queue dispatch for session "${sessionId}" is resumed. ` +
        (queued > 0
          ? `A turn is running now; its ${queued} queued message(s) will be dispatched when it ends.`
          : 'A turn is running now, and nothing was waiting behind it.')
    }
  }

  if (queued === 0) {
    return {
      success: true,
      sessionId,
      found: true,
      hasActiveRun: false,
      dispatchPaused: false,
      count: 0,
      result: wasPaused
        ? `Cleared the paused dispatch flag on session "${sessionId}" — it had no queued messages left.`
        : `Session "${sessionId}" has no queued messages and its dispatch was not paused.`
    }
  }

  const dispatched = dispatchNextQueuedMessageForSession(sessionId)
  return {
    success: true,
    sessionId,
    found: true,
    hasActiveRun: false,
    dispatchPaused: isPendingSessionDispatchPaused(sessionId),
    count: queued,
    result: dispatched
      ? `Resumed session "${sessionId}": dispatching its ${queued} queued message(s) now.`
      : `Session "${sessionId}" is no longer paused, but dispatching its ${queued} queued message(s) ` +
        'could not start right now. Call get_session_queue to check the queue state.'
  }
}
