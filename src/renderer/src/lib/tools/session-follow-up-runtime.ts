import { useAgentStore } from '@renderer/stores/agent-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useTaskStore } from '@renderer/stores/task-store'
import { dbGetSession, dbListMessagesByTurns } from '@renderer/stores/chat-store/db-helpers'
import { registerExternalChannelReply, unregisterExternalChannelReply } from '@renderer/hooks/use-channel-auto-reply'
import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import { agentStream } from '@renderer/lib/ipc/agent-stream-receiver'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import type { AgentStreamEvent } from '@shared/agent-stream-protocol'
import { writeLog } from '@renderer/lib/error-logger'
import {
  SESSION_FOLLOW_UP_CANCEL_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_COMPLETE_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_MARK_NOTIFIED_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_RENDERER_READY_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_RESCHEDULE_MSGPACK_CHANNEL
} from '@shared/messagepack/binary-ipc'
import type {
  SessionFollowUpFiredEvent,
  SessionFollowUpMutationResult
} from '@shared/types/session-follow-up'
import { handleProjectSendSessionMessage } from './project-send-message'

const BUSY_RETRY_MS = 30_000
const MAX_RESULT_CHARS = 8_000
let unsubscribe: (() => void) | null = null
interface ActiveFollowUpRun {
  id: string
  terminal: boolean
}

const activeFollowUpsBySession = new Map<string, ActiveFollowUpRun>()

interface UpdateSessionFollowUpParams {
  followUpId: string
  claimToken: string
  sourceSessionId: string
  action: 'complete' | 'reschedule' | 'fail'
  delayMs?: number
  lastQueryResult: string
  error?: string
}

function sourceSessionIsBusy(sessionId: string): boolean {
  const chatState = useChatStore.getState()
  if (chatState.streamingMessages[sessionId]) return true
  return useAgentStore.getState().isSessionActive(sessionId)
}

function messageText(message: { text?: string; content?: unknown; error?: string }): string {
  if (message.text) return message.text
  if (typeof message.content === 'string') return message.content
  if (message.content != null) {
    try {
      return JSON.stringify(message.content)
    } catch {
      return String(message.content)
    }
  }
  return message.error ?? ''
}

async function mutate(
  channel: string,
  payload: Record<string, unknown>
): Promise<SessionFollowUpMutationResult> {
  return invokeMessagePackBinary<SessionFollowUpMutationResult>(channel, payload)
}

async function markNotified(id: string, target: 'desktop' | 'channel'): Promise<void> {
  const result = await mutate(SESSION_FOLLOW_UP_MARK_NOTIFIED_MSGPACK_CHANNEL, { id, target })
  if (!result.success) {
    writeLog('error', `[followUp] failed to mark ${target} notification ${id}: ${result.error ?? 'unknown error'}`)
  }
}

async function rescheduleBusy(event: SessionFollowUpFiredEvent, reason: string): Promise<void> {
  const result = await mutate(SESSION_FOLLOW_UP_RESCHEDULE_MSGPACK_CHANNEL, {
    id: event.followUp.id,
    claimToken: event.claimToken,
    followUpAt: Date.now() + BUSY_RETRY_MS,
    lastQueryResult: reason
  })
  if (!result.success) {
    writeLog('error', `[followUp] failed to reschedule ${event.followUp.id}: ${result.error ?? 'unknown error'}`)
  }
}

