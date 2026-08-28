/**
 * Channel Auto-Reply Hook
 *
 * Listens for `plugin:session-task` IPC events from the main process
 * (triggered by incoming channel messages via auto-reply.ts) and:
 *   1. Ensures the session exists in the chat store
 *   2. Builds provider config from channel settings or global default
 *   3. Calls chatStore.sendMessage() to trigger the Agent Loop
 *   4. Monitors stream events for loop_end
 *   5. Sends the agent's reply back to the channel via plugin:exec
 *
 * This replaces OpenCowork's use-plugin-auto-reply.ts (1512 lines) with a
 * lean implementation that reuses wishful-claw's sendMessage + agent/run pipeline.
 */

import { useEffect } from 'react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { agentStream } from '@renderer/lib/ipc/agent-stream-receiver'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore, resolveReasoningEffortForModel } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { IPC } from '@renderer/lib/ipc/channels'
import type { AgentStreamEvent } from '../../../shared/agent-stream-protocol'
import type { ChatMessage } from '@renderer/stores/chat-store/types'
import type { ThinkingConfig } from '../../../shared/types/provider'

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
}

// ── State: track active auto-reply sessions ──

interface ActiveAutoReply {
  pluginId: string
  chatId: string
  messageId: string
  textBuffer: string
  supportsStreaming: boolean
  runId: string | null  // Set after sendMessage generates it
}

const activeAutoReplies = new Map<string, ActiveAutoReply>()

/**
 * Register an externally triggered run (e.g. Automation in-session execution)
 * so its streamed reply is forwarded back to the channel chat on loop_end.
 * Uses the same stream-listener pipeline as normal incoming channel messages.
 */
