import { create } from 'zustand'

import { immer } from 'zustand/middleware/immer'

import type { AgentStreamEnvelope } from '@shared/agent-stream-protocol'
import { installGoalSyncListener, useGoalStore, type GoalRunState } from '@renderer/stores/goal-store'

import { getAgentStreamReceiver } from '@renderer/lib/ipc/agent-stream-receiver'
import { applyLiveCompressionStreamEvent, useLiveCompressionStore } from '@renderer/stores/live-compression-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

import { isChatStreamEvent } from '@renderer/lib/agent/stream-event-adapter'
import { buildChatMessageContent, getRenderedBlockPosition } from '@renderer/lib/agent/chat-message-blocks'
import { accumulateUsageSnapshot } from '@renderer/lib/agent/usage-merge'

import { createSessionSlice, type SessionSlice } from './session-slice'

import { createProjectSlice, type ProjectSlice } from './project-slice'

import { createStreamingSlice, type StreamingSlice } from './streaming-slice'

import type { ChatMessage } from './types'
import { writeLog } from '@renderer/lib/error-logger'

import {
  getCompactSummaryDisplayText,
  isCompactBoundaryMessage,
  isCompactSummaryLikeMessage,
  mergeCompressedMessagesKeepHistory
} from '@renderer/lib/agent/context-compression'
import type { CompressionStatusMeta, ContentBlock, UnifiedMessage } from '@renderer/lib/api/types'

import { dbUpsertMessage, dbUpdateSession, dbDeleteMessage, awaitSessionCreated } from './db-helpers'
import { getCompressionStatus, trackCompressionStatus } from './compression-status-registry'

import { setLastDebugInfo } from '@renderer/lib/debug-store'

import { useSettingsStore } from '@renderer/stores/settings-store'

import { adaptSubAgentEvent } from './adapt-sub-agent-event'

import { useAgentStore } from '@renderer/stores/agent-store'



// Session-scoped agent Todo tools (OpenCowork semantics). When any of these
// completes, the tasks table is the source of truth — refresh the task store.
const NATIVE_TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'])



export type { Session, Project, ChatMessage, SessionMode, SessionScope, CollaborationMode, PermissionMode, CreateSessionOptions, SessionPromptSnapshot, ToolCallInfo, SessionModelSelectionMode } from './types'

export type { SessionSlice } from './session-slice'

export type { ProjectSlice } from './project-slice'

export type { StreamingSlice } from './streaming-slice'



// ─── Agent Actions (sendMessage / cancelStream / handleEnvelope) ───



export interface AgentActions {

  sendMessage: (params: {

    provider: Record<string, unknown>

    messages: Array<{ role: string; content: string | ContentBlock[] | Record<string, unknown> }>

    sessionId?: string

    systemPrompt?: string

    toolPreset?: string
    webSearchEnabled?: boolean
    codegraphEnabled?: boolean

    workingFolder?: string

    maxIterations?: number

    maxParallelTools?: number

    maxConcurrentSubAgents?: number

    personaId?: string

    language?: string

    userRules?: string
    messageCount?: number
    contextCompressionEnabled?: boolean
    contextCompressionThreshold?: number
    sshConnectionId?: string
    permissionMode?: 'default' | 'whitelist' | 'fullAccess'
    nonInteractive?: boolean
    projectId?: string
    scope?: 'global' | 'project'
    collaborationMode?: 'chat' | 'cowork'
    runtimeRole?: 'sessionAgent' | 'goalRunner' | 'subAgent' | 'goalSubAgent' | 'automation'
    enablePlanMode?: boolean
    sessionMode?: 'normal' | 'goal' | 'global'
    memoryRecallMaxNotes?: number
    memoryRecallMaxChars?: number
    memoryRecallMinScore?: number
    memoryRecallGlobalFallback?: boolean
    memoryRecallVisibility?: boolean

  }) => Promise<boolean>

  cancelStream: (targetSessionId?: string) => Promise<void>

  handleEnvelope: (envelope: AgentStreamEnvelope) => void

}



export type ChatStore = SessionSlice & ProjectSlice & StreamingSlice & AgentActions



// ─── rAF-batched streaming delta buffer ───

// Multiple tokens arrive per animation frame; batching them into a single

// set() call reduces Zustand/React re-renders from ~100/s to ≤60/s.

type StreamDelta =

  | { kind: 'text'; sessionId: string; msgId: string; text: string }

  | { kind: 'thinking'; sessionId: string; msgId: string; thinking: string }



const _pendingStreamDeltas: StreamDelta[] = []

let _streamDeltaRafId: number | null = null

// Assigned after useChatStore is created (avoids temporal dead zone).

let _scheduleStreamDeltaFlush: () => void = () => {}



// Use immer middleware so set((state) => { state.x = y }) works

