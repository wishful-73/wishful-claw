// Extracted types, interfaces, and constants for AssistantMessage

import type { ContentBlock, RequestDebugInfo, UnifiedMessage } from '@renderer/lib/api/types'
import type { ToolCallState, ToolCallStatus, RequestRetryState } from '@renderer/lib/agent/types'
import type { OrchestrationRun } from '@renderer/lib/orchestration/types'
import type { ToolResultContent, TokenUsage, MessageMeta } from '@renderer/lib/api/types'
import type { MemoryRecallInfo } from '@renderer/stores/chat-store/types'

export type AssistantRenderMode = 'default' | 'transcript' | 'static'

export interface AssistantMessageProps {
  content: string | ContentBlock[]
  isStreaming?: boolean
  createdAt?: number
  usage?: TokenUsage
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  liveToolCallMap?: Map<string, ToolCallState> | null
  inlineCompactSummaries?: readonly UnifiedMessage[]
  msgId?: string
  sessionId?: string | null
  sessionAssistantMessageIds?: readonly string[]
  sessionToolUseIds?: readonly string[]
  showRetry?: boolean
  showContinue?: boolean
  isLastAssistantMessage?: boolean
  onRetry?: (messageId: string) => void
  onContinue?: () => void
  onDelete?: (messageId: string) => void
  renderMode?: AssistantRenderMode
  orchestrationRun?: OrchestrationRun | null
  hiddenToolUseIds?: Set<string>
  requestRetryState?: RequestRetryState | null
  requestDebugInfo?: RequestDebugInfo
  meta?: MessageMeta
  preToolPhase?: boolean
  memoryRecall?: MemoryRecallInfo
}

export type AssistantRenderItem = { kind: 'block'; index: number } | { kind: 'tool-run'; runId: string }

export type AssistantRenderItemWithInlineSummary =
  | AssistantRenderItem
  | { kind: 'compact-summary'; message: UnifiedMessage }

export interface InlineCompactSummaryEntry {
  message: UnifiedMessage
  afterContentBlockCount: number
  afterNormalizedBlockIndex: number
  afterToolUseId?: string
}

export interface ModelThinkingIndicatorProps {
  modelName: string
  label: string
}

export const MARKDOWN_WRAPPER_CLASS = 'text-sm leading-relaxed text-foreground break-words'
export const THINK_OPEN_TAG_RE = /<\s*think\s*>/i
export const EMPTY_LIVE_TOOL_CALLS: ToolCallState[] = []
export const EMPTY_INLINE_COMPACT_SUMMARIES: readonly UnifiedMessage[] = []
export const EMPTY_ID_LIST: readonly string[] = []

export interface ToolCallRenderState {
  id: string
  toolUseId: string
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface BashArtifactEntry {
  path: string
  size: number
}

export interface CompletionTokenSegment {
  key: string
  label: string
  value: number
  color: string
}

export interface CompletionDetailRow {
  key: string
  label: string
  value: string
  color?: string
  hint?: string
}

export interface CompletionSummaryData {
  totalTokens: number
  totalValue: string
  estimated: boolean
  modelName?: string | null
  modelId?: string | null
  modelIcon?: string
  providerName?: string | null
  providerBuiltinId?: string
  segments: CompletionTokenSegment[]
  tokenRows: CompletionDetailRow[]
  metricRows: CompletionDetailRow[]
}

export interface ThinkSegment {
  type: 'text' | 'think'
  content: string
  closed?: boolean
}
