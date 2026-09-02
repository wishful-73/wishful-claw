// ===== Unified API Type System =====
// Import types locally for use in this file
import type {
  ProviderType,
  ModelCategory,
  ResponseSummary,
  ReasoningEffortLevel,
  ResponsesImageGenerationConfig,
  ThinkingConfig,
  RequestOverrides,
  ImageGenerationStreamConfig
} from '@shared/types/provider'
// Re-export shared provider types so WishfulClaw imports (`@renderer/lib/api/types`) work.
export type {
  ProviderType,
  ModelCategory,
  ResponseSummary,
  ServiceTier,
  AuthMode,
  ReasoningEffortLevel,
  ResponsesImageGenerationAction,
  ResponsesImageGenerationBackground,
  ResponsesImageGenerationConfig,
  ResponsesImageGenerationInputMask,
  ResponsesImageGenerationInputFidelity,
  ResponsesImageGenerationModeration,
  ResponsesImageGenerationOutputFormat,
  ResponsesImageGenerationQuality,
  ResponsesImageGenerationSize,
  ThinkingConfig,
  AIModelConfig,
  AIProvider,
  BuiltinProviderPreset,
  OAuthToken,
  OAuthConfig,
  ProviderOAuthAccount,
  ChannelAuth,
  ChannelConfig,
  RequestOverrides,
  ProviderUiConfig
} from '@shared/types/provider'

// Also re-export for convenience
export type {
  ImageGenerationStreamConfig,
  OAuthFlowType,
  OAuthRequestMode,
  AccountRateLimit
} from '@shared/types/provider'

// --- Plugin Permissions ---
export interface PluginPermissions {
  [key: string]: unknown
}

// --- Token Usage ---

export interface RequestTiming {
  /** Total request duration in milliseconds (request start → message_end). */
  totalMs: number
  /** Time to first token in milliseconds (request start → first streamed content). */
  ttftMs?: number
  /** Output tokens per second, calculated from streamed output. */
  tps?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Normalized non-cached input tokens used for pricing/display when available. */
  billableInputTokens?: number
  /** Prompt-cache tokens written to cache (Anthropic cache_creation*, OpenAI cache_write_tokens). */
  cacheCreationTokens?: number
  /** Anthropic prompt caching: tokens written to 5m cache */
  cacheCreation5mTokens?: number
  /** Anthropic prompt caching: tokens written to 1h cache */
  cacheCreation1hTokens?: number
  /** Prompt-cache tokens read from cache (OpenAI cached_tokens). */
  cacheReadTokens?: number
  /** cacheReadTokens / inputTokens for the normalized request usage. */
  cacheReadRatio?: number
  /** Reasoning model (o3/o4-mini etc.) internal thinking tokens */
  reasoningTokens?: number
  /** Last API call's input tokens — represents current context window usage (not accumulated) */
  contextTokens?: number
  /** Effective context limit used for compression/runtime budgeting on this request */
  contextLength?: number
  /** Total wall time for the full agent run (including tools), in ms. */
  totalDurationMs?: number
  /** Per-request timing metrics for each API call in the loop. */
  requestTimings?: RequestTiming[]
}

// --- Content Blocks ---

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    mediaType?: string
    data?: string
    url?: string
    filePath?: string
  }
}

export type ImageErrorCode = 'timeout' | 'network' | 'request_aborted' | 'api_error' | 'unknown'

export interface ImageErrorBlock {
  type: 'image_error'
  code: ImageErrorCode
  message: string
}

export type AgentErrorCode = 'runtime_error' | 'tool_error' | 'unknown'

export interface AgentErrorBlock {
  type: 'agent_error'
  code: AgentErrorCode
  message: string
  errorType?: string
  details?: string
  stackTrace?: string
}

export type OpenAIComputerActionType =
  | 'click'
  | 'double_click'
  | 'scroll'
  | 'keypress'
  | 'type'
  | 'wait'
  | 'screenshot'

