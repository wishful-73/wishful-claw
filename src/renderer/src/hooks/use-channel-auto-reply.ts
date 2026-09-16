/**
 * Channel Auto-Reply Hook
 *
 * Listens for `plugin:session-task` IPC events from the main process
 * (triggered by incoming channel messages via auto-reply.ts) and:
 *   1. Ensures the session exists in the chat store
 *   2. Builds provider config from channel settings or global default
 *   3. Calls chatStore.sendMessage() to trigger the Agent Loop
 *   4. Sends each completed LLM response segment on message_end
 *   5. Sends any remaining text and releases the channel queue on loop_end
 *
 * This replaces OpenCowork's use-plugin-auto-reply.ts (1512 lines) with a
 * lean implementation that reuses wishful-claw's sendMessage + agent/run pipeline.
 */

import { useEffect } from 'react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { agentStream } from '@renderer/lib/ipc/agent-stream-receiver'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { IPC } from '@renderer/lib/ipc/channels'
import type { AgentStreamEvent } from '../../../shared/agent-stream-protocol'
import type { ChatMessage } from '@renderer/stores/chat-store/types'
import { dbGetSession } from '@renderer/stores/chat-store/db-helpers'
import { normalizeSessionContext } from '@renderer/lib/session-context'
import { buildProviderPayload } from '@renderer/lib/agent/provider-payload'
import {
  isChannelReplyEvent,
  isChannelReplyTextDelta
} from '@renderer/lib/channel/channel-reply-event-policy'
import { resolvePendingChannelShellApproval } from '@renderer/lib/channel/channel-shell-approval'

// ── Types ──

interface SessionTaskPayload {
  sessionId: string
  pluginId: string
  pluginType: string
  chatId: string
  senderId?: string
  senderName?: string
  chatName?: string
  sessionTitle?: string
  content: string
  messageId?: string
  supportsStreaming: boolean
  images?: Array<{ base64: string; mediaType: string }>
  audio?: { fileKey: string; fileName?: string; mediaType?: string; durationMs?: number }
  chatType?: 'p2p' | 'group'
  projectId?: string
  workingFolder?: string
  sshConnectionId?: string | null
  channelTaskId?: string
}

// ── State: track active auto-reply sessions ──

interface SessionCancelPayload {
  sessionId: string
  pluginId: string
  chatId: string
  taskId?: string
}

export interface ExternalChannelReplyResult {
  success: boolean
  error?: string
}

interface ActiveAutoReply {
  pluginId: string
  chatId: string
  messageId: string
  textBuffer: string
  supportsStreaming: boolean
  runId: string | null  // Set after sendMessage generates it
  channelTaskId?: string
  replySendChain: Promise<void>
  sentReplyCount: number
  successfulReplyCount: number
  failedReplyCount: number
  onComplete?: (result: ExternalChannelReplyResult) => void
}

const activeAutoReplies = new Map<string, ActiveAutoReply>()
const pendingChannelCancels = new Set<string>()

/**
 * Register an externally triggered run (e.g. Automation in-session execution)
 * so its streamed reply is forwarded back to the channel chat on loop_end.
 * Uses the same stream-listener pipeline as normal incoming channel messages.
 */
export function registerExternalChannelReply(
  sessionId: string,
  pluginId: string,
  chatId: string,
  onComplete?: (result: ExternalChannelReplyResult) => void
): void {
  activeAutoReplies.set(sessionId, {
    pluginId,
    chatId,
    messageId: '',
    textBuffer: '',
    supportsStreaming: false,
    runId: null,
    replySendChain: Promise.resolve(),
    sentReplyCount: 0,
    successfulReplyCount: 0,
    failedReplyCount: 0,
    onComplete
  })
}

/** Unregister without sending (used when the run fails before starting). */
export function unregisterExternalChannelReply(sessionId: string): void {
  activeAutoReplies.delete(sessionId)
}

/** Whether this session already has a pending channel echo registration. */
export function hasActiveExternalChannelReply(sessionId: string): boolean {
  return activeAutoReplies.has(sessionId)
}

// ── Core: handle a single session task ──