export const useChatStore = create<ChatStore>()(

  immer((...args) => ({

    ...createSessionSlice(...args as Parameters<typeof createSessionSlice>),

    ...createProjectSlice(...args as Parameters<typeof createProjectSlice>),

    ...createStreamingSlice(...args as Parameters<typeof createStreamingSlice>),



    // ─── Agent Actions ───

    sendMessage: async (params) => {

      const get = args[1] as () => ChatStore

      const set = args[0] as (fn: (state: ChatStore) => void) => void

      const state = get()

      const sessionId = params.sessionId ?? state.activeSessionId

      if (!sessionId) return false



      const lastMsgContent = params.messages[params.messages.length - 1]?.content

      const userContent = lastMsgContent
      const userText = typeof userContent === 'string'
        ? userContent
        : Array.isArray(userContent)
          ? userContent
              .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text)
              .join('\n')
          : ''

      const now = Date.now()

      // Generate runId on the renderer side so we can set streamingMessages

      // BEFORE awaiting the agent/run response. This prevents a race condition

      // where stream events (including loop_end) arrive before streamingMessages

      // is populated, causing handleEnvelope to skip processing and leaving

      // isStreaming stuck forever.

      const runId = `wc-agent-${now}-${Math.random().toString(36).slice(2, 8)}`

      const userMessage: ChatMessage = {

        id: `user_${now}`,

        role: 'user',

        text: userText,

        ...(Array.isArray(userContent) ? { content: userContent as unknown as ContentBlock[] } : {}),

        createdAt: now

      }

      const assistantMessage: ChatMessage = {

        id: runId,

        role: 'assistant',

        text: '',

        thinking: '',

        isStreaming: true,

        createdAt: now

      }

      writeLog('info', '[sendMessage] userText: ' + userText + ' sessionId: ' + sessionId + ' runId: ' + runId)



      // Add messages to session

      state.beginUserTurn(sessionId, userMessage, assistantMessage, assistantMessage.id)
      const _afterTurn = get().sessions.find((s) => s.id === sessionId)
      writeLog('info', '[sendMessage] after beginUserTurn: sessionExists=' + (!!_afterTurn) + ' msgCount=' + (_afterTurn?.messages?.length ?? -1) + ' lastMsgId=' + (_afterTurn?.messages?.[_afterTurn.messages.length - 1]?.id ?? 'none'))



      // Persist user message to DB (fire-and-forget)

      // Use the message's index in the session as sortOrder for correct ordering

      const _sessForUserSort = get().sessions.find((s) => s.id === sessionId)

      const _userSortOrder = _sessForUserSort ? _sessForUserSort.messages.findIndex((m) => m.id === userMessage.id) : 0

      void dbUpsertMessage(sessionId, userMessage, Math.max(0, _userSortOrder))
      writeLog('info', '[sendMessage] dbUpsertMessage called for sessionId: ' + sessionId + ' msgId: ' + userMessage.id)



      // Set streamingMessages BEFORE the await so handleEnvelope can process

      // events that arrive while we're waiting for the agent/run response.

      state.setStreamingMessageId(sessionId, runId)



      // Reset agentStore live session — clear leftover tool calls from previous runs

      // and set this session as the active live session for tool call tracking

      const agentStore = useAgentStore.getState()

      agentStore.resetLiveSessionExecution(sessionId)

      agentStore.switchToolCallSession(null, sessionId)



      // Auto-generate title from first user message

      const titleSession = get().sessions.find((s) => s.id === sessionId)

      if (titleSession && titleSession.title === 'New Conversation' && userText) {

        const cleanUserText = userText.replace(/<system-remind(?:er)?>[\s\S]*?<\/system-remind(?:er)?>\s*/gi, '').trim()

        const newTitle = cleanUserText.slice(0, 40) + (cleanUserText.length > 40 ? '...' : '')

        const titleNow = Date.now()

        set((state) => {

          const sess = state.sessions.find((s) => s.id === sessionId)

          if (sess) {

            sess.title = newTitle

            sess.updatedAt = titleNow

          }

        })

        // Ensure the session row exists in DB before updating (createSession's

        // dbCreateSession is fire-and-forget; the worker processes requests

        // concurrently, so db/sessions-update could arrive before db/sessions-create)

        await awaitSessionCreated(sessionId)

        await dbUpdateSession(sessionId, { title: newTitle, updatedAt: titleNow })

      }



      try {

        // Pass runId to the worker so it uses ours instead of generating one.
        // Recall tuning rides along from settings (caller params take precedence).

        const recallSettings = useSettingsStore.getState()

        const result = await window.api.workerRequest<{ started: boolean; runId: string }>(

          'agent/run',

          {
            ...params,
            runId,
            memoryRecallMaxNotes: params.memoryRecallMaxNotes ?? recallSettings.memoryRecallMaxNotes,
            memoryRecallMaxChars: params.memoryRecallMaxChars ?? recallSettings.memoryRecallMaxChars,
            memoryRecallMinScore: params.memoryRecallMinScore ?? recallSettings.memoryRecallMinScore,
            memoryRecallGlobalFallback: params.memoryRecallGlobalFallback ?? recallSettings.memoryRecallGlobalFallback,
            memoryRecallVisibility: params.memoryRecallVisibility ?? recallSettings.memoryRecallVisibility
          }

        )

        if (!result.started) {

          // Worker rejected the run - clear streaming state

          state.setStreamingMessageId(sessionId, null)

          useAgentStore.getState().resetLiveSessionExecution(sessionId)
          useAgentStore.getState().setSessionStatus(sessionId, null)

          state.updateMessage(sessionId, runId, {

            isStreaming: false,

            // The Worker serializes rejections as result.error (the top-level
            // error field is empty here), so surface the real reason. Kept
            // local to this branch on purpose — many other callers rely on
            // result.error being resolved instead of thrown.
            error: (result as { error?: string }).error || 'Agent run was not started'

          })

          return false

        }

        return true

      } catch (err) {

        state.setStreamingMessageId(sessionId, null)

        useAgentStore.getState().resetLiveSessionExecution(sessionId)
        useAgentStore.getState().setSessionStatus(sessionId, null)

        state.updateMessage(sessionId, runId, {

          isStreaming: false,

          error: err instanceof Error ? err.message : String(err)

        })

        return false

      }

    },



    cancelStream: async (targetSessionId?: string) => {

      const get = args[1] as () => ChatStore

      const state = get()

      // RC-2: allow cancelling a specific session's stream; default to the
      // active session so existing callers are unaffected.
      const sessionId = targetSessionId ?? state.activeSessionId
      const runId = sessionId ? state.streamingMessages[sessionId] : null

      if (!runId) return

      if (sessionId) {
        try {
          const { pausePendingSessionDispatch } = await import('@renderer/hooks/use-chat-actions')
          pausePendingSessionDispatch(sessionId)
        } catch (err) {
          console.warn('[chat-store] Failed to pause queued messages before cancel:', err)
        }
      }

      try {

        await window.api.workerRequest('agent/cancel', { runId })

      } catch {

        // ignore

      }



      if (sessionId) {

        useAgentStore.getState().setSessionRequestRetryState(sessionId, null)
        useAgentStore.getState().setSessionStatus(sessionId, null)

        state.setStreamingMessageId(sessionId, null)

        // Clear agentStore tool calls for this session

        useAgentStore.getState().resetLiveSessionExecution(sessionId)

      }



      // Mark streaming messages as no longer streaming and persist to DB

      const session = state.sessions.find((s) => s.id === sessionId)

      if (session) {

        for (const msg of session.messages) {

          if (msg.isStreaming) {

            const hasContent = Boolean(

              msg.text ||

              msg.thinking ||

              msg.error ||

              (msg.toolCalls && msg.toolCalls.length > 0) ||

              (msg.segments && msg.segments.length > 0)

            )



            if (hasContent) {

              state.updateMessage(sessionId!, msg.id, {

                isStreaming: false

              })



              // Persist the cancelled message so it survives session reload

              const sortOrder = session.messages.indexOf(msg)

              void dbUpsertMessage(sessionId!, msg, sortOrder)

            } else {

              // Cancelled before any content arrived — drop the empty message

              // instead of rendering a [cancelled] placeholder

              state.removeMessageById(sessionId!, msg.id)

              void dbDeleteMessage(sessionId!, msg.id)

            }

          }

        }

      }

    },



    handleEnvelope: (envelope) => {

      const set = args[0] as typeof args[0]

      const get = args[1] as () => ChatStore

      const state = get()



      // RC-1: the envelope carries its sessionId from the worker — trust it
      // first. The streamingMessages reverse lookup is only a fallback for
      // envelopes whose sessionId is missing (e.g. older protocol), because
      // the lookup drops events for sessions that aren't currently streaming
      // (background sub-agent completions after a reload, etc.).
      let targetSessionId: string | null = (envelope.sessionId ?? '').trim() || null

      if (!targetSessionId) {
        for (const [sid, msgId] of Object.entries(state.streamingMessages)) {
          if (msgId === envelope.runId) {
            targetSessionId = sid
            break
          }
        }
      }

      for (const event of envelope.events) {

        const eventType = (event as { type?: string }).type ?? ''

        // Route goal_progress events to the goal store BEFORE the targetSessionId check
        // because goal_progress events carry their own sessionId in the payload
        // (emitted by GoalOrchestrator with a custom runId, not matching any streaming message).
        if (eventType === 'goal_progress') {
          const gp = event as { goalId?: string; sessionId?: string; objective?: string; eventType?: string; message?: string; status?: string; currentPlanIndex?: number; planCount?: number; completedPlans?: number; timestamp?: number; input?: Record<string, unknown> }
          // All fields are inside the Input JSON (written by EmitGoalEventAsync),
          // not top-level fields of the stream event
          const input = (gp.input ?? {}) as Record<string, unknown>
          const gpSessionId = (gp.sessionId ?? input.sessionId ?? targetSessionId) as string | undefined
          const gpEventType = (gp.eventType ?? input.eventType) as string | undefined
          if (gpSessionId && gpEventType) {
            useGoalStore.getState().applyGoalProgress({
              sessionId: gpSessionId,
              goalId: (gp.goalId ?? input.goalId) as string ?? '',
              objective: (gp.objective ?? input.objective) as string ?? '',
              eventType: gpEventType,
              message: (gp.message ?? input.message) as string ?? '',
              status: (gp.status ?? input.status) as string ?? '',
              runState: (input.runState) as GoalRunState | undefined,
              currentPlanIndex: (gp.currentPlanIndex ?? input.currentPlanIndex) as number ?? 0,
              planCount: (gp.planCount ?? input.planCount) as number ?? 0,
              completedPlans: (gp.completedPlans ?? input.completedPlans) as number ?? 0,
              timestamp: (gp.timestamp ?? input.timestamp) as number ?? Date.now()
            })
          }
          continue
        }

        // goal_activity push events are retired (background-first redesign):
        // the goal panel is a pull-based checker that polls the DB, so the
        // per-tool-call live feed no longer has a consumer.

      if (!targetSessionId) return

        if (
          eventType === 'context_compression_started' ||
          eventType === 'context_compression_start' ||
          eventType === 'context_compression_delta' ||
          eventType === 'context_compressed'
        ) {
          const compressionEvent = event as {
            type:
              | 'context_compression_started'
              | 'context_compression_start'
              | 'context_compression_delta'
              | 'context_compressed'
            operationId?: string
            text?: string
            originalCount?: number
            newCount?: number
            keptMessageCount?: number
            trigger?: 'auto' | 'manual'
            preTokens?: number
            estimatedNewTokens?: number
            compressionStatus?: 'compressed' | 'skipped' | 'failed' | 'blocked' | 'cancelled'
            summarizerFailed?: boolean
            messagesSummarized?: number
            error?: string
            compactArtifacts?: UnifiedMessage[]
            displayAnchor?: NonNullable<CompressionStatusMeta['displayAnchor']>
          }
          const now = Date.now()
          if (compressionEvent.type === 'context_compression_delta') {
            applyLiveCompressionStreamEvent(targetSessionId, compressionEvent)
            continue
          }
          const isStarted =
            compressionEvent.type === 'context_compression_started' ||
            compressionEvent.type === 'context_compression_start'
          const operationId =
            compressionEvent.operationId ??
            `${envelope.runId}:compression:${compressionEvent.originalCount ?? 'unknown'}`
          const summaryArtifact = compressionEvent.compactArtifacts?.find((artifact) =>
            isCompactSummaryLikeMessage(artifact)
          )
          const summaryText = summaryArtifact
            ? getCompactSummaryDisplayText(summaryArtifact).trim()
            : undefined
          const sessionForCompression = state.sessions.find((session) => session.id === targetSessionId)
          const activeAssistantForCompression = sessionForCompression?.messages.find(
            (message) => message.id === envelope.runId && message.role === 'assistant'
          )
          const isInlineCompression = Boolean(
            activeAssistantForCompression &&
              (compressionEvent.trigger === 'auto' ||
                state.streamingMessages[targetSessionId] === envelope.runId)
          )
          const compressionDisplayAnchor =
            isStarted && isInlineCompression && activeAssistantForCompression
              ? buildCompressionDisplayAnchor(activeAssistantForCompression)
              : undefined
          if (isStarted) {
            applyLiveCompressionStreamEvent(targetSessionId, {
              ...compressionEvent,
              operationId,
              trigger: compressionEvent.trigger,
              displayAnchor: compressionDisplayAnchor
            })
          }
          updateCompressionStatus(
            targetSessionId,
            {
              operationId,
              state: isStarted
                ? 'compressing'
                : (compressionEvent.compressionStatus ?? 'compressed'),
              startedAt: now,
              ...(isStarted ? {} : { completedAt: now }),
              ...(compressionEvent.originalCount !== undefined
                ? { originalCount: compressionEvent.originalCount }
                : {}),
              ...(compressionEvent.keptMessageCount !== undefined
                ? { keptMessageCount: compressionEvent.keptMessageCount }
                : {}),
              ...(compressionEvent.newCount !== undefined
                ? { newCount: compressionEvent.newCount }
                : {}),
              ...(compressionEvent.preTokens !== undefined
                ? { preTokens: compressionEvent.preTokens }
                : {}),
              ...(compressionEvent.trigger ? { trigger: compressionEvent.trigger } : {}),
              ...(compressionEvent.messagesSummarized !== undefined
                ? { messagesSummarized: compressionEvent.messagesSummarized }
                : {}),
              ...(compressionEvent.summarizerFailed ? { summarizerFailed: true } : {}),
              ...(compressionEvent.error ? { error: compressionEvent.error } : {}),
              ...(summaryText ? { summaryText } : {}),
              ...(summaryArtifact ? { summaryMessageId: summaryArtifact.id } : {}),
              ...(compressionDisplayAnchor ? { displayAnchor: compressionDisplayAnchor } : {})
            },
            operationId
          )
          // The completion event carries the boundary + summary artifact pair —
          // merge it into the transcript so the chat window keeps the full
          // history and the independent boundary divider.
          if (!isStarted && compressionEvent.compactArtifacts?.length) {
            applyCompactArtifactsToSession(targetSessionId, compressionEvent.compactArtifacts, operationId)
          }
          if (!isStarted) {
            applyLiveCompressionStreamEvent(targetSessionId, {
              ...compressionEvent,
              operationId,
              trigger: compressionEvent.trigger,
              displayAnchor: compressionDisplayAnchor
            })
          }
          if (
            !isStarted &&
            compressionEvent.compressionStatus === 'compressed' &&
            typeof compressionEvent.estimatedNewTokens === 'number'
          ) {
            updateSessionContextTokens(targetSessionId, compressionEvent.estimatedNewTokens)
          }
          continue
        }

        // Route sub-agent events to the agent store's sub-agent handler

        if (eventType.startsWith('sub_agent_')) {

          const subEvent = adaptSubAgentEvent(event)

          if (subEvent) {

            useAgentStore.getState().handleSubAgentEvent(subEvent, targetSessionId)

          }

          continue

        }



        if (!isChatStreamEvent(event)) continue



        // Only clear retry state on events that prove the request succeeded:

        // thinking_delta, text_delta, tool_use_streaming_start, tool_call_start.

        // NOT on request_debug (emitted before each retry attempt),

        // iteration_start, message_end, etc. — those can occur during retry

        // sequences and would cause the banner to flicker.

        if (

          event.type === 'thinking_delta' ||

          event.type === 'text_delta' ||

          event.type === 'tool_use_streaming_start' ||

          event.type === 'tool_call_start'

        ) {

          useAgentStore.getState().setSessionRequestRetryState(targetSessionId, null)

        }



        switch (event.type) {

          case 'text_delta': {

            // Queue delta for rAF batch flush instead of immediate set()

            _pendingStreamDeltas.push({

              kind: 'text',

              sessionId: targetSessionId,

              msgId: envelope.runId,

              text: event.text

            })

            _scheduleStreamDeltaFlush()

            break

          }



          case 'iteration_start':

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  msg.currentIteration = event.iteration

                  if (!msg.segments) msg.segments = []

                }

              }

            })

            break



        case 'thinking_delta':

            // Queue delta for rAF batch flush instead of immediate set()

            _pendingStreamDeltas.push({

              kind: 'thinking',

              sessionId: targetSessionId,

              msgId: envelope.runId,

              thinking: event.thinking

            })

            _scheduleStreamDeltaFlush()

            break



          // message_end = one LLM turn finished, but the loop may continue

          // (tool calls → next iteration). Do NOT set isStreaming=false here.

          // Only persist the message and store usage/timing.

          case 'message_end':

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  const completedAt = Date.now()
                  let completedThinking = false
                  const nextSegments = msg.segments?.map((seg) => {
                    if (!completedThinking && seg.type === 'thinking' && !seg.completedAt) {
                      completedThinking = true
                      return { ...seg, completedAt }
                    }
                    return seg
                  })
                  const nextMessage = {
                    ...msg,
                    usage: accumulateUsageSnapshot(msg.usage, event.usage),
                    timing: event.timing,
                    ...(nextSegments ? { segments: nextSegments } : {})
                  }
                  const sessionIndex = state.sessions.indexOf(session)
                  const nextSession = {
                    ...session,
                    messages: session.messages.map((candidate) =>
                      candidate.id === msg.id ? nextMessage : candidate
                    )
                  }

                  // Store session-cumulative cache counters from backend
                  if (event.usage?.sessionCacheHitTokens != null) {
                    nextSession.sessionCacheHit = event.usage.sessionCacheHitTokens
                  }
                  if (event.usage?.sessionCacheMissTokens != null) {
                    nextSession.sessionCacheMiss = event.usage.sessionCacheMissTokens
                  }

                  // isStreaming stays true — loop_end will set it false
                  if (sessionIndex >= 0) {
                    const nextSessions = [...state.sessions]
                    nextSessions[sessionIndex] = nextSession
                    state.sessions = nextSessions
                  }

                }

              }

            })

            // Persist assistant message to DB

            {

              const sess = get().sessions.find((s) => s.id === targetSessionId)

              const msg = sess?.messages.find((m) => m.id === envelope.runId)

              if (msg) {

                const sortOrder = sess ? sess.messages.indexOf(msg) : 0

                void dbUpsertMessage(targetSessionId, msg, sortOrder)

              }

            }

            break



          case 'text_phase': {

            // Mark the current assistant message as 'pre-tool' phase.

            // The text was generated before tool execution — it's planning/intent,

            // not final conclusions. UI will render it with visual distinction.

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  msg.preToolPhase = true

                }

              }

            })

            break

          }



          case 'iteration_end': {

            // One iteration of the agent loop finished (e.g., after tool calls).

            // In wishful-claw, tool calls and results live in the same assistant message's

            // toolCalls array — no need to insert separate tool_result user messages.

            // The next iteration's thinking_delta will start a new thinking paragraph

            // naturally since it appends to the same message.

            break

          }



          case 'thinking_encrypted': {

            // Encrypted thinking content — store as a marker on the message.

            // Currently we don't decrypt, just note its presence.

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  msg.thinkingEncrypted = true

                }

              }

            })

            break

          }



          case 'tool_use_streaming_start': {

            // Tool use is being streamed by the LLM \u2014 show card with 'streaming' status

            useAgentStore.getState().addToolCall({

              id: event.toolCallId,

              name: event.toolName,

              input: {},

              status: 'streaming',

              requiresApproval: false,

            }, targetSessionId)

            // Also add a placeholder toolCall to ChatMessage so it renders as a tool_use block

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  if (!msg.toolCalls) msg.toolCalls = []

                  if (!msg.toolCalls.find((t) => t.id === event.toolCallId)) {

                    msg.toolCalls.push({

                      id: event.toolCallId,

                      name: event.toolName,

                      input: {},

                      status: 'running'

                    })

                  }

                  // Add to segments for temporal ordering

                  if (!msg.segments) msg.segments = []

                  if (!msg.currentIteration) msg.currentIteration = 1

                  // Mark the last thinking segment as completed when tool use starts

                  const lastSegForTool = msg.segments[msg.segments.length - 1]

                  if (lastSegForTool && lastSegForTool.type === 'thinking' && !lastSegForTool.completedAt) {

                    lastSegForTool.completedAt = Date.now()

                  }

                  if (!msg.segments.find((s) => s.type === 'tool_use' && s.toolCallId === event.toolCallId)) {

                    msg.segments.push({

                      type: 'tool_use',

                      iteration: msg.currentIteration,

                      toolCallId: event.toolCallId,

                      toolName: event.toolName,

                      input: {},

                      status: 'running'

                    })

                  }

                }

              }

            })

            break

          }



          case 'tool_use_args_delta': {

            // Ignore partial args — wait for tool_use_generated with full input.

            // Per-delta updates cause excessive re-renders and visual flicker

            // when multiple tools stream concurrently.

            break

          }



          case 'tool_use_generated': {

            // LLM finished emitting tool args \u2014 update with full input, switch to 'running'

            const tuBlock = event.toolUseBlock

            if (tuBlock) {

              useAgentStore.getState().updateToolCall(tuBlock.id, {

                name: tuBlock.name,

                input: tuBlock.input ?? {},

                status: 'running',

                startedAt: Date.now(),

              }, targetSessionId)

              // Update ChatMessage toolCalls and segments too

              set((state) => {

                const session = state.sessions.find((s) => s.id === targetSessionId)

                if (session) {

                  const msg = session.messages.find((m) => m.id === envelope.runId)

                  if (msg) {

                    if (msg.toolCalls) {

                      const tc = msg.toolCalls.find((t) => t.id === tuBlock.id)

                      if (tc) {

                        tc.input = tuBlock.input ?? {}

                        tc.status = 'running'

                      }

                    }

                    if (msg.segments) {

                      const seg = msg.segments.find((s) => s.type === 'tool_use' && s.toolCallId === tuBlock.id)

                      if (seg) {

                        seg.input = tuBlock.input ?? {}

                        seg.status = 'running'

                        seg.startedAt = Date.now()

                      }

                    }

                  }

                }

              })

            }

            break

          }



          case 'tool_call_start': {

            // Worker started executing the tool

            useAgentStore.getState().addToolCall({

              ...event.toolCall,

              status: 'running',

              requiresApproval: false

            }, targetSessionId)

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  if (!msg.toolCalls) msg.toolCalls = []

                  // Update existing or add new

                  const existing = msg.toolCalls.find((t) => t.id === event.toolCall.id)

                  if (existing) {

                    // use_capability proxy: streaming_start arrived with the raw
                    // LLM tool name; tool_call_start carries the rewritten real
                    // tool name, so keep it in sync.
                    existing.name = event.toolCall.name

                    existing.input = event.toolCall.input

                    existing.status = 'running'

                    existing.startedAt = event.toolCall.startedAt

                  } else {

                    msg.toolCalls.push({

                      id: event.toolCall.id,

                      name: event.toolCall.name,

                      input: event.toolCall.input,

                      status: 'running',

                      startedAt: event.toolCall.startedAt

                    })

                  }

                  // Update segments

                  if (!msg.segments) msg.segments = []

                  if (!msg.currentIteration) msg.currentIteration = 1

                  const seg = msg.segments.find((s) => s.type === 'tool_use' && s.toolCallId === event.toolCall.id)

                  if (seg) {

                    // Keep display name in sync (use_capability proxy rewrite)
                    seg.toolName = event.toolCall.name

                    seg.input = event.toolCall.input

                    seg.status = 'running'

                    seg.startedAt = event.toolCall.startedAt

                  } else {

                    msg.segments.push({

                      type: 'tool_use',

                      iteration: msg.currentIteration,

                      toolCallId: event.toolCall.id,

                      toolName: event.toolCall.name,

                      input: event.toolCall.input,

                      status: 'running',

                      startedAt: event.toolCall.startedAt

                    })

                  }

                }

              }

            })

            break

          }



          case 'tool_call_result': {

            const resultStatus = event.toolCall.status === 'error' ? 'error' : 'completed'

            useAgentStore.getState().updateToolCall(event.toolCall.id, {

              status: resultStatus,

              output: event.toolCall.output,

              error: event.toolCall.error,

              completedAt: event.toolCall.completedAt

            }, targetSessionId)

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  if (msg.toolCalls) {

                    const tc = msg.toolCalls.find((t) => t.id === event.toolCall.id)

                    if (tc) {

                      tc.status = resultStatus

                      tc.output = event.toolCall.output

                      tc.error = event.toolCall.error

                      tc.completedAt = event.toolCall.completedAt

                    }

                  }

                  if (msg.segments) {

                    const seg = msg.segments.find((s) => s.type === 'tool_use' && s.toolCallId === event.toolCall.id)

                    if (seg) {

                      seg.status = resultStatus

                      seg.output = event.toolCall.output

                      seg.error = event.toolCall.error

                      seg.completedAt = event.toolCall.completedAt

                    }

                  }

                }

              }

            })

            // Persist immediately at the tool-completion boundary so finished
            // results (success/error/cancelled/approval-rejected/skipped all
            // flow through tool_call_result) survive a Renderer/Worker crash
            // before the message_end/loop_end flush. Upsert keyed by the stable
            // message id (runId) keeps duplicate events and concurrent tools
            // idempotent — later writes carry the superset of earlier results.

            {

              const sess = get().sessions.find((s) => s.id === targetSessionId)

              const msg = sess?.messages.find((m) => m.id === envelope.runId)

              if (msg) {

                const sortOrder = sess ? sess.messages.indexOf(msg) : 0

                void dbUpsertMessage(targetSessionId, msg, sortOrder)

              }

            }

            // Refresh the session-scoped task store from DB when a task tool
            // finishes (foreground session only — background sessions keep
            // their cache and avoid stealing the visible task list).
            if (
              resultStatus === 'completed' &&
              NATIVE_TASK_TOOL_NAMES.has(event.toolCall.name) &&
              get().activeSessionId === targetSessionId
            ) {
              void import('@renderer/stores/task-store')
                .then(({ useTaskStore }) => {
                  void useTaskStore.getState().loadTasksForSession(targetSessionId)
                })
                .catch((err) => {
                  console.warn('[chat-store] Failed to refresh session tasks:', err)
                })
              get().clearSessionPromptSnapshot(targetSessionId)
            }

            break

          }



          // loop_end = entire agent loop finished, now we can stop streaming

          case 'loop_end':

            // Request completed successfully — clear retry state

            useAgentStore.getState().setSessionRequestRetryState(targetSessionId, null)
            useAgentStore.getState().setSessionStatus(targetSessionId, null)

            // Terminal fallback for the live compression card: compression is
            // awaited inside the loop, so by loop_end it either finished
            // (context_compressed already cleared it) or was aborted without a
            // completion event — dropping it here prevents a permanently stuck
            // card above the input area.
            useLiveCompressionStore.getState().clear(targetSessionId)

            // Flush any pending stream deltas before clearing streaming state

            flushPendingStreamDeltas()

            // Move any remaining pending tool calls to executed in agentStore

            {

              const agentState = useAgentStore.getState()

              for (const tc of agentState.pendingToolCalls) {

                agentState.updateToolCall(tc.id, { status: 'completed' }, targetSessionId)

              }

            }

            set((state) => {

              delete state.streamingMessages[targetSessionId]

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                for (const msg of session.messages) {

                  if (msg.isStreaming) {

                    msg.isStreaming = false

                  }

                }

              }

            })

            // Final persist after loop ends

            {

              const sess = get().sessions.find((s) => s.id === targetSessionId)

              const msg = sess?.messages.find((m) => m.id === envelope.runId)

              if (msg) {

                const sortOrder = sess ? sess.messages.indexOf(msg) : 0

                void dbUpsertMessage(targetSessionId, msg, sortOrder)

              }

            }

            // Desktop notification: only if the window is NOT focused
            // (user is away from the app). Skip if user is actively chatting.
            if (!document.hasFocus() && document.visibilityState !== 'visible') {
              const sess = get().sessions.find((s) => s.id === targetSessionId)
              let notifyBody = '工作已完成。'
              if (sess) {
                for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
                  const m = sess.messages[i]
                  if (m.role === 'assistant' && m.content) {
                    const text = typeof m.content === 'string'
                      ? m.content
                      : Array.isArray(m.content)
                        ? m.content
                            .filter((b) => b.type === 'text')
                            .map((b) => ('text' in b ? b.text ?? '' : ''))
                            .join('')
                        : ''
                    const trimmed = text.trim()
                    if (trimmed) {
                      notifyBody = trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed
                      break
                    }
                  }
                }
              }
              const reason = event.reason ?? 'completed'
              const notifyTitle = reason === 'completed' ? '任务完成'
                : reason === 'max_iterations' ? '达到迭代上限'
                : reason === 'aborted' ? '任务已中断'
                : reason === 'error' ? '任务出错'
                : `任务停止: ${reason}`
              void ipcClient.invoke('notification:show', {
                title: notifyTitle,
                body: notifyBody,
                type: reason === 'completed' ? 'success' : 'info'
              }).catch(() => {
                // Notification failure is non-critical
              })
            }

            if (event.reason === 'aborted' || event.reason === 'error') {
              void import('@renderer/hooks/use-chat-actions')
                .then(({ pausePendingSessionDispatch }) => pausePendingSessionDispatch(targetSessionId))
                .catch((err) => {
                  console.warn('[chat-store] Failed to pause queued messages after interrupted loop:', err)
                })
            } else {
              void import('@renderer/hooks/use-chat-actions')
                .then(({ dispatchNextQueuedMessageForSession }) => {
                  dispatchNextQueuedMessageForSession(targetSessionId, false)
                })
                .catch((err) => {
                  console.warn('[chat-store] Failed to dispatch queued message after loop end:', err)
                })
            }

            break



          case 'request_retry': {

            useAgentStore.getState().setSessionRequestRetryState(targetSessionId, {

              attempt: event.attempt,

              maxAttempts: event.maxAttempts,

              delayMs: event.delayMs,

              statusCode: event.statusCode,

              reason: event.reason

            })

            break

          }



          case 'request_debug': {

            if (event.debugInfo) {

              setLastDebugInfo(envelope.runId, event.debugInfo)

              set((state) => {

                const session = state.sessions.find((s) => s.id === targetSessionId)

                if (session) {

                  const msg = session.messages.find((m) => m.id === envelope.runId)

                  if (msg) {

                    msg.debugInfo = event.debugInfo

                  }

                }

              })

            }

            break

          }



          case 'memory_recall': {

            const recallReason = event.reason ?? 'no_match'

            const recallHits = event.recallHits ?? []

            set((state) => {

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                const msg = session.messages.find((m) => m.id === envelope.runId)

                if (msg) {

                  msg.memoryRecall = { reason: recallReason, hits: recallHits }

                }

              }

            })

            break

          }



          case 'error':

            // Request failed — clear retry state

            useAgentStore.getState().setSessionRequestRetryState(targetSessionId, null)
            useAgentStore.getState().setSessionStatus(targetSessionId, null)

            // Same terminal fallback as loop_end — a failed run must not leave
            // the live compression card pinned above the input area.
            useLiveCompressionStore.getState().clear(targetSessionId)

            // Flush any pending stream deltas before clearing streaming state

            flushPendingStreamDeltas()

            // Clear agentStore pending tool calls on error

            useAgentStore.getState().resetLiveSessionExecution(targetSessionId)

            set((state) => {

              delete state.streamingMessages[targetSessionId]

              const session = state.sessions.find((s) => s.id === targetSessionId)

              if (session) {

                // RC-3: clear the streaming flag on ALL messages of the
                // session (not just the runId match) so a stale stream state
                // can't survive when the errored message was already dropped
                // (e.g. after a reload).
                for (const msg of session.messages) {

                  if (msg.isStreaming) {

                    msg.isStreaming = false

                    if (msg.id === envelope.runId) {

                      msg.error = event.message

                    }

                  }

                }

                const errored = session.messages.find((m) => m.id === envelope.runId)

                if (errored && !errored.error) {

                  errored.error = event.message

                }

              }

            })

            void import('@renderer/hooks/use-chat-actions')
              .then(({ pausePendingSessionDispatch }) => pausePendingSessionDispatch(targetSessionId))
              .catch((err) => {
                console.warn('[chat-store] Failed to pause queued messages after run error:', err)
              })

            break

        }

      }

    }

  }))

)



