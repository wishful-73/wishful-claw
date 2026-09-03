// Pure utility functions and types extracted from MessageList.tsx

import type { ContentBlock, ToolResultContent, UnifiedMessage } from '@renderer/lib/api/types'
import type { TailToolExecutionState } from '../transcript-utils'
import type { RenderableChatItem } from '../renderable-chat-items'
import type { ActiveTeam } from '@renderer/stores/team-store'
import type { useChatStore } from '@renderer/stores/chat-store'
import type { useTeamStore } from '@renderer/stores/team-store'
import type { RequestRetryState } from '@renderer/lib/agent/types'
import type { EditableUserMessageDraft } from '@renderer/lib/image-attachments'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'


export interface MessageListProps {
  sessionId?: string | null
  onRetry?: () => void
  onContinue?: () => void
  onEditUserMessage?: (messageId: string, draft: EditableUserMessageDraft) => void
  onDeleteMessage?: (messageId: string) => void
  exportAll?: boolean
  fullWidth?: boolean
}

export type RenderableMessage = RenderableChatItem

export type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

export type MessageListRow = { type: 'message'; key: string; data: RenderableChatItem }

export type AutoScrollMode = 'off' | 'user' | 'stream'

export interface AskUserQuestionPresence {
  assistantMessageId: string
  toolUseId: string
}

export function getMessageToolUseIds(message: UnifiedMessage): string[] {
  if (!Array.isArray(message.content)) return []
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => {
      return block.type === 'tool_use'
    })
    .map((block) => block.id)
    .filter(Boolean)
}

export function toolResultContentToText(content: ToolResultContent | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

export function getPlanReviewPlanId(content: ToolResultContent | undefined): string | null {
  const text = toolResultContentToText(content)
  if (!text.trim()) return null
  const parsed = decodeStructuredToolResult(text)
  if (!parsed || Array.isArray(parsed)) return null
  const planId = typeof parsed.plan_id === 'string' ? parsed.plan_id.trim() : ''
  return planId || null
}

export function collectDuplicatePlanReviewToolUseIds(
  messages: UnifiedMessage[],
  toolResultsLookup: Map<string, ToolResultsLookup>
): Set<string> {
  const latestByPlanId = new Map<string, { toolUseId: string; order: number }>()
  const occurrences: Array<{ planId: string; toolUseId: string; order: number }> = []
  let order = 0

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      order += 1
      continue
    }

    const toolResults = toolResultsLookup.get(message.id)
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue
      if (block.name !== 'SubmitPlanReview') continue

      const planId = getPlanReviewPlanId(toolResults?.get(block.id)?.content)
      if (!planId) {
        order += 1
        continue
      }

      const occurrence = { planId, toolUseId: block.id, order }
      occurrences.push(occurrence)
      const previous = latestByPlanId.get(planId)
      if (!previous || occurrence.order > previous.order) {
        latestByPlanId.set(planId, occurrence)
      }
      order += 1
    }
  }

  const hidden = new Set<string>()
  for (const occurrence of occurrences) {
    const latest = latestByPlanId.get(occurrence.planId)
    if (latest && latest.toolUseId !== occurrence.toolUseId) {
      hidden.add(occurrence.toolUseId)
    }
  }
  return hidden
}

export function mergeHiddenToolUseIds(first?: Set<string>, second?: Set<string>): Set<string> | undefined {
  if (!first || first.size === 0) return second && second.size > 0 ? second : undefined
  if (!second || second.size === 0) return first
  return new Set([...first, ...second])
}

export function hasCompleteTailToolExecutionResults(state: TailToolExecutionState | null): boolean {
  if (!state || state.toolUseBlocks.length === 0) return false

  return state.toolUseBlocks.every((toolUse) => state.toolResultMap.has(toolUse.id))
}

export function hasEmptyAssistantContent(message: UnifiedMessage): boolean {
  if (message.role !== 'assistant') return false
  if (typeof message.content === 'string') return message.content.length === 0
  return Array.isArray(message.content) && message.content.length === 0
}

export interface MessageLocatorIndexRow {
  id: string
  session_id: string
  role: string
  content: string
  meta: string | null
  created_at: number
  sort_order: number
}

export interface MessageLocatorSource {
  id: string
  role: UnifiedMessage['role']
  content: UnifiedMessage['content']
  meta?: UnifiedMessage['meta']
  createdAt: number
  sortOrder: number
  source?: UnifiedMessage['source']
}

export type AssistantRailMarkerKind = 'assistant' | 'streaming' | 'summary' | 'user'