export interface ToolCallExtraContent {
  google?: {
    thought_signature?: string
  }
  openaiResponses?: {
    computerUse?: {
      kind: 'computer_use'
      computerCallId: string
      computerActionType: OpenAIComputerActionType
      computerActionIndex: number
      autoAddedScreenshot?: boolean
    }
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  extraContent?: ToolCallExtraContent
}

/**
 * Placeholder stored in a persisted Write/Edit tool_use input field when the
 * original string was too large to keep resident in renderer memory. The full
 * payload is still present in the SQLite message row and can be rehydrated on
 * demand.
 */
export interface ElidedToolInput {
  __elided: true
  bytes: number
}

export function isElidedToolInput(value: unknown): value is ElidedToolInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __elided?: unknown }).__elided === true
  )
}

export type ToolResultContent = string | Array<TextBlock | ImageBlock>

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: ToolResultContent
  isError?: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  /** Provider-issued encrypted/signature payload for reasoning continuity validation */
  encryptedContent?: string
  /** Which provider emitted encryptedContent (used to replay only to compatible APIs) */
  encryptedContentProvider?: 'anthropic' | 'openai-responses' | 'google'
  startedAt?: number
  completedAt?: number
}

/** A source consulted by a provider-native web search. */
export interface WebSearchSource {
  url?: string
  title?: string
}

/** Display-only marker for a provider-native web search the model ran server-side. */
export interface WebSearchBlock {
  type: 'web_search'
  /** Correlates the live "searching" update with the resolved "completed" one. */
  id?: string
  status?: 'searching' | 'completed'
  query: string
  sources?: WebSearchSource[]
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ImageErrorBlock
  | AgentErrorBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | WebSearchBlock

// --- Messages ---

export interface RequestDebugInfo {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  bodyRef?: string
  bodyBytes?: number
  contextWindowBody?: string
  timestamp: number
  providerId?: string
  providerBuiltinId?: string
  model?: string
  executionPath?: string
  transport?: string
  fallbackReason?: string
  reusedConnection?: boolean
  websocketRequestKind?: 'warmup' | 'full' | 'incremental'
  websocketIncrementalReason?: string
  previousResponseId?: string
  promptCacheKeyHash?: string
  systemHash?: string
  toolsHash?: string
  messagePrefixHash?: string
  toolCount?: number
  cacheReadRatio?: number
}

export interface CompactBoundarySegment {
  headId: string
  anchorId: string
  tailId: string
}

export interface CompactBoundaryMeta {
  trigger: 'auto' | 'manual'
  preTokens: number
  messagesSummarized: number
  preservedSegment?: CompactBoundarySegment
}

export interface CompactSummaryMeta {
  messagesSummarized: number
  recentMessagesPreserved: boolean
  /** True when the LLM summarizer failed and a mechanical fallback digest was used. */
  summarizerFailed?: boolean
  displayAnchor?: {
    assistantMessageId: string
    afterContentBlockCount: number
    afterToolUseId?: string
  }
}

export type CompressionStatusState =
  | 'compressing'
  | 'compressed'
  | 'skipped'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface CompressionStatusMeta {
  /** Stable key shared by started and terminal updates for one compression operation. */
  operationId?: string
  state: CompressionStatusState
  startedAt: number
  completedAt?: number
  keptMessageCount?: number
  preTokens?: number
  newCount?: number
  originalCount?: number
  /** What triggered the compression — auto threshold or user action. */
  trigger?: 'auto' | 'manual'
  /** Number of older messages folded into the summary. */
  messagesSummarized?: number
  /** True when the LLM summarizer failed and a mechanical fallback digest was used. */
  summarizerFailed?: boolean
  /** Final safe error/reason shown for failed, blocked, skipped, or cancelled operations. */
  error?: string
  /** Complete summary text copied from the compact summary artifact for card expansion. */
  summaryText?: string
  /** Stable compact summary artifact id, when one was produced. */
  summaryMessageId?: string
  /** Inline position used when compression starts during an active assistant run. */
  displayAnchor?: {
    assistantMessageId: string
    afterContentBlockCount: number
    afterToolUseId?: string
  }
}

export interface SelectedFileReference {
  id: string
  name: string
  originalPath: string
  sendPath: string
  previewPath: string
  isWorkspaceFile: boolean
}

export interface SelectedFileReadItemMeta {
  id?: string
  name: string
  path: string
  readPath?: string
  lineCount: number
  maxLines: number
  truncated: boolean
  skipped?: boolean
  skipReason?: string
  error?: string
}

export interface SelectedFileReadsMeta {
  maxLines: number
  files: SelectedFileReadItemMeta[]
}

export interface MessageRequestModelMeta {
  providerId?: string | null
  providerName?: string | null
  providerBuiltinId?: string | null
  modelId?: string | null
  modelName?: string | null
  modelIcon?: string | null
}

export interface MessageMeta {
  compactBoundary?: CompactBoundaryMeta
  compactSummary?: CompactSummaryMeta
  selectedFileReads?: SelectedFileReadsMeta
  compressionStatus?: CompressionStatusMeta
  requestModel?: MessageRequestModelMeta
  cronTaskId?: string
  cronRunId?: string
}

export interface UnifiedMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentBlock[]
  createdAt: number
  usage?: TokenUsage
  debugInfo?: RequestDebugInfo
  providerResponseId?: string
  source?: 'team' | 'queued' | 'quoted'
  meta?: MessageMeta
  /** Text generated before tool execution (planning phase, rendered dimmed). */
  preToolPhase?: boolean
  /** Memory recall outcome for this turn: reason + injected entry titles. */
  memoryRecall?: { reason: string; hits: string[] }
  _revision?: number
}