async function handleFire(raw: unknown): Promise<void> {
  const event = raw as SessionFollowUpFiredEvent
  const followUp = event?.followUp
  if (!followUp?.id || !event.claimToken) return

  try {
    const sourceSession = await dbGetSession(followUp.source_session_id)
    if (!sourceSession) {
      await mutate(SESSION_FOLLOW_UP_CANCEL_MSGPACK_CHANNEL, { id: followUp.id })
      return
    }
    if (sourceSessionIsBusy(sourceSession.id)) {
      await rescheduleBusy(event, 'Source session is busy; follow-up postponed')
      return
    }

    const targetSession = await dbGetSession(followUp.target_session_id)
    const targetRunning = targetSession ? sourceSessionIsBusy(targetSession.id) : false
    const recent = targetSession
      ? await dbListMessagesByTurns({ sessionId: targetSession.id, turns: 3 })
      : { messages: [], rangeStart: 0, hasMore: false, totalTurns: 0 }
    const recentResult = recent.messages
      .slice(-8)
      .map((message) => `${message.role}: ${messageText(message)}`)
      .join('\n\n')
      .slice(-MAX_RESULT_CHARS)
    const targetStatus = !targetSession ? 'not_found' : targetRunning ? 'running' : 'idle_or_completed'
    const prompt = [
      '<session_follow_up>',
      `follow_up_id: ${followUp.id}`,
      `claim_token: ${event.claimToken}`,
      `todo_id: ${followUp.todo_id}`,
      `target_session_id: ${followUp.target_session_id}`,
      `target_status: ${targetStatus}`,
      `query_instruction: ${followUp.query_instruction}`,
      '',
      'Recent target session messages:',
      recentResult || '(no messages)',
      '',
      'Evaluate whether the delegated work is complete. You MUST call update_session_follow_up exactly once:',
      '- complete: when the result is ready; include a concise user-facing summary in lastQueryResult.',
      '- reschedule: when work is still running; choose delayMs (minimum 1000) and do not resend the original task.',
      '- fail: when the target is missing or has a terminal failure.',
      'Do not create a global task or global dispatch for this temporary follow-up.',
      '</session_follow_up>'
    ].join('\n')

    const activeRun: ActiveFollowUpRun = { id: followUp.id, terminal: false }
    activeFollowUpsBySession.set(sourceSession.id, activeRun)
    if (followUp.plugin_id && followUp.plugin_chat_id) {
      registerExternalChannelReply(
        sourceSession.id,
        followUp.plugin_id,
        followUp.plugin_chat_id,
        (result) => {
          if (result.success && activeRun.terminal) {
            void markNotified(followUp.id, 'channel').catch((error) => {
              writeLog('error', `[followUp] failed to record channel notification ${followUp.id}: ${String(error)}`)
            })
          } else if (result.error) {
            writeLog('error', `[followUp] channel reply failed for ${followUp.id}: ${result.error}`)
          }
        }
      )
    }
    const started = await handleProjectSendSessionMessage({
      sessionId: sourceSession.id,
      content: prompt,
      workingFolder: sourceSession.workingFolder,
      projectId: sourceSession.projectId,
      sessionMode: sourceSession.mode
    })
    if (!started.success) {
      activeFollowUpsBySession.delete(sourceSession.id)
      unregisterExternalChannelReply(sourceSession.id)
      await rescheduleBusy(event, started.error || 'Source session could not start follow-up processing')
      return
    }
    writeLog('info', `[followUp] source session ${sourceSession.id} awakened for ${followUp.id}`)
  } catch (error) {
    activeFollowUpsBySession.delete(followUp.source_session_id)
    unregisterExternalChannelReply(followUp.source_session_id)
    writeLog('error', `[followUp] fire failed for ${followUp.id}: ${String(error)}`)
    await rescheduleBusy(event, `Follow-up query failed: ${String(error)}`)
  }
}

export async function handleSessionFollowUpUpdate(
  raw: unknown
): Promise<SessionFollowUpMutationResult> {
  const params = raw as UpdateSessionFollowUpParams
  let channel: string
  const payload: Record<string, unknown> = {
    id: params.followUpId,
    claimToken: params.claimToken,
    sourceSessionId: params.sourceSessionId,
    lastQueryResult: params.lastQueryResult,
    lastError: params.error
  }
  if (params.action === 'reschedule') {
    if (!params.delayMs || params.delayMs < 1000) {
      return { success: false, changed: 0, error: 'delayMs must be at least 1000 for reschedule' }
    }
    payload.followUpAt = Date.now() + params.delayMs
    channel = SESSION_FOLLOW_UP_RESCHEDULE_MSGPACK_CHANNEL
  } else if (params.action === 'complete') {
    channel = SESSION_FOLLOW_UP_COMPLETE_MSGPACK_CHANNEL
  } else if (params.action === 'fail') {
    channel = SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL
  } else {
    return { success: false, changed: 0, error: 'action must be complete, reschedule, or fail' }
  }

  const result = await mutate(channel, payload)
  if (result.success && result.followUp) {
    const activeRun = activeFollowUpsBySession.get(result.followUp.source_session_id)
    if (activeRun?.id === result.followUp.id) {
      activeRun.terminal = params.action !== 'reschedule'
      if (!activeRun.terminal) {
        unregisterExternalChannelReply(result.followUp.source_session_id)
      }
    }
    if (params.action !== 'reschedule') {
      useTaskStore.getState().applySyncedTaskUpdate(result.followUp.todo_id, {
        status: params.action === 'complete' ? 'completed' : 'blocked',
        activeForm: undefined,
        updatedAt: Date.now()
      })
      useChatStore.getState().clearSessionPromptSnapshot(result.followUp.source_session_id)
    }
  }
  return result
}

function handleAgentStream(_runId: string, sessionId: string, event: AgentStreamEvent): void {
  if (event.type !== 'loop_end' && event.type !== 'error') return
  const activeRun = activeFollowUpsBySession.get(sessionId)
  if (!activeRun) return
  activeFollowUpsBySession.delete(sessionId)
  if (event.type === 'error' || !activeRun.terminal) {
    unregisterExternalChannelReply(sessionId)
    return
  }
  void markNotified(activeRun.id, 'desktop').catch((error) => {
    writeLog('error', `[followUp] failed to record desktop notification ${activeRun.id}: ${String(error)}`)
  })
}

export function initializeSessionFollowUpRuntime(): () => void {
  if (unsubscribe) return unsubscribe
  const disposeFire = ipcClient.on('session-follow-up:fire', (raw) => void handleFire(raw))
  const disposeStream = agentStream.subscribeAll(handleAgentStream)
  void invokeMessagePackBinary(SESSION_FOLLOW_UP_RENDERER_READY_MSGPACK_CHANNEL, null).catch((error) => {
    writeLog('error', `[followUp] failed to announce renderer readiness: ${String(error)}`)
  })
  unsubscribe = () => {
    disposeFire()
    disposeStream()
    activeFollowUpsBySession.clear()
    unsubscribe = null
  }
  return unsubscribe
}