export function registerExternalChannelReply(
  sessionId: string,
  pluginId: string,
  chatId: string
): void {
  activeAutoReplies.set(sessionId, {
    pluginId,
    chatId,
    messageId: '',
    textBuffer: '',
    supportsStreaming: false,
    runId: null
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

// Per-session task queue: ensure only one auto-reply runs per chat at a time
const taskQueues = new Map<string, SessionTaskPayload[]>()
const sessionRunning = new Set<string>()

function queueTask(task: SessionTaskPayload): void {
  const key = task.sessionId
  if (!taskQueues.has(key)) {
    taskQueues.set(key, [])
  }
  taskQueues.get(key)!.push(task)
  void processQueue(key)
}

async function processQueue(sessionId: string): Promise<void> {
  if (sessionRunning.has(sessionId)) return
  const queue = taskQueues.get(sessionId)
  if (!queue || queue.length === 0) return

  const task = queue.shift()!
  sessionRunning.add(sessionId)
  try {
    await handleSessionTask(task)
  } catch (err) {
    console.error('[ChannelAutoReply] Task failed:', err)
  } finally {
    sessionRunning.delete(sessionId)
    // Process next queued task
    const next = taskQueues.get(sessionId)
    if (next && next.length > 0) {
      void processQueue(sessionId)
    } else {
      taskQueues.delete(sessionId)
    }
  }
}

// ── Core: handle a single session task ──

async function handleSessionTask(task: SessionTaskPayload): Promise<void> {
  const { sessionId, pluginId, chatId, content } = task

  // 1. Check if auto-reply is enabled for this channel
  const channelStore = useChannelStore.getState()
  const channelMeta = channelStore.channels.find((c) => c.id === pluginId)
  const features = channelMeta?.features ?? { autoReply: true, streamingReply: true, autoStart: false }
  if (!features.autoReply) {
    console.log(`[ChannelAutoReply] Auto-reply disabled for ${pluginId}, skipping`)
    return
  }

  // 2. Ensure session exists in chat store
  const chatStore = useChatStore.getState()
  let session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) {
    // Inject the session into the store (it was already created in DB by auto-reply.ts)
    useChatStore.setState((state) => {
      state.sessions.push({
        id: sessionId,
        title: task.sessionTitle || task.chatId,
        mode: 'cowork',
        messages: [],
        messageCount: 0,
        messagesLoaded: true,
        loadedRangeStart: 0,
        loadedRangeEnd: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectId: task.projectId,
        workingFolder: task.workingFolder,
        sshConnectionId: task.sshConnectionId ?? undefined,
        pluginId,
        externalChatId: chatId,
        modelSelectionMode: 'inherit'
      })
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
    return
  }

  const modelId = channelMeta?.model || providerStore.activeModelId || targetProvider.defaultModel
  if (!modelId) {
    console.error('[ChannelAutoReply] No model configured')
    await sendChannelNotice(task, 'No model configured. Please select a model in Settings.')
    return
  }

  // After an app restart the store session exists but its message list is
  // empty — reload it for rendering. The Worker's SessionConversation is
  // rebuilt lazily and synchronously inside agent/run on this send, so no
  // explicit restore call is needed (InitializeIfEmpty guards the race).
  if ((session?.messages.length ?? 0) === 0) {
    await useChatStore.getState().loadRecentSessionMessages(sessionId)
  }

  const settings = useSettingsStore.getState()
  const modelConfig = targetProvider.models.find((m: { id: string; thinkingConfig?: unknown }) => m.id === modelId)
  const thinkingConfig = modelConfig?.thinkingConfig as ThinkingConfig | undefined
  const thinkingEnabled = settings.thinkingEnabled && !!thinkingConfig
  const reasoningEffort = thinkingConfig
    ? resolveReasoningEffortForModel({
        reasoningEffort: settings.reasoningEffort,
        reasoningEffortByModel: settings.reasoningEffortByModel,
        providerId: targetProvider.id,
        modelId,
        thinkingConfig
      })
    : undefined

  const provider = {
    id: targetProvider.id,
    name: targetProvider.name,
    type: targetProvider.type,
    apiKey: targetProvider.apiKey,
    baseUrl: targetProvider.baseUrl,
    model: modelId,
    temperature: settings.temperature ?? undefined,
    maxTokens: settings.maxTokens ?? undefined,
    thinkingEnabled,
    thinkingConfig: thinkingConfig ?? undefined,
    reasoningEffort
  }

  // 4. Register this as an active auto-reply (before calling sendMessage)
  //    so the stream listener can pick it up
  activeAutoReplies.set(sessionId, {
    pluginId,
    chatId,
    messageId: task.messageId ?? '',
    textBuffer: '',
    supportsStreaming: task.supportsStreaming,
    runId: null
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
      toolPreset: task.workingFolder ? 'coding' : 'chat',
      webSearchEnabled: settings.webSearchEnabled,
      workingFolder: task.workingFolder,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxToolCallsPerTurn: settings.maxToolCallsPerTurn,
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

    await sendPromise
  } catch (err) {
    activeAutoReplies.delete(sessionId)
    console.error('[ChannelAutoReply] sendMessage failed:', err)
    await sendChannelNotice(task, `Agent error: ${err instanceof Error ? err.message : String(err)}`)
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

// ── Helper: send agent reply back to channel ──

async function sendAgentReply(sessionId: string): Promise<void> {
  const autoReply = activeAutoReplies.get(sessionId)
  if (!autoReply) return
  activeAutoReplies.delete(sessionId)

  // Get final text from chat store
  const store = useChatStore.getState()
  const session = store.sessions.find((s) => s.id === sessionId)
  if (!session) {
    console.warn('[ChannelAutoReply] Session not found in store:', sessionId)
    return
  }

  // Find the last assistant message with text content
  let finalText = ''
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    if (msg.role === 'assistant' && !msg.isStreaming) {
      finalText = msg.text || extractTextFromContent(msg)
      if (finalText) break
    }
  }

  // Fallback to textBuffer if store didn't have the text
  if (!finalText) {
    finalText = autoReply.textBuffer
  }

  if (!finalText.trim()) {
    console.warn('[ChannelAutoReply] No reply text to send for session:', sessionId)
    return
  }

  try {
    await ipcClient.invoke(IPC.PLUGIN_EXEC, {
      pluginId: autoReply.pluginId,
      action: 'sendMessage',
      params: { chatId: autoReply.chatId, content: finalText }
    })
    console.log(`[ChannelAutoReply] Reply sent to ${autoReply.chatId} (${finalText.length} chars)`)
  } catch (err) {
    console.error('[ChannelAutoReply] Failed to send reply:', err)
  }
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

// ── Hook: mount the listener ──

export function useChannelAutoReply(): void {
  useEffect(() => {
    // Subscribe to all agent stream events to detect loop_end for auto-reply sessions
    const unsubStream = agentStream.subscribeAll(
      (_runId: string, sessionId: string, event: AgentStreamEvent) => {
        const autoReply = activeAutoReplies.get(sessionId)
        if (!autoReply) return

        switch (event.type) {
          case 'text_delta':
            autoReply.textBuffer += event.text
            break

          case 'loop_end':
            // Defer to next microtask so handleEnvelope (envelope-level callback)
            // runs first and sets isStreaming=false on the assistant message.
            // subscribeAll fires before envelopeCallbacks in acceptEnvelope.
            queueMicrotask(() => void sendAgentReply(sessionId))
            break

          case 'error':
            activeAutoReplies.delete(sessionId)
            void sendChannelNotice(
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
      queueTask(task)
    })

    return () => {
      unsubStream()
      unsubTask()
    }
  }, [])
}
