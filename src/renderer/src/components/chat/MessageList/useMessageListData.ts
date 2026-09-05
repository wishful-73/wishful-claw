import * as React from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TFunction } from 'i18next'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { useChatStore } from '@renderer/stores/chat-store'
import { useLiveCompressionStore } from '@renderer/stores/live-compression-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { selectSessionScopedAgentState } from '@renderer/lib/agent/session-scoped-agent-state'
import { buildOrchestrationRuns } from '@renderer/lib/orchestration/build-runs'
import { isCompactSummaryLikeMessage } from '@renderer/lib/agent/context-compression'
import {
  buildRenderableChatItems,
  type RenderableChatItem
} from '../renderable-chat-items'
import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import { DB_MESSAGES_LIST_LOCATOR_MSGPACK_CHANNEL } from '../../../../../shared/messagepack/binary-ipc'
import {
  buildTranscriptStaticAnalysis,
  type TailToolExecutionState
} from '../transcript-utils'
import { type MessageListRow, type MessageLocatorIndexRow, type MessageLocatorSource, type AssistantRailLayout, type AssistantReplyRailItem, type AssistantRailLayoutRow, getMessageToolUseIds, collectDuplicatePlanReviewToolUseIds, hasCompleteTailToolExecutionResults, buildAssistantRailLayout, parseLocatorRowSource, findPendingAskUserQuestion, EMPTY_MESSAGE_LOCATOR_ROWS, EMPTY_ORCHESTRATION_STATE } from './utils'
import {
  selectMessageListSession,
  selectSessionScopedTeamState,
} from './utils'

export interface MessageListDataInput {
  targetSessionId: string | null
  streamingMessageId: string | null
  hasActiveToolCallOutput: boolean
  mode: string
  t: TFunction
  measuredMessageHeightsRef: React.RefObject<Map<string, number>>
  assistantRailMeasureVersion: number
}

export interface MessageListDataOutput {
  messages: UnifiedMessage[]
  messagesLoaded: boolean
  messageCount: number
  workingFolder: string | null
  loadedRangeStart: number
  totalTurns: number
  loadedTurns: number
  projectId: string | null
  transcriptAnalysis: ReturnType<typeof buildTranscriptStaticAnalysis>
  renderableMessages: RenderableChatItem[]
  orchestrationState: ReturnType<typeof buildOrchestrationRuns>
  assistantChangeTargets: Array<{ messageId: string; toolUseIds: string[] }>
  sessionAssistantMessageIds: string[]
  sessionToolUseIds: string[]
  messageLocatorSources: MessageLocatorSource[]
  messageLocatorRows: MessageLocatorIndexRow[]
  hiddenAssistantRailCompactSummaryIds: Set<string>
  assistantRailLayout: AssistantRailLayout
  assistantRailItems: AssistantReplyRailItem[]
  assistantRailItemById: Map<string, AssistantReplyRailItem>
  assistantRailLayoutRows: AssistantRailLayoutRow[]
  rows: MessageListRow[]
  hasLoadOlderRow: boolean
  pinnedTurnMessage: UnifiedMessage | null
  duplicatePlanReviewToolUseIds: Set<string>
  continueAssistantMessageId: string | null
  pendingAskUserQuestion: ReturnType<typeof findPendingAskUserQuestion>
  isAwaitingInitialMessages: boolean
  orchestrationMessages: UnifiedMessage[]
  messageLookup: Map<string, UnifiedMessage>
  toolResultsLookup: Map<string, unknown>
  tailToolExecutionState: TailToolExecutionState | null
  isAgentSessionRunning: boolean
  isTeamRunning: boolean
  hasStreamingMessage: boolean
  isPrimarySessionRunning: boolean
  isAgentExecutionActive: boolean
  isSessionRunning: boolean
  isSessionOutputting: boolean
  hasSessionOrchestrationData: boolean
  canSessionTriggerStreamingAutoScroll: boolean
  primarySessionStatus: string | null
  sessionRequestRetryState: unknown
  activeTeam: unknown
  teamHistory: unknown
  hasTeamOrchestrationData: boolean
  hasAgentOrchestrationData: boolean
  activeSubAgents: unknown
  completedSubAgents: unknown
  subAgentHistory: unknown
  isMainChatSession: boolean
  isDetachedSessionView: boolean
  activeSessionId: string | null
  activeProjectId: string | null
  activeProjectName: string | null
  activeWorkingFolder: string | null
  activeSessionMessageCount: number
}