// ─── Compression artifacts (Plan 23-3 step 9) ───

function artifactToChatMessage(artifact: UnifiedMessage): ChatMessage {
  const text = typeof artifact.content === 'string' ? artifact.content : ''
  return {
    id: artifact.id,
    role: artifact.role === 'tool' ? 'system' : artifact.role,
    text,
    content: artifact.content,
    createdAt: artifact.createdAt,
    ...(artifact.meta ? { meta: artifact.meta } : {})
  }
}

function chatMessageToUnifiedMessage(message: ChatMessage): UnifiedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? message.text,
    createdAt: message.createdAt,
    ...(message.meta ? { meta: message.meta } : {})
  }
}

function buildCompressionDisplayAnchor(
  assistantMessage: ChatMessage
): NonNullable<CompressionStatusMeta['displayAnchor']> {
  // Live runs stream into segments/toolCalls; only the derived block list
  // matches the indexes the message list splits on.
  const position = getRenderedBlockPosition(
    buildChatMessageContent(assistantMessage as unknown as Record<string, unknown>)
  )

  return {
    assistantMessageId: assistantMessage.id,
    ...position
  }
}

/**
 * Track compression progress without adding a synthetic transcript message.
 * Completed compression is represented by its persisted compact artifacts; live
 * presentation remains the responsibility of the automatic/manual caller.
 */