export interface AssistantRailLayoutRow extends MessageLocatorSource {
  estimatedTop: number
  estimatedHeight: number
  markerKind: AssistantRailMarkerKind | null
}

export interface AssistantReplyRailItem {
  id: string
  index: number
  preview: string
  time: string
  position: number
  sortOrder: number
  createdAt: number
  estimatedTop: number
  estimatedHeight: number
  kind: AssistantRailMarkerKind
}

export interface AssistantRailLayout {
  rows: AssistantRailLayoutRow[]
  items: AssistantReplyRailItem[]
  totalEstimatedHeight: number
}

export type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
export type TeamStoreSnapshot = ReturnType<typeof useTeamStore.getState>

export interface MessageRowProps {
  item: RenderableChatItem
  sessionId?: string | null
  sessionAssistantMessageIds?: readonly string[]
  sessionToolUseIds?: readonly string[]
  isStreaming: boolean
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  showContinue: boolean
  disableAnimation: boolean
  toolResults?: ToolResultsLookup
  orchestrationRun?: import('@renderer/lib/orchestration/types').OrchestrationRun | null
  hiddenToolUseIds?: Set<string>
  anchorMessageId?: string | null
  highlightMessageId?: string | null
  requestRetryState?: RequestRetryState | null
  renderMode?: 'default' | 'transcript' | 'static'
  showChangeSummary?: boolean
  fullWidth?: boolean
  onRetry?: () => void
  onContinue?: () => void
  onEditUserMessage?: (messageId: string, draft: EditableUserMessageDraft) => void
  onDeleteMessage?: (messageId: string) => void
}

export const EMPTY_MESSAGES: UnifiedMessage[] = []
export const EMPTY_MESSAGES_RAW: readonly unknown[] = []
export const EMPTY_TEAM_HISTORY: ActiveTeam[] = []
export const AUTO_SCROLL_BOTTOM_THRESHOLD = 24
export const STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD = 80
export const STREAMING_AUTO_SCROLL_STOP_THRESHOLD = 240
export const TAIL_STATIC_MESSAGE_COUNT = 4
export const TAIL_LIVE_MESSAGE_COUNT = 6
export const FOLLOW_BOTTOM_SETTLE_FRAMES = 3
export const BOTTOM_SCROLL_CORRECTION_EPSILON = 2
export const AUTO_SCROLL_MIN_DELTA = 24
export const PROGRAMMATIC_SCROLL_GUARD_MS = 160
export const STREAMING_AUTO_SCROLL_POLL_MS = 500
export const USER_LOCATOR_HIGHLIGHT_MS = 1400
export const ASSISTANT_RAIL_PREVIEW_LIMIT = 120
export const ASSISTANT_RAIL_SCROLL_OFFSET = 28
export const ASSISTANT_RAIL_DENSE_THRESHOLD = 80
export const MIN_RENDERABLE_HISTORY_ROWS = 3
export const VIRTUAL_ROW_ESTIMATED_HEIGHT = 180
export const VIRTUAL_ROW_OVERSCAN = 8
export const INITIAL_TAIL_RENDER_COUNT = 32
export const EMPTY_ORCHESTRATION_STATE = { runs: [], byId: new Map(), byMessageId: new Map() }
export const MESSAGE_COLUMN_CLASS = 'mx-auto w-full max-w-[820px] px-5'
export const MESSAGE_COLUMN_COMPACT_CLASS = 'mx-auto w-full max-w-[720px] px-5'
export const MESSAGE_COLUMN_FULL_WIDTH_CLASS = 'mx-auto w-full max-w-none px-5'
export const EMPTY_MESSAGE_LOCATOR_ROWS: MessageLocatorIndexRow[] = []
export const EMPTY_ASSISTANT_RAIL_LAYOUT: AssistantRailLayout = {
  rows: [],
  items: [],
  totalEstimatedHeight: 0
}

export function getMessageColumnClass(fullWidth: boolean): string {
  return fullWidth ? MESSAGE_COLUMN_FULL_WIDTH_CLASS : MESSAGE_COLUMN_CLASS
}

export function getMessageColumnCompactClass(fullWidth: boolean): string {
  return fullWidth ? MESSAGE_COLUMN_FULL_WIDTH_CLASS : MESSAGE_COLUMN_COMPACT_CLASS
}

export interface MessageListSessionSelection {
  messages: UnifiedMessage[]
  messagesLoaded: boolean
  messageCount: number
  workingFolder?: string
  loadedRangeStart: number
  totalTurns: number
  projectId?: string
}

export interface SessionScopedTeamSelection {
  activeTeam: ActiveTeam | null
  teamHistory: ActiveTeam[]
  isTeamRunning: boolean
  hasOrchestrationData: boolean
  signature: string
}