export function useMessageListData(input: MessageListDataInput): MessageListDataOutput {
  const { targetSessionId, streamingMessageId, hasActiveToolCallOutput, t, measuredMessageHeightsRef, assistantRailMeasureVersion } = input

  // ── Store selectors ──────────────────────────────────────────────
  const sessionSelection = useChatStore(
    useShallow((s) => selectMessageListSession(s, targetSessionId))
  )
  const {
    messages,
    messagesLoaded: activeSessionLoaded,
    messageCount: activeSessionMessageCount,
    workingFolder: activeWorkingFolder,
    loadedRangeStart,
    totalTurns,
    projectId: activeProjectId
  } = sessionSelection

  // Loaded turns = user messages currently in memory (one turn per user message).
  const loadedTurns = React.useMemo(
    () => messages.reduce((count, message) => (message.role === 'user' ? count + 1 : count), 0),
    [messages]
  )

  const activeProjectName = useChatStore((s) => {
    if (!activeProjectId) return null
    return s.projects.find((project) => project.id === activeProjectId)?.name ?? null
  })

  const hasStreamingMessage = useChatStore((s) =>
    targetSessionId ? Boolean(s.streamingMessages[targetSessionId]) : false
  )

  const currentActiveSessionId = useChatStore((s) => s.activeSessionId)
  const activeSessionId = targetSessionId
  const isMainChatSession =
    Boolean(activeSessionId) && activeSessionId === currentActiveSessionId
  const isDetachedSessionView = Boolean(activeSessionId && activeSessionId !== currentActiveSessionId)

  const {
    activeSubAgents,
    completedSubAgents,
    subAgentHistory,
    isSessionRunning: isAgentSessionRunning,
    hasOrchestrationData: hasAgentOrchestrationData
  } = useAgentStore((s) => selectSessionScopedAgentState(s, activeSessionId, { mode: 'coarse' }))

  const primarySessionStatus = useAgentStore((s) =>
    activeSessionId ? (s.runningSessions[activeSessionId] ?? null) : null
  )

  const {
    activeTeam,
    teamHistory,
    isTeamRunning,
    hasOrchestrationData: hasTeamOrchestrationData
  } = useTeamStore((s) => selectSessionScopedTeamState(s, activeSessionId))

  const liveCompression = useLiveCompressionStore((state) =>
    targetSessionId ? state.bySessionId[targetSessionId] : undefined
  )
  const isCompressing = Boolean(liveCompression)
  const isPrimarySessionRunning =
    primarySessionStatus === 'running' || primarySessionStatus === 'retrying'
  const isAgentExecutionActive =
    !isCompressing && (isPrimarySessionRunning || isTeamRunning || hasStreamingMessage)
  const isSessionRunning =
    !isCompressing && (isAgentSessionRunning || isTeamRunning || hasStreamingMessage)
  const hasSessionOrchestrationData = React.useMemo(
    () => hasAgentOrchestrationData || hasTeamOrchestrationData,
    [hasAgentOrchestrationData, hasTeamOrchestrationData]
  )

  const sessionRequestRetryState = useAgentStore((s) =>
    activeSessionId ? (s.sessionRequestRetryState[activeSessionId] ?? null) : null
  )

  const isSessionOutputting = hasStreamingMessage || hasActiveToolCallOutput
  const canSessionTriggerStreamingAutoScroll =
    (isMainChatSession || isDetachedSessionView) && isSessionOutputting

  // ── Transcript analysis ──────────────────────────────────────────
  const transcriptAnalysis = React.useMemo(
    () => buildTranscriptStaticAnalysis(messages),
    [messages]
  )
  const {
    messageLookup,
    toolResultsLookup,
    tailToolExecutionState,
    orchestrationBindingSignature: orchestrationMessageBindingSignature
  } = transcriptAnalysis

  const duplicatePlanReviewToolUseIds = React.useMemo(
    () => collectDuplicatePlanReviewToolUseIds(messages, toolResultsLookup),
    [messages, toolResultsLookup]
  )

  // ── Orchestration snapshot ───────────────────────────────────────
  const [orchestrationMessageSnapshot, setOrchestrationMessageSnapshot] = React.useState<{
    messages: UnifiedMessage[]
    bindingSignature: string
  }>(() => ({
    messages,
    bindingSignature: orchestrationMessageBindingSignature
  }))

  const useCurrentMessagesForOrchestration =
    (!streamingMessageId && !hasActiveToolCallOutput) ||
    orchestrationMessageSnapshot.bindingSignature !== orchestrationMessageBindingSignature

  const orchestrationMessages = useCurrentMessagesForOrchestration
    ? messages
    : orchestrationMessageSnapshot.messages

  React.useEffect(() => {
    if (!useCurrentMessagesForOrchestration) return
    setOrchestrationMessageSnapshot((previous) => {
      if (
        previous.messages === messages &&
        previous.bindingSignature === orchestrationMessageBindingSignature
      ) {
        return previous
      }
      return { messages, bindingSignature: orchestrationMessageBindingSignature }
    })
  }, [messages, orchestrationMessageBindingSignature, useCurrentMessagesForOrchestration])

  const orchestrationState = React.useMemo(
    () =>
      hasSessionOrchestrationData
        ? buildOrchestrationRuns({
            sessionId: activeSessionId,
            messages: orchestrationMessages,
            activeSubAgents,
            completedSubAgents,
            subAgentHistory,
            activeTeam,
            teamHistory
          })
        : EMPTY_ORCHESTRATION_STATE,
    [
      activeSessionId, activeSubAgents, activeTeam, completedSubAgents,
      hasSessionOrchestrationData, orchestrationMessages, subAgentHistory, teamHistory
    ]
  )

  // ── Continue assistant message ──────────────────────────────────
  const continueAssistantMessageId = React.useMemo(() => {
    if (streamingMessageId || isSessionRunning) return null
    if (!hasCompleteTailToolExecutionResults(tailToolExecutionState)) return null
    return tailToolExecutionState?.assistantMessageId ?? null
  }, [isSessionRunning, streamingMessageId, tailToolExecutionState])

  const renderableMessages = React.useMemo(
    () =>
      buildRenderableChatItems(
        messages,
        transcriptAnalysis.renderableMessageIds,
        liveCompression
      ),
    [messages, transcriptAnalysis.renderableMessageIds, liveCompression]
  )

  // ── Assistant change targets ────────────────────────────────────
  const assistantChangeTargets = React.useMemo(
    () =>
      messages
        .filter((message) => message.role === 'assistant')
        .map((message) => ({
          messageId: message.id,
          toolUseIds: getMessageToolUseIds(message)
        })),
    [messages]
  )
  const sessionAssistantMessageIds = React.useMemo(
    () => assistantChangeTargets.map((target) => target.messageId),
    [assistantChangeTargets]
  )
  const sessionToolUseIds = React.useMemo(
    () => Array.from(new Set(assistantChangeTargets.flatMap((target) => target.toolUseIds))),
    [assistantChangeTargets]
  )

  // ── Message locator ─────────────────────────────────────────────
  const [messageLocatorSnapshot, setMessageLocatorSnapshot] = React.useState<{
    sessionId: string | null
    rows: MessageLocatorIndexRow[]
  }>({ sessionId: null, rows: EMPTY_MESSAGE_LOCATOR_ROWS })

  const messageLocatorRows =
    messageLocatorSnapshot.sessionId === activeSessionId
      ? messageLocatorSnapshot.rows
      : EMPTY_MESSAGE_LOCATOR_ROWS

  React.useEffect(() => {
    let cancelled = false
    if (!activeSessionId) {
      setMessageLocatorSnapshot({ sessionId: null, rows: EMPTY_MESSAGE_LOCATOR_ROWS })
      return
    }
    const loadMessageLocatorRows = async (): Promise<void> => {
      try {
        const rawRows = await invokeMessagePackBinary<Record<string, unknown>[] | null>(
          DB_MESSAGES_LIST_LOCATOR_MSGPACK_CHANNEL,
          activeSessionId
        )
        if (!cancelled) {
          // Map camelCase fields from Worker to snake_case expected by MessageLocatorIndexRow
          const mapped: MessageLocatorIndexRow[] = Array.isArray(rawRows)
            ? rawRows.map((r) => ({
                id: r.id as string,
                session_id: r.sessionId as string,
                role: r.role as string,
                content: r.content as string,
                meta: (r.meta as string | null) ?? null,
                created_at: r.createdAt as number,
                sort_order: r.sortOrder as number
              }))
            : EMPTY_MESSAGE_LOCATOR_ROWS
          setMessageLocatorSnapshot({
            sessionId: activeSessionId,
            rows: mapped
          })
        }
      } catch (err) {
        console.error('[MessageList] Failed to load message locator rows:', err)
        if (!cancelled) {
          setMessageLocatorSnapshot({
            sessionId: activeSessionId,
            rows: EMPTY_MESSAGE_LOCATOR_ROWS
          })
        }
      }
    }
    void loadMessageLocatorRows()
    return () => { cancelled = true }
  }, [activeSessionId, activeSessionMessageCount])

  const messageLocatorSources = React.useMemo<MessageLocatorSource[]>(() => {
    const sourcesById = new Map<string, MessageLocatorSource>()
    for (const row of messageLocatorRows) {
      const source = parseLocatorRowSource(row)
      sourcesById.set(source.id, source)
    }
    messages.forEach((message, messageIndex) => {
      const existing = sourcesById.get(message.id)
      sourcesById.set(message.id, {
        id: message.id,
        role: message.role,
        content: message.content,
        meta: message.meta,
        createdAt: message.createdAt,
        sortOrder: existing?.sortOrder ?? loadedRangeStart + messageIndex,
        source: message.source
      })
    })
    return [...sourcesById.values()].sort((first, second) => {
      if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder
      return first.createdAt - second.createdAt
    })
  }, [loadedRangeStart, messageLocatorRows, messages])

  // ── Assistant rail layout ───────────────────────────────────────
  const hiddenAssistantRailCompactSummaryIds = React.useMemo(() => {
    const hiddenIds = new Set<string>()
    for (const source of messageLocatorSources) {
      if (source.meta?.compactSummary || source.meta?.compactBoundary || source.meta?.compressionStatus) {
        hiddenIds.add(source.id)
      }
    }
    return hiddenIds
  }, [messageLocatorSources])

  const assistantRailLayout = React.useMemo<AssistantRailLayout>(() => {
    void assistantRailMeasureVersion
    return buildAssistantRailLayout({
      sources: messageLocatorSources,
      streamingMessageId,
      measuredHeights: measuredMessageHeightsRef.current ?? new Map(),
      hiddenCompactSummaryIds: hiddenAssistantRailCompactSummaryIds,
      t
    })
  }, [
    assistantRailMeasureVersion,
    hiddenAssistantRailCompactSummaryIds,
    measuredMessageHeightsRef,
    messageLocatorSources,
    streamingMessageId,
    t
  ])

  const assistantRailItems = assistantRailLayout.items
  const assistantRailItemById = React.useMemo(
    () => new Map(assistantRailItems.map((item) => [item.id, item])),
    [assistantRailItems]
  )

  // ── Rows ────────────────────────────────────────────────────────
  const rows = React.useMemo<MessageListRow[]>(() => {
    return renderableMessages.map<MessageListRow>((item) => ({
      type: 'message',
      key: item.kind === 'message' ? item.displayId : item.id,
      data: item
    }))
  }, [renderableMessages])

  const hasLoadOlderRow = loadedRangeStart > 0

  // ── Pinned current-turn user message ────────────────────────────
  // 仅在执行中的当前轮次启用：最后一条普通 user 消息作为任务锚点；
  // 历史折叠会话（无运行态）与压缩摘要/团队消息不参与吸附。
  const pinnedTurnMessage = React.useMemo(() => {
    if (!isAgentExecutionActive) return null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'user') continue
      if (message.source === 'team') continue
      if (isCompactSummaryLikeMessage(message)) continue
      return message
    }
    return null
  }, [isAgentExecutionActive, messages])

  // ── Pending ask user question ───────────────────────────────────
  const pendingAskUserQuestion = React.useMemo(
    () => findPendingAskUserQuestion(rows, toolResultsLookup, messageLookup),
    [messageLookup, rows, toolResultsLookup]
  )

  // ── Await initial messages ──────────────────────────────────────
  const isAwaitingInitialMessages =
    Boolean(activeSessionId) &&
    messages.length === 0 &&
    (!activeSessionLoaded || activeSessionMessageCount > 0 || loadedRangeStart > 0)

  return {
    messages,
    messagesLoaded: activeSessionLoaded,
    messageCount: activeSessionMessageCount,
    workingFolder: activeWorkingFolder ?? null,
    loadedRangeStart,
    totalTurns,
    loadedTurns,
    projectId: activeProjectId ?? null,
    transcriptAnalysis,
    renderableMessages,
    orchestrationState,
    assistantChangeTargets,
    sessionAssistantMessageIds,
    sessionToolUseIds,
    messageLocatorSources,
    messageLocatorRows,
    hiddenAssistantRailCompactSummaryIds,
    assistantRailLayout,
    assistantRailItems,
    assistantRailItemById,
    assistantRailLayoutRows: assistantRailLayout.rows,
    rows,
    hasLoadOlderRow,
    pinnedTurnMessage,
    duplicatePlanReviewToolUseIds,
    continueAssistantMessageId,
    pendingAskUserQuestion,
    isAwaitingInitialMessages,
    orchestrationMessages,
    messageLookup,
    toolResultsLookup,
    tailToolExecutionState,
    isAgentSessionRunning,
    isTeamRunning,
    hasStreamingMessage,
    isPrimarySessionRunning,
    isAgentExecutionActive,
    isSessionRunning,
    isSessionOutputting,
    hasSessionOrchestrationData,
    canSessionTriggerStreamingAutoScroll,
    primarySessionStatus,
    sessionRequestRetryState,
    activeTeam,
    teamHistory,
    hasTeamOrchestrationData,
    hasAgentOrchestrationData,
    activeSubAgents,
    completedSubAgents,
    subAgentHistory,
    isMainChatSession,
    isDetachedSessionView,
    activeSessionId,
    activeProjectId: activeProjectId ?? null,
    activeProjectName,
    activeWorkingFolder: activeWorkingFolder ?? null,
    activeSessionMessageCount,
  }
}
