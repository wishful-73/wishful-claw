/**
 * Agent stream protocol — wire format for main→renderer event streaming.
 * Simplified from WishfulClaw: no SubAgent/Image/WebSearch/Translation events.
 */

// ---- Protocol version ----

export const AGENT_STREAM_PROTOCOL_VERSION = 1

// ---- Wire envelope ----

export interface AgentStreamEnvelope {
  v: typeof AGENT_STREAM_PROTOCOL_VERSION
  runId: string
  sessionId: string
  seq: number
  events: AgentStreamEvent[]
}

// ---- Wire sub-types ----

export interface TokenUsageWire {
  inputTokens: number
  outputTokens: number
  billableInputTokens?: number
  cacheCreationTokens?: number
  cacheCreation5mTokens?: number
  cacheCreation1hTokens?: number
  cacheReadTokens?: number
  cacheReadRatio?: number
  reasoningTokens?: number
  contextTokens?: number
  contextLength?: number
  // Session-cumulative cache counters (filled by backend AgentLoop)
  sessionCacheHitTokens?: number
  sessionCacheMissTokens?: number
  // Source: "executor", "subagent", "compaction", etc.
  usageSource?: string
}

export interface RequestTimingWire {
  totalMs: number
  ttftMs?: number
  tps?: number
}

export interface ToolCallStateWire {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'streaming' | 'pending_approval' | 'running' | 'completed' | 'error' | 'canceled'
  output?: string
  error?: string
  requiresApproval: boolean
  startedAt?: number
  completedAt?: number
}

export interface ToolUseBlockWire {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultWire {
  toolUseId: string
  content: string
  isError?: boolean
}

export interface RequestDebugInfoWire {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  timestamp: number
  providerId?: string
  providerBuiltinId?: string
  model?: string
  executionPath?: string
  transport?: string
  bodyRef?: string
  bodyBytes?: number
}

export type LoopEndReasonWire = 'completed' | 'max_iterations' | 'aborted' | 'error'

// ---- Event union ----

export type AgentStreamEvent =
  // Lifecycle
  | { type: 'loop_start' }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'iteration_end'; stopReason: string; toolResults?: ToolResultWire[] }
  | { type: 'loop_end'; reason: LoopEndReasonWire; messages?: unknown[] }
  // Text phase annotation (marks text before tool calls as planning)
  | { type: 'text_phase'; reason: 'pre_tool' }
  // Streaming deltas
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'thinking_encrypted'; content: string; provider: string }
  // Message completion
  | {
      type: 'message_end'
      usage?: TokenUsageWire
      timing?: RequestTimingWire
      providerResponseId?: string
      stopReason?: string
    }
  // Tool streaming (reserved for iteration 4)
  | { type: 'tool_use_streaming_start'; toolCallId: string; toolName: string; extraContent?: unknown }
  | { type: 'tool_use_args_delta'; toolCallId: string; partialInput: Record<string, unknown> }
  | { type: 'tool_use_generated'; toolUseBlock: ToolUseBlockWire }
  // Tool execution (reserved for iteration 4)
  | { type: 'tool_call_start'; toolCall: ToolCallStateWire }
  | { type: 'tool_call_update'; toolCall: ToolCallStateWire }
  | { type: 'tool_call_approval_needed'; toolCall: ToolCallStateWire }
  | { type: 'tool_call_result'; toolCall: ToolCallStateWire }
  // Extended streaming events (wishful-claw compatibility stubs)
  | { type: 'translation_buffer_update'; content: string }
  | { type: 'image_generation_started' }
  | { type: 'image_generation_partial'; imageBlock: unknown; partialImageIndex?: number }
  | { type: 'image_generated'; imageBlock: unknown }
  | { type: 'image_error'; imageError: { code: string; message: string } }
  | {
      type: 'web_search'
      content: string
      status?: 'searching' | 'completed'
      webSearchId?: string
      webSearchSources?: { url?: string; title?: string }[]
    }
  | { type: 'request_retry'; attempt: number; maxAttempts: number; delayMs: number; statusCode?: number; reason: string }
  // Error
  | { type: 'error'; message: string; errorType?: string; details?: string; stackTrace?: string }
  // Goal progress (orchestrator events)
  | {
      type: 'goal_progress'
      goalId: string
      sessionId: string
      eventType: string
      message: string
      status: string
      currentPlanIndex: number
      planCount: number
      completedPlans: number
      timestamp: number
    }
  // Debug / compression
  | { type: 'request_debug'; debugInfo: RequestDebugInfoWire }
  | {
      type: 'context_compression_started'
      operationId: string
      trigger?: 'auto' | 'manual'
      preTokens?: number
      originalCount?: number
      attempt?: number
      maxAttempts?: number
    }
  | {
      type: 'context_compression_start'
      operationId?: string
      trigger?: 'auto' | 'manual'
      preTokens?: number
      originalCount?: number
      attempt?: number
      maxAttempts?: number
    }
  | { type: 'context_compression_delta'; text: string }
  | {
      type: 'context_compressed'
      operationId?: string
      compressionStatus?: 'compressed' | 'skipped' | 'failed' | 'blocked' | 'cancelled'
      originalCount: number
      newCount: number
      keptMessageCount?: number
      trigger?: 'auto' | 'manual'
      preTokens?: number
      messagesSummarized?: number
      summarizerFailed?: boolean
      error?: string
      compactArtifacts?: unknown[]
      messages?: unknown[]
    }
  // Memory recall visibility
  | {
      type: 'memory_recall'
      reason: 'injected' | 'no_match' | 'filtered_by_threshold' | 'empty_message' | string
      recallCount?: number
      recallHits?: string[]
    }

export type AgentStreamEventType = AgentStreamEvent['type']

// ---- Event classification ----

/** Events that should be displayed in the chat stream. */
export const CHAT_STREAM_EVENTS: ReadonlySet<string> = new Set([
  'loop_start',
  'loop_end',
  'text_delta',
  'thinking_delta',
  'thinking_encrypted',
  'message_end',
  'error',
  'tool_call_start',
  'tool_call_result',
])

/** Events that should be displayed in the activity panel. */
export const ACTIVITY_PANEL_EVENTS: ReadonlySet<string> = new Set([
  'iteration_start',
  'iteration_end',
  'tool_use_streaming_start',
  'tool_use_args_delta',
  'tool_use_generated',
  'tool_call_start',
  'tool_call_result',
  'context_compression_started',
  'context_compression_start',
  'context_compression_delta',
  'context_compressed',
  'request_debug',
])

/** Events whose payloads can be aggregated (concatenated). */
export const AGGREGATABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'text_delta',
  'thinking_delta',
  'tool_use_args_delta',
])