export const EMPTY_MESSAGE_LIST_SESSION_SELECTION: MessageListSessionSelection = {
  messages: EMPTY_MESSAGES,
  messagesLoaded: false,
  messageCount: 0,
  loadedRangeStart: 0,
  totalTurns: 0,
  projectId: undefined,
  workingFolder: undefined
}

export const EMPTY_SESSION_TEAM_SELECTION: SessionScopedTeamSelection = {
  activeTeam: null,
  teamHistory: EMPTY_TEAM_HISTORY,
  isTeamRunning: false,
  hasOrchestrationData: false,
  signature: 'empty'
}

export const sessionScopedTeamSelectionCache = new Map<string, SessionScopedTeamSelection>()

export function areToolResultsEqual(a?: ToolResultsLookup, b?: ToolResultsLookup): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false

  for (const [id, value] of a) {
    const other = b.get(id)
    if (!other) return false
    if (other.isError !== value.isError) return false
    if (other.content !== value.content) return false
  }

  return true
}

export function areStringSetsEqual(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false

  for (const value of a) {
    if (!b.has(value)) return false
  }

  return true
}

export function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }

  return true
}

export function areRequestRetryStatesEqual(
  a?: RequestRetryState | null,
  b?: RequestRetryState | null
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b

  return (
    a.attempt === b.attempt &&
    a.maxAttempts === b.maxAttempts &&
    a.delayMs === b.delayMs &&
    a.statusCode === b.statusCode &&
    a.reason === b.reason
  )
}

export function buildTeamMemberRenderSignature(team: ActiveTeam): string {
  return team.members
    .map((member) =>
      [
        member.id,
        member.name,
        member.agentName ?? '',
        member.role ?? '',
        member.status,
        String(member.iteration),
        String(member.currentTaskId ?? ''),
        String(member.startedAt),
        String(member.completedAt ?? ''),
        member.streamingText ?? '',
        String(member.toolCalls?.length ?? 0)
      ].join(':')
    )
    .join('|')
}

export function buildTeamTaskRenderSignature(team: ActiveTeam): string {
  return team.tasks
    .map((task) =>
      [
        task.id,
        task.subject,
        task.status,
        task.owner ?? '',
        task.description ?? '',
        task.report ?? ''
      ].join(':')
    )
    .join('|')
}

export function buildTeamMessageRenderSignature(team: ActiveTeam): string {
  const lastMessage = team.messages[team.messages.length - 1]
  return [
    String(team.messages.length),
    lastMessage?.id ?? '',
    lastMessage?.summary ?? '',
    lastMessage?.timestamp ?? ''
  ].join(':')
}

export function buildTeamRenderSignature(team: ActiveTeam): string {
  return [
    team.name,
    team.description,
    team.sessionId ?? '',
    String(team.createdAt),
    String(team.lastRuntimeSyncAt ?? ''),
    buildTeamMemberRenderSignature(team),
    buildTeamTaskRenderSignature(team),
    buildTeamMessageRenderSignature(team)
  ].join('::')
}

export function isActiveTeamRunning(team: ActiveTeam): boolean {
  return (
    team.tasks.some((task) => task.status !== 'completed') ||
    team.members.some((member) => member.status === 'working' || member.status === 'waiting')
  )
}

// Cache: ChatMessage[] reference → UnifiedMessage[] conversion result
// This prevents infinite re-render loops by returning the same array reference
// when the source messages array hasn't changed.
export const chatMessageConversionCache = new WeakMap<readonly unknown[], UnifiedMessage[]>()