// --- Streaming Events ---

export type StreamEventType =
  | 'message_start'
  | 'text_delta'
  | 'thinking_delta'
  | 'thinking_encrypted'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'image_generation_started'
  | 'image_generation_partial'
  | 'image_generated'
  | 'image_error'
  | 'message_end'
  | 'error'
  | 'request_debug'

export interface StreamEvent {
  type: StreamEventType
  text?: string
  thinking?: string
  thinkingEncryptedContent?: string
  thinkingEncryptedProvider?: string
  toolCallId?: string
  toolName?: string
  argumentsDelta?: string
  toolCallInput?: Record<string, unknown>
  toolCallExtraContent?: ToolCallExtraContent
  partialImageIndex?: number
  imageBlock?: ImageBlock
  imageError?: { code: ImageErrorCode; message: string }
  stopReason?: string
  usage?: TokenUsage
  timing?: RequestTiming
  providerResponseId?: string
  error?: { type: string; message: string }
  debugInfo?: RequestDebugInfo
}

// --- Tool Definitions ---

export interface ToolDefinition {
  name: string
  description: string
  category?: string
  priority?: number
  inputSchema:
    | {
        type: 'object'
        properties: Record<string, unknown>
        required?: string[]
        additionalProperties?: boolean
      }
    | {
        type: 'object'
        oneOf: Array<{
          type: 'object'
          properties: Record<string, unknown>
          required?: string[]
          additionalProperties?: boolean
        }>
      }
}

// --- Provider Config (renderer-side, for agent loop) ---

export interface ProviderConfig {
  type?: ProviderType
  apiKey?: string
  baseUrl?: string
  model?: string
  contextLength?: number
  category?: ModelCategory
  providerId?: string
  providerBuiltinId?: string
  serviceTier?: 'priority'
  /** Request timeout in seconds (0 = no limit). Passed through to the sidecar. */
  requestTimeoutSeconds?: number
  /** Max retry attempts on 429/5xx (0 = unlimited). Passed through to the sidecar. */
  requestMaxRetries?: number
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  requiresApiKey?: boolean
  useSystemProxy?: boolean
  allowInsecureTls?: boolean
  thinkingEnabled?: boolean
  thinkingConfig?: ThinkingConfig
  reasoningEffort?: ReasoningEffortLevel
  sessionId?: string
  responsesSessionScope?: string
  responseSummary?: ResponseSummary
  responsesImageGeneration?: ResponsesImageGenerationConfig
  imageGenerationStream?: ImageGenerationStreamConfig
  enablePromptCache?: boolean
  promptCacheKey?: string
  computerUseEnabled?: boolean
  builtinSearchEnabled?: boolean
  enableSystemPromptCache?: boolean
  cacheTtl?: '5m' | '1h'
  userAgent?: string
  requestOverrides?: RequestOverrides
  instructionsPrompt?: string
  organization?: string
  project?: string
  accountId?: string
  websocketUrl?: string
  websocketMode?: 'auto' | 'disabled'
}


// ─── Note: ProviderType, ModelCategory, ThinkingConfig, etc. are re-exported from @shared/types/provider above ───
