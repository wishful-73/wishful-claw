import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { selectSessionScopedAgentState } from '@renderer/lib/agent/session-scoped-agent-state'
import { isStreamingPerfEnabled, recordStreamingReactCommit } from '@renderer/lib/streaming-perf'
import { mergeHiddenToolUseIds } from './MessageList/utils'
import { MessageListEmptyState } from './MessageList/EmptyState'
import { VirtualListContent } from './MessageList/VirtualListContent'
import { MessageRow } from './MessageList/MessageRow'
import { areMessageListPropsEqual } from './MessageList/props-equal'
import { useMessageListData } from './MessageList/useMessageListData'
import { useMessageListScroll } from './MessageList/useMessageListScroll'
import type { MessageListProps } from './MessageList/utils'

function MessageListInner(props: MessageListProps): React.JSX.Element {
  const {
    sessionId,
    onRetry,
    onContinue,
    onEditUserMessage,
    onDeleteMessage,
    exportAll = false,
    fullWidth = false
  } = props
  const { t } = useTranslation('chat')
  const animationsEnabled = useSettingsStore((s) => s.animationsEnabled)
  const currentActiveSessionId = useChatStore((s) => s.activeSessionId)
  const targetSessionId = sessionId ?? currentActiveSessionId
  const streamingMessageId = useChatStore((s) =>
    targetSessionId ? (s.streamingMessages[targetSessionId] ?? null) : null
  )
  const { hasActiveToolCallOutput } = useAgentStore((s) =>
    selectSessionScopedAgentState(s, targetSessionId, { mode: 'coarse' })
  )
  const mode = useUIStore((s) => s.mode)

  // Lifted shared state between data and scroll hooks
  const measuredMessageHeightsRef = React.useRef(new Map<string, number>())
  const [assistantRailMeasureVersion, setAssistantRailMeasureVersion] = React.useState(0)

  // ── Data hook ───────────────────────────────────────────────────
  const data = useMessageListData({
    targetSessionId,
    streamingMessageId,
    hasActiveToolCallOutput,
    mode,
    t,
    measuredMessageHeightsRef,
    assistantRailMeasureVersion,
  })

  // ── Scroll hook ─────────────────────────────────────────────────
  const scroll = useMessageListScroll({
    activeSessionId: data.activeSessionId,
    messages: data.messages,
    rows: data.rows,
    hasLoadOlderRow: data.hasLoadOlderRow,
    loadedRangeStart: data.loadedRangeStart,
    streamingMessageId,
    isSessionOutputting: data.isSessionOutputting,
    canSessionTriggerStreamingAutoScroll: data.canSessionTriggerStreamingAutoScroll,
    pendingAskUserQuestion: data.pendingAskUserQuestion,
    assistantRailItems: data.assistantRailItems,
    assistantRailItemById: data.assistantRailItemById,
    measuredMessageHeightsRef,
    setAssistantRailMeasureVersion,
  })

  // ── Empty state ─────────────────────────────────────────────────
  if (data.isAwaitingInitialMessages || data.messages.length === 0) {
    return (
      <MessageListEmptyState
        fullWidth={fullWidth}
        activeProjectId={data.activeProjectId}
        activeProjectName={data.activeProjectName}
        activeWorkingFolder={data.activeWorkingFolder}
        isAwaitingInitialMessages={data.isAwaitingInitialMessages}
        mode={mode}
        t={t}
        applySuggestedPrompt={scroll.applySuggestedPrompt}
      />
    )
  }

  // ── Export view (static, non-virtualized) ───────────────────────
  if (exportAll) {
    return (
      <div ref={scroll.containerRef} className="relative h-full flex-1" data-message-list>
        <div data-message-content>
          {data.renderableMessages.map((row) => {
            const message = data.messageLookup.get(row.messageId)
            if (!message) return null
            return (
              <MessageRow
                key={row.messageId}
                message={message}
                sessionId={targetSessionId}
                sessionAssistantMessageIds={data.sessionAssistantMessageIds}
                sessionToolUseIds={data.sessionToolUseIds}
                isStreaming={streamingMessageId === row.messageId}
                isLastUserMessage={row.isLastUserMessage}
                isLastAssistantMessage={row.isLastAssistantMessage}
                showContinue={row.showContinue}
                disableAnimation
                toolResults={data.toolResultsLookup.get(row.messageId) as any}
                inlineCompactSummaries={data.inlineCompactSummaryState.byAssistantId.get(row.messageId)}
                orchestrationRun={
                  data.orchestrationState.byMessageId.get(row.messageId)?.primaryRun ?? null
                }
                hiddenToolUseIds={mergeHiddenToolUseIds(
                  data.orchestrationState.byMessageId.get(row.messageId)?.hiddenToolUseIds as any,
                  data.duplicatePlanReviewToolUseIds
                )}
                anchorMessageId={null}
                highlightMessageId={null}
                requestRetryState={
                  row.isLastAssistantMessage ? ((data.sessionRequestRetryState ?? null) as any) : null
                }
                fullWidth={fullWidth}
                onRetry={onRetry}
                onContinue={onContinue}
                onEditUserMessage={onEditUserMessage}
                onDeleteMessage={onDeleteMessage}
              />
            )
          })}
        </div>
      </div>
    )
  }

  // ── Virtual list render ─────────────────────────────────────────
  const messageListContent = (
    <VirtualListContent
      containerRef={scroll.containerRef}
      listRef={scroll.listRef}
      virtualContentRef={scroll.virtualContentRef}
      rowVirtualizer={scroll.rowVirtualizer}
      handleListScroll={scroll.handleListScroll}
      hasLoadOlderRow={data.hasLoadOlderRow}
      loadOlderMessages={scroll.loadOlderMessages}
      isLoadingOlderMessages={scroll.isLoadingOlderMessages}
      totalTurns={data.totalTurns}
      loadedTurns={data.loadedTurns}
      loadedMessageCount={data.messages.length}
      totalMessageCount={data.messageCount}
      rows={data.rows}
      lastMessageRowIndex={data.rows.length - 1}
      messageLookup={data.messageLookup}
      toolResultsLookup={data.toolResultsLookup}
      inlineCompactSummaryState={data.inlineCompactSummaryState}
      orchestrationState={data.orchestrationState}
      duplicatePlanReviewToolUseIds={data.duplicatePlanReviewToolUseIds}
      sessionAssistantMessageIds={data.sessionAssistantMessageIds}
      sessionToolUseIds={data.sessionToolUseIds}
      streamingMessageId={streamingMessageId}
      isAgentExecutionActive={data.isAgentExecutionActive}
      highlightedMessageId={scroll.highlightedMessageId}
      sessionRequestRetryState={data.sessionRequestRetryState as any}
      targetSessionId={targetSessionId}
      fullWidth={fullWidth}
      isAtBottom={scroll.isAtBottom}
      animationsEnabled={animationsEnabled}
      assistantRailItems={data.assistantRailItems}
      activeAssistantRailMessageIds={scroll.activeAssistantRailMessageIds}
      handleJumpToAssistantMessage={scroll.handleJumpToAssistantMessage as any}
      scrollToBottom={scroll.scrollToBottom}
      t={t}
      onRetry={onRetry}
      onContinue={onContinue}
      onEditUserMessage={onEditUserMessage}
      onDeleteMessage={onDeleteMessage}
    />
  )

  return isStreamingPerfEnabled() ? (
    <React.Profiler
      id="MessageList"
      onRender={(_id, phase, actualDuration, baseDuration) => {
        recordStreamingReactCommit(actualDuration, { phase, baseDuration })
      }}
    >
      {messageListContent}
    </React.Profiler>
  ) : (
    messageListContent
  )
}

export const MessageList = React.memo(MessageListInner, areMessageListPropsEqual)