export function convertChatMessagesToUnified(messages: readonly unknown[]): UnifiedMessage[] {
  const cached = chatMessageConversionCache.get(messages)
  if (cached) return cached

  const converted = messages.map((raw) => {
    const msg = raw as Record<string, unknown>
    const role = msg.role as UnifiedMessage['role']
    const text = (msg.text as string) ?? ''
    const thinking = msg.thinking as string | undefined
    const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined

    // Build content blocks from ChatMessage fields
    const blocks: ContentBlock[] = []
    const persistedContent = Array.isArray(msg.content)
      ? (msg.content as ContentBlock[])
      : null

    if (persistedContent && persistedContent.length > 0) {
      blocks.push(...persistedContent)
    } else {
      // Use segments for temporal ordering if available (preserves iteration boundaries)
      const segments = msg.segments as Array<Record<string, unknown>> | undefined
      if (segments && segments.length > 0) {
      for (const seg of segments) {
        const segType = seg.type as string
        if (segType === 'thinking' && seg.thinking) {
          blocks.push({ type: 'thinking', thinking: seg.thinking as string, startedAt: seg.startedAt as number | undefined, completedAt: seg.completedAt as number | undefined })
        } else if (segType === 'text' && seg.text) {
          blocks.push({ type: 'text', text: seg.text as string })
        } else if (segType === 'tool_use' && seg.toolCallId) {
          blocks.push({
            type: 'tool_use',
            id: seg.toolCallId as string,
            name: (seg.toolName as string) ?? 'unknown',
            input: (seg.input as Record<string, unknown>) ?? {}
          })
          // Also add inline tool_result block for completed/errored tools
          // so that resolveToolCallStatus finds a result instead of falling back to 'canceled'
          const segStatus = seg.status as string | undefined
          if (segStatus === 'completed' || segStatus === 'error') {
            blocks.push({
              type: 'tool_result',
              toolUseId: seg.toolCallId as string,
              content: (seg.output as string) ?? '',
              isError: segStatus === 'error'
            })
          }
        }
      }
    } else {
      // Fallback: old format without temporal ordering
      if (thinking) {
        blocks.push({ type: 'thinking', thinking })
      }

      if (text) {
        blocks.push({ type: 'text', text })
      }

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id as string,
            name: tc.name as string,
            input: (tc.input as Record<string, unknown>) ?? {}
          })
          // Also add inline tool_result block for completed/errored tools
          const tcStatus = tc.status as string | undefined
          if (tcStatus === 'completed' || tcStatus === 'error') {
            blocks.push({
              type: 'tool_result',
              toolUseId: tc.id as string,
              content: (tc.output as string) ?? '',
              isError: tcStatus === 'error'
            })
          }
        }
      }
    }
    }

    const result: UnifiedMessage = {
      id: msg.id as string,
      role,
      content: blocks.length > 0 ? blocks : text,
      createdAt: (msg.createdAt as number) ?? Date.now()
    }

    if (msg.usage) result.usage = msg.usage as UnifiedMessage['usage']
    if (msg.debugInfo) result.debugInfo = msg.debugInfo as UnifiedMessage['debugInfo']
    if (msg.meta) result.meta = msg.meta as UnifiedMessage['meta']
    if (msg.preToolPhase) result.preToolPhase = true
    if (msg.memoryRecall) result.memoryRecall = msg.memoryRecall as UnifiedMessage['memoryRecall']
    // Use text length as revision so structural signature changes when
    // streaming text grows (buildStructuralSignature uses _revision).
    // This ensures renderableMessageIds is rebuilt when assistant text
    // goes from empty to non-empty. The recall outcome is included so the
    // memoized row re-renders the moment the recall banner data arrives.
    const recallFingerprint = msg.memoryRecall
      ? 1 + ((msg.memoryRecall as { hits?: string[] }).hits?.length ?? 0)
      : 0
    result._revision = (text.length) + (thinking?.length ?? 0) + (toolCalls?.length ?? 0) + recallFingerprint
    if (msg.error) {
      // Represent errors as an agent_error block
      result.content = [{ type: 'agent_error', code: 'runtime_error', message: msg.error as string }]
    }

    return result
  })

  chatMessageConversionCache.set(messages, converted)
  return converted
}

export function selectMessageListSession(
  state: ChatStoreSnapshot,
  sessionId: string | null | undefined
): MessageListSessionSelection {
  if (!sessionId) return EMPTY_MESSAGE_LIST_SESSION_SELECTION

  const idx = state.sessionsById[sessionId]
  if (idx === undefined) return EMPTY_MESSAGE_LIST_SESSION_SELECTION

  const session = state.sessions[idx]
  const rawMessages = session.messages ?? EMPTY_MESSAGES_RAW
  const messages = rawMessages.length > 0
    ? convertChatMessagesToUnified(rawMessages)
    : EMPTY_MESSAGES

  return {
    messages,
    messagesLoaded: session.messagesLoaded ?? false,
    messageCount: session.messageCount ?? 0,
    workingFolder: session.workingFolder,
    loadedRangeStart: session.loadedRangeStart ?? 0,
    totalTurns: session.totalTurns ?? 0,
    projectId: session.projectId
  }
}