export function updateCompressionStatus(
  _sessionId: string,
  meta: CompressionStatusMeta,
  operationId: string
): void {
  trackCompressionStatus({
    ...meta,
    operationId
  })
}

/**
 * The DB orders messages by (created_at, sort_order). Freshly merged artifacts
 * carry "now" timestamps, which would push them to the end of the transcript
 * on reload — relocate them just before the preserved-tail head so the boundary
 * stays at the compression point.
 */
function withCompactSummaryDisplayAnchor(
  summary: ChatMessage,
  currentMessages: ChatMessage[],
  boundaryMessage: ChatMessage,
  displayAnchor?: NonNullable<CompressionStatusMeta['displayAnchor']>,
  operationId?: string
): ChatMessage {
  const existing = summary.meta?.compactSummary
  if (existing?.displayAnchor?.assistantMessageId) {
    if (!operationId || existing.operationId === operationId) return summary
    return {
      ...summary,
      meta: {
        ...(summary.meta ?? {}),
        compactSummary: { ...existing, operationId }
      }
    }
  }
  // Manual cuts fold through the end of the conversation, so the summary belongs
  // at the transcript tail — exactly where the live compression card sat. The
  // recomputed inline anchor below would yank the divider back into the middle of
  // the history and make it jump on completion.
  if (boundaryMessage.meta?.compactBoundary?.trigger === 'manual') {
    return summary
  }
  if (displayAnchor?.assistantMessageId) {
    return {
      ...summary,
      meta: {
        ...(summary.meta ?? {}),
        compactSummary: {
          messagesSummarized: existing?.messagesSummarized ??
            (boundaryMessage.meta?.compactBoundary?.messagesSummarized ?? 0),
          recentMessagesPreserved: existing?.recentMessagesPreserved ?? false,
          ...existing,
          ...(operationId ? { operationId } : {}),
          displayAnchor
        }
      }
    }
  }

  const preservedHeadId = boundaryMessage.meta?.compactBoundary?.preservedSegment?.headId
  const compactMessages = currentMessages.filter(
    (message) => !isCompactSummaryLikeMessage(chatMessageToUnifiedMessage(message))
  )
  const preservedHeadIndex = preservedHeadId
    ? compactMessages.findIndex((message) => message.id === preservedHeadId)
    : -1
  const assistantMessage = compactMessages
    .slice(0, preservedHeadIndex >= 0 ? preservedHeadIndex : compactMessages.length)
    .reverse()
    .find((message) => message.role === 'assistant')
    ?? [...compactMessages].reverse().find((message) => message.role === 'assistant')

  if (!assistantMessage) {
    if (!operationId || existing?.operationId === operationId) return summary
    return {
      ...summary,
      meta: {
        ...(summary.meta ?? {}),
        compactSummary: {
          messagesSummarized: existing?.messagesSummarized ??
            (boundaryMessage.meta?.compactBoundary?.messagesSummarized ?? 0),
          recentMessagesPreserved: existing?.recentMessagesPreserved ?? false,
          ...existing,
          operationId
        }
      }
    }
  }

  const position = getRenderedBlockPosition(
    buildChatMessageContent(assistantMessage as unknown as Record<string, unknown>)
  )

  return {
    ...summary,
    meta: {
      ...(summary.meta ?? {}),
      compactSummary: {
        messagesSummarized: existing?.messagesSummarized ??
          (boundaryMessage.meta?.compactBoundary?.messagesSummarized ?? 0),
        recentMessagesPreserved: existing?.recentMessagesPreserved ?? false,
        ...existing,
        ...(operationId ? { operationId } : {}),
        displayAnchor: {
          assistantMessageId: assistantMessage.id,
          ...position
        }
      }
    }
  }
}

