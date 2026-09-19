/**
 * Project Send-Session-Message Handler
 *
 * Handles `project/send-session-message` reverse-request from the native worker.
 * The global session (project manager) sends a message to a target project session
 * via the normal sendMessage pipeline — fully simulating a user action.
 *
 * Before calling sendMessage, ensures the target session exists in the chat store
 * (injected if missing). sendMessage is called fire-and-forget — the target session
 * processes the message asynchronously. Returns immediately after dispatch.
 *
 * Flow:
 *   Worker (send_session_message tool)
 *     → reverse-request "project/send-session-message"
 *     → Main process (rendererMethods)
 *     → Renderer (this handler)
 *     → Ensure session in store → chatStore.sendMessage() → agent/run
 *     → Read target session's reply from store
 *     → Response back to Worker
 */

import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useTaskStore } from '@renderer/stores/task-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { writeLog } from '@renderer/lib/error-logger'
import { buildProviderPayload } from '@renderer/lib/agent/provider-payload'
import {
  hasActiveExternalChannelReply,
  registerExternalChannelReply,
  unregisterExternalChannelReply
} from '@renderer/hooks/use-channel-auto-reply'
import { getPendingSessionMessages } from '@renderer/hooks/use-chat-actions'
import { dbGetSession } from '@renderer/stores/chat-store/db-helpers'
import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import {
  SESSION_FOLLOW_UP_CREATE_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL
} from '@shared/messagepack/binary-ipc'
import type {
  SessionFollowUpMutationResult,
  SessionFollowUpRequest
} from '@shared/types/session-follow-up'

interface SendSessionMessageParams {
  sessionId: string
  content: string
  workingFolder?: string
  projectId?: string
  /**
   * Session mode for the simulated turn. Defaults to 'normal' (project target
   * sessions); 'global' is used when delivering replies back to the global
   * agent's own session so it keeps its identity prompt and global-only tools.
   */
  sessionMode?: 'normal' | 'goal' | 'global'
  followUp?: SessionFollowUpRequest
}

interface SendSessionMessageResult {
  success: boolean
  result?: string
  error?: string
  followUpId?: string
}