async function handleSessionTask(task: SessionTaskPayload): Promise<boolean> {
  const { sessionId, pluginId, chatId, content } = task

  // A cancel event can overtake task processing while the renderer is busy
  // restoring the session/provider. Consume it before starting a new Agent run.
  if (task.channelTaskId && pendingChannelCancels.delete(task.channelTaskId)) {
    return false
  }

  // A pending channel shell approval consumes this message: the user's 同意/拒绝
  // reply resolves it rather than starting a new run. A non-verdict message falls
  // through to the normal path, so an unrelated message is never swallowed.
  if (resolvePendingChannelShellApproval(sessionId, content)) {
    return false
  }

  // 1. Resolve the channel instance — its binding supplies the provider/model below.
  //    No global auto-reply switch: a configured channel that is running replies. The
  //    per-channel enable flag (the start/stop button) is the real gate.
  const channelMeta = useChannelStore.getState().channels.find((c) => c.id === pluginId)

  // 2. Ensure session exists in chat store
  const chatStore = useChatStore.getState()
  let session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) {
    const storedSession = await dbGetSession(sessionId).catch(() => null)
    const settings = useSettingsStore.getState()
    const context = storedSession
      ? null
      : normalizeSessionContext(
          {
            scope: task.projectId ? 'project' : 'global',
            projectId: task.projectId
          },
          {
            projectCollaborationMode: settings.projectSessionDefaultCollaborationMode,
            coworkPermissionMode: settings.coworkDefaultPermissionMode
          }
        )
    session = storedSession ?? {
      id: sessionId,
      title: task.sessionTitle || task.chatId,
      mode: 'cowork',
      ...context!,
      messages: [],
      messageCount: 0,
      messagesLoaded: true,
      loadedRangeStart: 0,
      loadedRangeEnd: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingFolder: context?.scope === 'project' ? task.workingFolder : undefined,
      sshConnectionId: context?.scope === 'project' ? task.sshConnectionId ?? undefined : undefined,
      pluginId,
      pluginType: task.pluginType,
      externalChatId: chatId,
      pluginChatType: task.chatType,
      pluginSenderId: task.senderId,
      pluginSenderName: task.senderName,
      modelSelectionMode: 'inherit'
    }
    useChatStore.setState((state) => {
      if (!state.sessions.some((candidate) => candidate.id === sessionId)) {
        state.sessions.push(session!)
        state.sessionsById[sessionId] = state.sessions.length - 1
      }
    })
  }

  // 3. Build provider config
  const providerStore = useProviderStore.getState()
  const targetProviderId = channelMeta?.providerId ?? providerStore.activeProviderId
  const targetProvider = targetProviderId
    ? providerStore.providers.find((p) => p.id === targetProviderId)
    : providerStore.getActiveProvider()

  if (!targetProvider) {
    console.error('[ChannelAutoReply] No provider configured')
    await sendChannelNotice(task, 'Model provider not configured. Please configure in Settings.')
    return false
  }

  const modelId = channelMeta?.model || providerStore.activeModelId || targetProvider.defaultModel
  if (!modelId) {
    console.error('[ChannelAutoReply] No model configured')
    await sendChannelNotice(task, 'No model configured. Please select a model in Settings.')
    return false
  }

  // After an app restart the store session exists but its message list is
  // empty — reload it for rendering. The Worker's SessionConversation is
  // rebuilt lazily and synchronously inside agent/run on this send, so no
  // explicit restore call is needed (InitializeIfEmpty guards the race).
  if ((session?.messages.length ?? 0) === 0) {
    await useChatStore.getState().loadRecentSessionMessages(sessionId)
  }

  const settings = useSettingsStore.getState()
  // One builder for the agent/run provider payload; see lib/agent/provider-payload.ts.
  // It derives the thinking flags exactly the way this path used to.
  const provider = buildProviderPayload(targetProvider, modelId, settings)

  // The cancel event may arrive while session/provider setup is awaiting.
  if (task.channelTaskId && pendingChannelCancels.delete(task.channelTaskId)) {
    return false
  }

  // 4. Register this as an active auto-reply (before calling sendMessage)
  //    so the stream listener can pick it up
  activeAutoReplies.set(sessionId, {
    pluginId,
    chatId,
    messageId: task.messageId ?? '',
    textBuffer: '',
    supportsStreaming: task.supportsStreaming,
    runId: null,
    channelTaskId: task.channelTaskId,
    replySendChain: Promise.resolve(),
    sentReplyCount: 0,
    successfulReplyCount: 0,
    failedReplyCount: 0
  })

  // 5. Call sendMessage to trigger the Agent Loop
  //    sendMessage will set streamingMessages[sessionId] = runId
  //    which handleEnvelope uses to route stream events
  //
  //    beginUserTurn runs synchronously inside sendMessage, adding user +
  //    assistant messages to the store before the first await. We split
  //    the call so we can sync messageCount / messagesLoaded right after.
  try {
    const sendPromise = useChatStore.getState().sendMessage({
      provider,
      messages: [{ role: 'user', content }],
      sessionId,
      toolPreset: 'channel',
      workingFolder: session.scope === 'project' ? session.workingFolder : undefined,
      sshConnectionId: session.scope === 'project' ? session.sshConnectionId : undefined,
      projectId: session.scope === 'project' ? session.projectId : undefined,
      scope: session.scope,
      collaborationMode: session.collaborationMode,
      runtimeRole: 'sessionAgent',
      sessionMode: 'channel',
      pluginId,
      pluginType: task.pluginType,
      pluginChatId: chatId,
      pluginChatType: task.chatType,
      pluginSenderId: task.senderId,
      pluginSenderName: task.senderName,
      channelSession: true,
      // Channel input is an external/untrusted entry point. Never inherit
      // fullAccess from the paired global session.
      permissionMode: 'default',
      skipSessionRestore: session.messageCount === 0,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
      personaId: settings.defaultPersonaId ?? undefined,
      language: settings.language,
      userRules: settings.systemPrompt || undefined,
      contextCompressionEnabled: settings.contextCompressionEnabled,
      contextCompressionThreshold: settings.contextCompressionThreshold
    })

    // beginUserTurn has already run synchronously inside sendMessage,
    // adding user + assistant messages to the store. Sync messageCount
    // so loadRecentSessionMessages won't skip loading with knownCount === 0.
    useChatStore.setState((state) => {
      const sess = state.sessions.find((s) => s.id === sessionId)
      if (sess) {
        sess.messageCount = sess.messages.length
        sess.messagesLoaded = true
      }
    })

    const started = await sendPromise
    if (!started) {
      throw new Error('Agent run was not started')
    }
    return true
  } catch (err) {
    activeAutoReplies.delete(sessionId)
    console.error('[ChannelAutoReply] sendMessage failed:', err)
    await sendChannelNotice(task, `Agent error: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// ── Helper: send a notice message back to the channel ──

async function sendChannelNotice(task: SessionTaskPayload, message: string): Promise<void> {
  try {
    await ipcClient.invoke(IPC.PLUGIN_EXEC, {
      pluginId: task.pluginId,
      action: 'sendMessage',
      params: { chatId: task.chatId, content: message }
    })
  } catch (err) {
    console.error('[ChannelAutoReply] Failed to send notice:', err)
  }
}

// ── Helper: send agent reply segments back to the channel ──

function enqueueChannelReply(autoReply: ActiveAutoReply, content: string): void {
  const text = content.trim()
  if (!text) return

  autoReply.sentReplyCount += 1
  autoReply.replySendChain = autoReply.replySendChain.then(async () => {
    try {
      await ipcClient.invoke(IPC.PLUGIN_EXEC, {
        pluginId: autoReply.pluginId,
        action: 'sendMessage',
        params: { chatId: autoReply.chatId, content: text }
      })
      autoReply.successfulReplyCount += 1
      console.log(`[ChannelAutoReply] Reply sent to ${autoReply.chatId} (${text.length} chars)`)
    } catch (err) {
      autoReply.failedReplyCount += 1
      console.error('[ChannelAutoReply] Failed to send reply:', err)
    }
  })
}

function flushAutoReplyText(sessionId: string): void {
  const autoReply = activeAutoReplies.get(sessionId)
  if (!autoReply) return

  const text = autoReply.textBuffer.trim()
  autoReply.textBuffer = ''
  enqueueChannelReply(autoReply, text)
}

async function sendAgentReply(sessionId: string): Promise<void> {
  const autoReply = activeAutoReplies.get(sessionId)
  if (!autoReply) return

  // Flush any text that did not have a preceding message_end event.
  flushAutoReplyText(sessionId)

  // If no streamed segment was observed, fall back to the completed assistant message.
  if (autoReply.sentReplyCount === 0) {
    const store = useChatStore.getState()
    const session = store.sessions.find((s) => s.id === sessionId)
    let finalText = ''
    if (session) {
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i]
        if (msg.role === 'assistant' && !msg.isStreaming) {
          finalText = msg.text || extractTextFromContent(msg)
          if (finalText) break
        }
      }
    }
    enqueueChannelReply(autoReply, finalText)
  }

  await autoReply.replySendChain
  activeAutoReplies.delete(sessionId)
  if (autoReply.onComplete) {
    const success = autoReply.successfulReplyCount > 0 && autoReply.failedReplyCount === 0
    autoReply.onComplete({
      success,
      error: success
        ? undefined
        : autoReply.failedReplyCount > 0
          ? 'One or more channel replies failed to send'
          : 'No channel reply content was produced'
    })
  }
  await completeChannelTaskId(autoReply.channelTaskId)
}

function extractTextFromContent(msg: ChatMessage): string {
  if (!msg.content) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text ?? '' : ''))
      .join('')
  }
  return ''
}

async function completeChannelTaskId(taskId?: string): Promise<void> {
  if (!taskId) return
  try {
    await ipcClient.invoke(IPC.PLUGIN_SESSION_TASK_COMPLETE, { taskId })
  } catch (err) {
    console.error('[ChannelAutoReply] Failed to acknowledge channel task:', err)
  }
}

async function completeChannelTask(task: SessionTaskPayload): Promise<void> {
  await completeChannelTaskId(task.channelTaskId)
}

async function processChannelTask(task: SessionTaskPayload): Promise<void> {
  try {
    const started = await handleSessionTask(task)
    if (!started) {
      await completeChannelTask(task)
    }
  } catch (err) {
    console.error('[ChannelAutoReply] Task failed:', err)
    await completeChannelTask(task)
  }
}

async function processChannelCancel(payload: SessionCancelPayload): Promise<void> {
  const autoReply = activeAutoReplies.get(payload.sessionId)
  if (!autoReply) {
    if (payload.taskId) pendingChannelCancels.add(payload.taskId)
    return
  }
  if (autoReply.pluginId !== payload.pluginId || autoReply.chatId !== payload.chatId) {
    return
  }

  if (payload.taskId) pendingChannelCancels.delete(payload.taskId)

  try {
    await useChatStore.getState().cancelStream(payload.sessionId)
  } catch (err) {
    console.error('[ChannelAutoReply] Failed to cancel channel run:', err)
  } finally {
    activeAutoReplies.delete(payload.sessionId)
    await completeChannelTaskId(autoReply.channelTaskId)
  }
}

// ── Hook: mount the listener ──

export function useChannelAutoReply(): void {
  useEffect(() => {
    // Subscribe to all agent stream events to detect loop_end for auto-reply sessions
    const unsubStream = agentStream.subscribeAll(
      (_runId: string, sessionId: string, event: AgentStreamEvent) => {
        const autoReply = activeAutoReplies.get(sessionId)
        if (!autoReply || !isChannelReplyEvent(event)) return

        if (isChannelReplyTextDelta(event)) {
          autoReply.textBuffer += event.text
          return
        }

        switch (event.type) {

          case 'message_end':
            // Incoming channel tasks send each LLM segment immediately. Keep
            // externally registered/manual channel runs on their old final
            // loop_end aggregation behavior.
            if (autoReply.channelTaskId) {
              flushAutoReplyText(sessionId)
            }
            break

          case 'loop_end':
            // Defer to next microtask so handleEnvelope (envelope-level callback)
            // runs first and sets isStreaming=false on the assistant message.
            // subscribeAll fires before envelopeCallbacks in acceptEnvelope.
            queueMicrotask(() => {
              void sendAgentReply(sessionId)
            })
            break

          case 'error':
            if (autoReply.channelTaskId) {
              flushAutoReplyText(sessionId)
            }
            activeAutoReplies.delete(sessionId)
            void autoReply.replySendChain
              .then(() =>
                sendChannelNotice(
                  {
                    pluginId: autoReply.pluginId,
                    chatId: autoReply.chatId,
                    content: '',
                    sessionId,
                    pluginType: '',
                    supportsStreaming: false,
                    messageId: autoReply.messageId
                  } as SessionTaskPayload,
                  `Agent error: ${event.message}`
                )
              )
              .finally(() => {
                autoReply.onComplete?.({ success: false, error: event.message })
                return completeChannelTaskId(autoReply.channelTaskId)
              })
            break
        }
      }
    )

    // Listen for plugin:session-task IPC events
    const unsubTask = ipcClient.on('plugin:session-task', (...args: unknown[]) => {
      const task = args[0] as SessionTaskPayload
      if (!task?.sessionId) return
      console.log(
        `[ChannelAutoReply] Received task: session=${task.sessionId}, ` +
        `plugin=${task.pluginId}, chat=${task.chatId}`
      )
      void processChannelTask(task)
    })

    const unsubCancel = ipcClient.on(IPC.PLUGIN_SESSION_CANCEL, (...args: unknown[]) => {
      const payload = args[0] as SessionCancelPayload
      if (!payload?.sessionId || !payload.pluginId || !payload.chatId) return
      void processChannelCancel(payload)
    })

    return () => {
      unsubStream()
      unsubTask()
      unsubCancel()
    }
  }, [])
}