function adjustCompactArtifactTimestamps(messages: ChatMessage[], boundaryIndex: number): void {
  const summaryIndex = boundaryIndex + 1
  if (summaryIndex >= messages.length) return
  const prev = messages[boundaryIndex - 1]
  const next = messages[summaryIndex + 1]
  if (!next) return // appended at the end — fresh timestamps are already correct
  const lower = prev ? prev.createdAt : 0
  const upper = next.createdAt
  if (upper - lower >= 3) {
    messages[boundaryIndex].createdAt = upper - 2
    messages[summaryIndex].createdAt = upper - 1
  } else if (prev) {
    // No millisecond room — share the predecessor's timestamp; the artifacts'
    // sort_order (their transcript index) is higher than the predecessor's
    // upsert index, so the tiebreak still lands them after it.
    messages[boundaryIndex].createdAt = prev.createdAt
    messages[summaryIndex].createdAt = prev.createdAt
  }
}

/**
 * Merge the boundary + summary artifact pair emitted by a completed compression
 * into the session transcript — the full history stays visible, the pair marks
 * where the model context switched to the compressed view — and persist both
 * messages so reloads render the same summary card.
 */
export function applyCompactArtifactsToSession(
  sessionId: string,
  artifacts: UnifiedMessage[],
  operationId?: string
): void {
  const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)
  if (!session) return
  const rawArtifactMessages = artifacts.map(artifactToChatMessage)
  const boundaryMessage = rawArtifactMessages.find((message) =>
    isCompactBoundaryMessage(chatMessageToUnifiedMessage(message))
  )
  const summaryMessage = rawArtifactMessages.find((message) =>
    isCompactSummaryLikeMessage(chatMessageToUnifiedMessage(message))
  )
  if (!boundaryMessage || !summaryMessage) return
  const artifactMessages = rawArtifactMessages.map((message) =>
    message.id === summaryMessage.id
      ? withCompactSummaryDisplayAnchor(
          message,
          session.messages,
          boundaryMessage,
          getCompressionStatus(operationId)?.displayAnchor,
          operationId
        )
      : message
  )
  const boundaryId = boundaryMessage.id
  const isNewBoundary = !session.messages.some((m) => m.id === boundaryId)
  const merged = mergeCompressedMessagesKeepHistory(
    session.messages as unknown as UnifiedMessage[],
    artifactMessages as unknown as UnifiedMessage[]
  )
  if (!merged) return
  const mergedMessages = merged as unknown as ChatMessage[]
  if (isNewBoundary) {
    const boundaryIndex = mergedMessages.findIndex((m) => m.id === boundaryId)
    if (boundaryIndex >= 0) {
      adjustCompactArtifactTimestamps(mergedMessages, boundaryIndex)
    }
  }
  const now = Date.now()
  useChatStore.setState((state) => {
    const target = state.sessions.find((s) => s.id === sessionId)
    if (!target) return
    target.messages = mergedMessages
    target.messageCount = mergedMessages.length
    target.messagesLoaded = true
    target.isRuntimeResident = true
    target.updatedAt = now
  })
  const updated = useChatStore.getState().sessions.find((s) => s.id === sessionId)
  if (!updated) return
  for (const artifact of artifactMessages) {
    const index = updated.messages.findIndex((m) => m.id === artifact.id)
    if (index >= 0) {
      void dbUpsertMessage(sessionId, updated.messages[index], index)
    }
  }
}

