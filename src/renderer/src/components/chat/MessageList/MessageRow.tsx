import * as React from 'react'
import { MessageItem } from '../MessageItem'
import { SessionChangeSummaryCard } from '../SessionChangeSummaryCard'
import {
  type MessageRowProps,
  getMessageToolUseIds,
  getMessageColumnClass,
  areMessageRowPropsEqual,
} from './utils'

export const MessageRow = React.memo(function MessageRow({
  item,
  sessionId,
  sessionAssistantMessageIds,
  sessionToolUseIds,
  isStreaming,
  isLastUserMessage,
  isLastAssistantMessage,
  disableAnimation,
  toolResults,
  orchestrationRun,
  hiddenToolUseIds,
  anchorMessageId,
  highlightMessageId,
  requestRetryState,
  renderMode,
  showChangeSummary = true,
  fullWidth = false,
  onEditUserMessage
}: MessageRowProps): React.JSX.Element {
  const message = item.kind === 'message' ? item.message : null
  const messageId = item.kind === 'message' ? item.originMessageId : item.messageId
  const displayId = item.kind === 'message' ? item.displayId : item.id
  const isAnchor = anchorMessageId === messageId
  const isHighlighted = highlightMessageId === messageId
  const messageToolUseIds = React.useMemo(
    () => (message ? getMessageToolUseIds(message) : []),
    [message]
  )

  return (
    <div
      data-message-id={displayId}
      data-origin-message-id={messageId}
      data-anchor={isAnchor ? 'true' : undefined}
      className={`${getMessageColumnClass(fullWidth)} pb-7 transition-colors duration-500 ${
        isHighlighted ? 'rounded-md bg-primary/5 ring-1 ring-primary/20' : ''
      }`}
    >
      <MessageItem
        item={item}
        message={message ?? undefined}
        messageId={displayId}
        sessionId={sessionId}
        sessionAssistantMessageIds={sessionAssistantMessageIds}
        sessionToolUseIds={sessionToolUseIds}
        isStreaming={isStreaming}
        isLastUserMessage={isLastUserMessage}
        isLastAssistantMessage={isLastAssistantMessage}
        disableAnimation={disableAnimation}
        renderMode={renderMode}
        onEditUserMessage={onEditUserMessage}
        toolResults={toolResults}
        orchestrationRun={orchestrationRun}
        hiddenToolUseIds={hiddenToolUseIds}
        requestRetryState={requestRetryState}
      />
      {showChangeSummary && message?.role === 'assistant' && !isStreaming && sessionId ? (
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <SessionChangeSummaryCard
            sessionId={sessionId}
            messageId={messageId}
            toolUseIds={messageToolUseIds}
          />
        </div>
      ) : null}
    </div>
  )
}, areMessageRowPropsEqual)
