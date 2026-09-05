import * as React from 'react'
import type { RequestRetryState } from '@renderer/lib/agent/types'
import { MessageRow } from './MessageRow'
import type {
  MessageListProps,
  RenderableMessage,
  ToolResultsLookup
} from './utils'
import type { OrchestrationRunStore } from '@renderer/lib/orchestration/build-runs'
import { mergeHiddenToolUseIds } from './utils'

interface ExportViewProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  renderableMessages: RenderableMessage[]
  toolResultsLookup: ToolResultsLookup
  orchestrationState: OrchestrationRunStore
  duplicatePlanReviewToolUseIds: Set<string>
  sessionAssistantMessageIds: string[]
  sessionToolUseIds: string[]
  streamingMessageId: string | null
  sessionRequestRetryState: RequestRetryState | null
  targetSessionId: string | null
  fullWidth: boolean
  onRetry: MessageListProps['onRetry']
  onContinue: MessageListProps['onContinue']
  onEditUserMessage: MessageListProps['onEditUserMessage']
  onDeleteMessage: MessageListProps['onDeleteMessage']
}

export function ExportView(props: ExportViewProps): React.JSX.Element {
  const {
    containerRef,
    renderableMessages,
    toolResultsLookup,
    orchestrationState,
    duplicatePlanReviewToolUseIds,
    sessionAssistantMessageIds,
    sessionToolUseIds,
    streamingMessageId,
    sessionRequestRetryState,
    targetSessionId,
    fullWidth,
    onRetry,
    onContinue,
    onEditUserMessage,
    onDeleteMessage
  } = props

  return (
    <div ref={containerRef} className="relative h-full flex-1" data-message-list>
      <div data-message-content>
        {renderableMessages.map((row) => {
          const originMessageId = row.kind === 'message' ? row.originMessageId : null
          const orchestration = originMessageId
            ? orchestrationState.byMessageId.get(originMessageId)
            : undefined

          return (
            <MessageRow
              key={row.messageId}
              item={row}
              sessionId={targetSessionId}
              sessionAssistantMessageIds={sessionAssistantMessageIds}
              sessionToolUseIds={sessionToolUseIds}
              isStreaming={row.kind === 'message' && streamingMessageId === row.originMessageId}
              isLastUserMessage={row.isLastUserMessage}
              isLastAssistantMessage={row.isLastAssistantMessage}
              showContinue={row.showContinue}
              disableAnimation
              toolResults={originMessageId ? (toolResultsLookup.get(originMessageId) as any) : undefined}
              orchestrationRun={orchestration?.primaryRun ?? null}
              hiddenToolUseIds={mergeHiddenToolUseIds(
                orchestration?.hiddenToolUseIds as any,
                duplicatePlanReviewToolUseIds
              )}
              anchorMessageId={null}
              highlightMessageId={null}
              requestRetryState={
                row.isLastAssistantMessage ? (sessionRequestRetryState ?? null) : null
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
