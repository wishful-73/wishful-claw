import * as React from 'react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { buildOrchestrationRuns } from '@renderer/lib/orchestration/build-runs'
import { buildRenderableChatItems } from '../renderable-chat-items'
import { selectSessionScopedAgentState } from '@renderer/lib/agent/session-scoped-agent-state'
import { MessageRow } from './MessageRow'
import { buildTranscriptStaticAnalysis } from '../transcript-utils'
import {
  collectDuplicatePlanReviewToolUseIds,
  getMessageToolUseIds,
  mergeHiddenToolUseIds,
  selectSessionScopedTeamState,
  EMPTY_ORCHESTRATION_STATE,
} from './utils'

export interface StaticMessageTranscriptProps {
  sessionId?: string | null
  messages: UnifiedMessage[]
  className?: string
}

export function StaticMessageTranscript({
  sessionId,
  messages,
  className
}: StaticMessageTranscriptProps): React.JSX.Element {
  const transcriptAnalysis = React.useMemo(
    () => buildTranscriptStaticAnalysis(messages),
    [messages]
  )
  const { toolResultsLookup } = transcriptAnalysis
  const duplicatePlanReviewToolUseIds = React.useMemo(
    () => collectDuplicatePlanReviewToolUseIds(messages, toolResultsLookup),
    [messages, toolResultsLookup]
  )
  const renderableMessages = React.useMemo(
    () => buildRenderableChatItems(messages, transcriptAnalysis.renderableMessageIds),
    [messages, transcriptAnalysis.renderableMessageIds]
  )
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
  const {
    activeSubAgents,
    completedSubAgents,
    subAgentHistory,
    hasOrchestrationData: hasAgentOrchestrationData
  } = useAgentStore((s) => selectSessionScopedAgentState(s, sessionId, { mode: 'coarse' }))
  const {
    activeTeam,
    teamHistory,
    hasOrchestrationData: hasTeamOrchestrationData
  } = useTeamStore((s) => selectSessionScopedTeamState(s, sessionId))
  const hasSessionOrchestrationData = hasAgentOrchestrationData || hasTeamOrchestrationData
  const orchestrationState = React.useMemo(
    () =>
      hasSessionOrchestrationData
        ? buildOrchestrationRuns({
            sessionId,
            messages,
            activeSubAgents,
            completedSubAgents,
            subAgentHistory,
            activeTeam,
            teamHistory
          })
        : EMPTY_ORCHESTRATION_STATE,
    [
      activeSubAgents,
      activeTeam,
      completedSubAgents,
      hasSessionOrchestrationData,
      messages,
      sessionId,
      subAgentHistory,
      teamHistory
    ]
  )

  return (
    <div className={className} data-message-content data-session-image-transcript>
      {renderableMessages.map((row) => {
        const originMessageId = row.kind === 'message' ? row.originMessageId : null
        const orchestration = originMessageId
          ? orchestrationState.byMessageId.get(originMessageId)
          : undefined

        return (
          <MessageRow
            key={row.messageId}
            item={row}
            sessionId={sessionId}
            sessionAssistantMessageIds={sessionAssistantMessageIds}
            sessionToolUseIds={sessionToolUseIds}
            isStreaming={false}
            isLastUserMessage={row.isLastUserMessage}
            isLastAssistantMessage={row.isLastAssistantMessage}
            showContinue={false}
            disableAnimation
            toolResults={originMessageId ? toolResultsLookup.get(originMessageId) : undefined}
            orchestrationRun={orchestration?.primaryRun ?? null}
            hiddenToolUseIds={mergeHiddenToolUseIds(
              orchestration?.hiddenToolUseIds,
              duplicatePlanReviewToolUseIds
            )}
            anchorMessageId={null}
            highlightMessageId={null}
            renderMode="transcript"
            requestRetryState={null}
            showChangeSummary={false}
          />
        )
      })}
    </div>
  )
}