export async function handleProjectSendSessionMessage(
  params: unknown
): Promise<SendSessionMessageResult> {
  const { sessionId, content, workingFolder, projectId, sessionMode, followUp } = params as SendSessionMessageParams

  if (!sessionId || !content) {
    return { success: false, error: 'Missing required fields: sessionId, content' }
  }

  // 1. Ensure target session exists in the chat store
  //    (sendMessage's beginUserTurn silently fails if session is not in store)
  const chatStore = useChatStore.getState()
  let targetSession = chatStore.sessions.find((s) => s.id === sessionId)
  if (!targetSession) {
    targetSession = await dbGetSession(sessionId) ?? undefined
    if (!targetSession) {
      return { success: false, error: `Target session "${sessionId}" does not exist.` }
    }
    useChatStore.setState((state) => {
      if (!state.sessions.some((session) => session.id === sessionId)) {
        state.sessions.push(targetSession!)
        state.sessionsById[sessionId] = state.sessions.length - 1
      }
    })
  }

  const effectiveWorkingFolder = targetSession.scope === 'project'
    ? targetSession.workingFolder || workingFolder || ''
    : ''
  const effectiveProjectId = targetSession.scope === 'project'
    ? targetSession.projectId || projectId || ''
    : ''

  let scheduledFollowUpId: string | null = null
  if (followUp) {
    if (
      !followUp.id ||
      !followUp.todoId ||
      !followUp.sourceSessionId ||
      followUp.targetSessionId !== sessionId ||
      !Number.isFinite(followUp.followUpAt) ||
      !followUp.queryInstruction
    ) {
      return { success: false, error: 'Invalid followUp contract.' }
    }
    const sourceSession = await dbGetSession(followUp.sourceSessionId)
    if (!sourceSession) {
      return { success: false, error: `Source session "${followUp.sourceSessionId}" does not exist.` }
    }
    const followUpRequest: SessionFollowUpRequest = {
      ...followUp,
      notificationKey: followUp.notificationKey ?? followUp.id,
      pluginId: sourceSession.pluginId ?? undefined,
      pluginType: sourceSession.pluginType ?? undefined,
      pluginChatId: sourceSession.externalChatId ?? undefined
    }
    const scheduled = await invokeMessagePackBinary<SessionFollowUpMutationResult>(
      SESSION_FOLLOW_UP_CREATE_MSGPACK_CHANNEL,
      followUpRequest
    )
    if (!scheduled.success || !scheduled.followUp) {
      return { success: false, error: scheduled.error || 'Failed to create session follow-up.' }
    }
    scheduledFollowUpId = scheduled.followUp.id
    if (scheduled.changed === 1) {
      useTaskStore.getState().applySyncedTaskUpdate(followUp.todoId, {
        status: 'in_progress',
        updatedAt: Date.now()
      })
      useChatStore.getState().clearSessionPromptSnapshot(followUp.sourceSessionId)
    }
    if (scheduled.changed === 0) {
      return {
        success: true,
        result: `Temporary follow-up "${scheduledFollowUpId}" was already scheduled; the original message was not sent again.`,
        followUpId: scheduledFollowUpId
      }
    }
  }

  const failScheduledFollowUp = async (error: string): Promise<void> => {
    if (!scheduledFollowUpId || !followUp) return
    try {
      const failed = await invokeMessagePackBinary<SessionFollowUpMutationResult>(
        SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL,
        { id: scheduledFollowUpId, sourceSessionId: followUp.sourceSessionId, lastError: error }
      )
      if (failed.success) {
        useTaskStore.getState().applySyncedTaskUpdate(followUp.todoId, {
          status: 'blocked',
          activeForm: undefined,
          updatedAt: Date.now()
        })
        useChatStore.getState().clearSessionPromptSnapshot(followUp.sourceSessionId)
      }
    } catch (followUpError) {
      writeLog('error', `[sendMsg] failed to mark follow-up ${scheduledFollowUpId} failed: ${String(followUpError)}`)
    }
  }

  // 2. Get provider config from store
  const providerStore = useProviderStore.getState()
  const targetProvider = providerStore.getActiveProvider()
  if (!targetProvider) {
    const error = 'No active provider configured. Please configure a provider in Settings.'
    await failScheduledFollowUp(error)
    return { success: false, error }
  }

  const modelId = providerStore.activeModelId || targetProvider.defaultModel
  if (!modelId) {
    const error = 'No model configured. Please select a model in Settings.'
    await failScheduledFollowUp(error)
    return { success: false, error }
  }

  const settings = useSettingsStore.getState()
  const provider = buildProviderPayload(targetProvider, modelId, settings, { thinkingEnabled: false })

  // 3. Channel echo registration — a channel-bound session must echo its reply
  //    back to the external chat no matter what triggered the turn (same rule as
  //    chat-actions and cron-runtime). Without this, a run injected by the worker
  //    (e.g. a dispatch reply delivered back into the global session) produces
  //    assistant messages that never reach the channel.
  //    Guarded by hasActiveExternalChannelReply: session-follow-up registers its
  //    own entry — carrying an onComplete callback — before calling us, and
  //    overwriting it here would silently drop that callback.
  const pluginId = targetSession.pluginId
  const externalChatId = targetSession.externalChatId
  const channelRegisteredHere =
    Boolean(pluginId && externalChatId) && !hasActiveExternalChannelReply(sessionId)
  if (channelRegisteredHere && pluginId && externalChatId) {
    registerExternalChannelReply(sessionId, pluginId, externalChatId)
  }

  // S-58：sendMessage 返回 false 有两种语义 —— 真失败（没 sessionId / agent run 起不来）
  // 与「已受理但排队」（目标会话已有活跃 run，消息进了 _pendingMessages）。返回值只有
  // boolean，这里靠队列变化来区分：入队是同步发生的，sendMessage 返回时队列已经改了。
  const pendingCountBefore = getPendingSessionMessages(sessionId).length

  // 4. Fire-and-forget sendMessage — global session doesn't need to wait for result
  //    The Agent can check back later via get_project_details.
  try {
    writeLog('info', '[sendMsg] sending to session: ' + sessionId + ' content: ' + content)
    const started = await useChatStore.getState().sendMessage({
      sessionMode: sessionMode ?? 'normal',
      provider,
      messages: [{ role: 'user', content }],
      sessionId,
      workingFolder: effectiveWorkingFolder || undefined,
      sshConnectionId: targetSession.scope === 'project' ? targetSession.sshConnectionId ?? undefined : undefined,
      projectId: effectiveProjectId || undefined,
      scope: targetSession.scope,
      collaborationMode: targetSession.collaborationMode,
      runtimeRole: sessionMode === 'goal' ? 'goalRunner' : 'sessionAgent',
      permissionMode: targetSession.permissionMode,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
      personaId: settings.defaultPersonaId ?? undefined,
      language: settings.language,
      userRules: settings.systemPrompt || undefined,
      contextCompressionEnabled: settings.contextCompressionEnabled,
      contextCompressionThreshold: settings.contextCompressionThreshold,
      sandboxEnabled: settings.sandboxEnabled
    })
    if (!started) {
      // S-58：排队不是失败。消息已经受理，当前轮跑完会自动出队 —— 这条分支不能撤渠道
      // 回执注册、也不能把 followUp 标 blocked，那轮还没跑呢。
      const pendingAfter = getPendingSessionMessages(sessionId)
      const queued =
        pendingAfter.some((message) => message.text === content) ||
        pendingAfter.length > pendingCountBefore
      if (queued) {
        return {
          success: true,
          result: scheduledFollowUpId
            ? `Message queued for session "${sessionId}"; it will run after the current turn finishes. Temporary follow-up "${scheduledFollowUpId}" is scheduled.`
            : `Message queued for session "${sessionId}"; it will run after the current turn finishes. Check back later with get_project_details.`,
          followUpId: scheduledFollowUpId ?? undefined
        }
      }

      if (channelRegisteredHere) unregisterExternalChannelReply(sessionId)
      const error = `Failed to start message processing for session "${sessionId}".`
      await failScheduledFollowUp(error)
      return { success: false, error }
    }

    return {
      success: true,
      result: scheduledFollowUpId
        ? `Message sent to session "${sessionId}". Temporary follow-up "${scheduledFollowUpId}" is scheduled.`
        : `Message sent to session "${sessionId}". The target session is now processing. Check back later with get_project_details.`,
      followUpId: scheduledFollowUpId ?? undefined
    }
  } catch (err) {
    if (channelRegisteredHere) unregisterExternalChannelReply(sessionId)
    const msg = err instanceof Error ? err.message : String(err)
    await failScheduledFollowUp(msg)
    return { success: false, error: `Failed to send message: ${msg}` }
  }
}