/**
 * Refresh the contextTokens estimate on the last usage-bearing message so the
 * ContextRing updates immediately after a manual compression — that path emits
 * no message_end event, which is the only other writer of usage.contextTokens.
 * Persists the patched message so reloads keep the refreshed estimate.
 */
export function updateSessionContextTokens(
  sessionId: string,
  contextTokens: number
): void {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return
  const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)
  if (!session) return
  const messages = session.messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message?.usage) continue
    if ((message.usage.contextTokens ?? 0) === contextTokens) return
    const updatedMessage = {
      ...message,
      usage: { ...message.usage, contextTokens }
    }
    const nextMessages = [...messages]
    nextMessages[index] = updatedMessage
    useChatStore.setState((state) => {
      const target = state.sessions.find((candidate) => candidate.id === sessionId)
      if (!target) return
      target.messages = nextMessages
    })
    void dbUpsertMessage(sessionId, updatedMessage, index)
    return
  }
}



// Start the stream receiver

installGoalSyncListener()

// Manual-compression summary deltas: the worker emits request-scoped
// "agent/compression-delta" events that the main process relays on
// 'agent:compression-delta'. Append them to the live card's draft — the
// session filter happens in the store (the card is keyed by sessionId).
ipcClient.on(IPC.AGENT_COMPRESSION_DELTA, (...args: unknown[]) => {
  const payload = args[0] as
    | { sessionId?: string; text?: string }
    | undefined
  if (!payload?.sessionId || typeof payload.text !== 'string' || !payload.text) return
  const state = useLiveCompressionStore.getState()
  // No live card for this session means the compression already finished or the
  // window reloaded mid-flight — dropping the chunk is correct there.
  if (!state.bySessionId[payload.sessionId]) return
  state.appendDraft(payload.sessionId, payload.text)
})