export function selectSessionScopedTeamState(
  state: TeamStoreSnapshot,
  sessionId: string | null | undefined
): SessionScopedTeamSelection {
  if (!sessionId) return EMPTY_SESSION_TEAM_SELECTION

  const activeTeam = state.activeTeam?.sessionId === sessionId ? state.activeTeam : null
  let teamHistory = EMPTY_TEAM_HISTORY
  const signatureParts: string[] = []

  if (activeTeam) {
    signatureParts.push(`active:${buildTeamRenderSignature(activeTeam)}`)
  }

  for (const team of state.teamHistory) {
    if (team.sessionId !== sessionId) continue
    if (teamHistory === EMPTY_TEAM_HISTORY) teamHistory = []
    teamHistory.push(team)
    signatureParts.push(`history:${buildTeamRenderSignature(team)}`)
  }

  const signature = signatureParts.join('\u0001')
  const cached = sessionScopedTeamSelectionCache.get(sessionId)
  if (cached?.signature === signature) return cached

  const nextSelection: SessionScopedTeamSelection = {
    activeTeam,
    teamHistory,
    isTeamRunning: activeTeam ? isActiveTeamRunning(activeTeam) : false,
    hasOrchestrationData: Boolean(activeTeam) || teamHistory !== EMPTY_TEAM_HISTORY,
    signature
  }

  sessionScopedTeamSelectionCache.set(sessionId, nextSelection)
  return nextSelection
}

export function getOrchestrationRunSignature(
  run?: import('@renderer/lib/orchestration/types').OrchestrationRun | null
): string {
  if (!run) return ''

  const memberSig = run.members
    .map(
      (member) =>
        `${member.id}:${member.status}:${member.iteration}:${member.progress}:${member.toolCallCount}:${member.completedAt ?? ''}:${member.latestAction}:${member.summary}`
    )
    .join('|')

  return [
    run.id,
    run.status,
    run.stageIndex,
    run.stageCount,
    run.selectedMemberId ?? '',
    run.completedAt ?? '',
    run.summary,
    run.latestAction,
    memberSig
  ].join('::')
}
void getOrchestrationRunSignature

export function areMessageRowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.sessionId === next.sessionId &&
    areStringArraysEqual(prev.sessionAssistantMessageIds, next.sessionAssistantMessageIds) &&
    areStringArraysEqual(prev.sessionToolUseIds, next.sessionToolUseIds) &&
    prev.isStreaming === next.isStreaming &&
    prev.isLastUserMessage === next.isLastUserMessage &&
    prev.isLastAssistantMessage === next.isLastAssistantMessage &&
    prev.showContinue === next.showContinue &&
    prev.disableAnimation === next.disableAnimation &&
    prev.fullWidth === next.fullWidth &&
    (prev.toolResults === next.toolResults ||
      areToolResultsEqual(prev.toolResults, next.toolResults)) &&
    prev.orchestrationRun === next.orchestrationRun &&
    prev.hiddenToolUseIds === next.hiddenToolUseIds &&
    prev.anchorMessageId === next.anchorMessageId &&
    prev.highlightMessageId === next.highlightMessageId &&
    prev.renderMode === next.renderMode &&
    prev.showChangeSummary === next.showChangeSummary &&
    areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState) &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onEditUserMessage === next.onEditUserMessage &&
    prev.onDeleteMessage === next.onDeleteMessage
  )
}

export function getDistanceToBottom(ref: HTMLDivElement): number {
  return Math.max(0, ref.scrollHeight - ref.scrollTop - ref.clientHeight)
}

export function findPendingAskUserQuestion(
  rows: MessageListRow[],
  toolResultsLookup: Map<string, ToolResultsLookup>,
  messageLookup: Map<string, UnifiedMessage>
): AskUserQuestionPresence | null {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex]
    if (row.type !== 'message') continue

    const message = messageLookup.get(row.data.messageId)
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const toolResults = toolResultsLookup.get(row.data.messageId)
    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue
      if (toolResults?.has(block.id)) continue
      return { assistantMessageId: row.data.messageId, toolUseId: block.id }
    }
  }

  return null
}


// Locator utilities extracted to locator-utils.ts
export {
  normalizeLocatorPreview,
  truncateAssistantRailPreview,
  isSystemPromptText,
  getUserMessageText,
  getAssistantVisibleText,
  countToolUseBlocks,
  countCodeFenceBlocks,
  isTeamLocatorSource,
  shouldShowAssistantRailMarker,
  getAssistantRailMarkerKind,
  buildAssistantRailPreview,
  estimateLocatorRowHeight,
  buildAssistantRailLayout,
  parseLocatorRowSource,
  countImageBlocks,
  getCompactRailGapPx,
  getCompactRailMarkerOffsetPx,
  getCompactRailMarkerTop,
  getCompactRailMarkerY,
  formatLocatorTime,
  splitLocatorPreview,
  parseLocatorContent,
  parseLocatorMeta,
} from './locator-utils'