getAgentStreamReceiver().start((envelope) => {

  useChatStore.getState().handleEnvelope(envelope)

})



// ─── rAF delta flush (wired after store creation to avoid TDZ) ───



function flushStreamDeltas(): void {

  _streamDeltaRafId = null

  if (_pendingStreamDeltas.length === 0) return



  const deltas = _pendingStreamDeltas.splice(0)



  // Group by session+msgId to batch updates

  const grouped = new Map<string, StreamDelta[]>()

  for (const delta of deltas) {

    const key = `${delta.sessionId}\u0000${delta.msgId}`

    let arr = grouped.get(key)

    if (!arr) {

      arr = []

      grouped.set(key, arr)

    }

    arr.push(delta)

  }



  useChatStore.setState((state) => {

    const now = Date.now()

    for (const [, sessionDeltas] of grouped) {

      const first = sessionDeltas[0]

      const session = state.sessions.find((s) => s.id === first.sessionId)

      if (!session) continue

      const msg = session.messages.find((m) => m.id === first.msgId)

      if (!msg) continue



      if (!msg.segments) msg.segments = []

      if (!msg.currentIteration) msg.currentIteration = 1



      for (const delta of sessionDeltas) {

        if (delta.kind === 'text') {

          msg.text += delta.text

          // Mark the last thinking segment as completed when text output starts

          const lastSegForText = msg.segments[msg.segments.length - 1]

          if (lastSegForText && lastSegForText.type === 'thinking' && !lastSegForText.completedAt) {

            lastSegForText.completedAt = now

          }

          // Append to last text segment of current iteration, or create new

          const lastSeg = msg.segments[msg.segments.length - 1]

          if (lastSeg && lastSeg.type === 'text' && lastSeg.iteration === msg.currentIteration) {

            lastSeg.text = (lastSeg.text ?? '') + delta.text

          } else {

            msg.segments.push({ type: 'text', iteration: msg.currentIteration, text: delta.text })

          }

        } else {

          msg.thinking = (msg.thinking ?? '') + delta.thinking

          // Append to last thinking segment of current iteration, or create new

          const lastSeg = msg.segments[msg.segments.length - 1]

          if (lastSeg && lastSeg.type === 'thinking' && lastSeg.iteration === msg.currentIteration) {

            lastSeg.thinking = (lastSeg.thinking ?? '') + delta.thinking

          } else {

            msg.segments.push({ type: 'thinking', iteration: msg.currentIteration, thinking: delta.thinking, startedAt: now })

          }

        }

      }

    }

  })

}



/** Synchronous flush — drains pending deltas immediately (used by loop_end/error). */

function flushPendingStreamDeltas(): void {

  if (_streamDeltaRafId !== null) {

    cancelAnimationFrame(_streamDeltaRafId)

    _streamDeltaRafId = null

  }

  flushStreamDeltas()

}



_scheduleStreamDeltaFlush = () => {

  if (_streamDeltaRafId !== null) return

  _streamDeltaRafId = requestAnimationFrame(flushStreamDeltas)

}

