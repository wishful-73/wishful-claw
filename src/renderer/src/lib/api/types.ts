// 500 行豁免（2026-10-28，行数以实际为准）：37 个 `interface` / `type` 的纯类型表，无逻辑，属同一套
// 统一 API 类型系统的同质声明；拆开只会让「某个字段属于哪个类型」变成翻文件。
// 豁免依据：AGENTS.md §大文件拆分 第 5 条第 1 类（单一数据对象 / 同质数据）。

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
import type { LoopEndReasonWire } from '@shared/agent-stream-protocol'
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
  /**
   * 这一刀真实落下的时刻（epoch ms）。工件写进转写时 `createdAt` 会被
   * `adjustCompactArtifactTimestamps` 重定位到它的**归属位置**（为了 DB 排序），
   * 于是不再等于落刀时刻；改写前把真实值另存到这里，渲染层排段起点时优先用它。
   * 历史数据没有这个字段，渲染层回落到 clamp 兜底。
   */
  cutAt?: number
}

export interface CompactSummaryMeta {
  messagesSummarized: number
  recentMessagesPreserved: boolean
  /** Stable compression operation identity persisted with the summary artifact. */
  operationId?: string
  /** True when the LLM summarizer failed and a mechanical fallback digest was used. */
  summarizerFailed?: boolean
  /** S-269: why it failed — drives which fallback banner the chat renders. */
  summarizerFailureReason?: SummarizerFailureReason
  /**
   * S-208：压缩落刀的时刻（epoch ms），与正文里「【压缩时刻 · …】」那行同源。
   * 正文是发给模型的拼接结果，这几个字段才是给显示层的结构化数据。
   */
  compactedAt?: number
  /** S-208：被快照进摘要的那条用户消息的发送时刻（epoch ms）。取不到时缺省。 */
  latestUserSentAt?: number
  /** S-208：压缩那一刻那条用户消息的执行进度。见 `LatestUserState` 取值。 */
  latestUserState?: LatestUserState
  displayAnchor?: {
    assistantMessageId: string
    afterContentBlockCount: number
    afterToolUseId?: string
  }
  /** 与 `CompactBoundaryMeta.cutAt` 同义（同一刀的两个工件各存一份）。 */
  cutAt?: number
}

/**
 * S-208：压缩快照里那条用户消息在落刀时刻的执行进度。
 * 值由 Worker 侧按对话结构判定（后面有没有交卷的 assistant 轮），不是时间推算。
 */
export type LatestUserState =
  | '\u7528\u6237\u6d88\u606f\u5c1a\u672a\u5f00\u59cb\u6267\u884c'
  | '\u7528\u6237\u6d88\u606f\u6b63\u5728\u6267\u884c\u4e2d'
  | '\u7528\u6237\u6d88\u606f\u5df2\u7b54\u590d\u5b8c\u6bd5'

export type CompressionStatusState =
  | 'compressing'
  | 'compressed'
  | 'skipped'
  | 'failed'
  | 'blocked'
  | 'cancelled'

/**
 * S-269: why the summarizer fell back to a mechanical digest.
 *
 * Mirrors the `SummarizerFailureReason` field on the worker's `context_compressed`
 * event. `rate_limited` and `server_error` mean the provider refused the request
 * (429 / 5xx) — the summarizer itself is fine, so the UI must not claim it is
 * unavailable. `context_overflow` means the folded region was too large; the rest
 * are genuine summarizer-side failures.
 */
export type SummarizerFailureReason =
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'context_overflow'
  | 'empty_output'
  | 'other'

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
  /** S-269: why it failed — drives which fallback banner the chat renders. */
  summarizerFailureReason?: SummarizerFailureReason
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

/**
 * 这一轮怎么结束的（iter-40 S-210）—— 落库数据，不是文案。
 *
 * 由 worker 的 `loop_end` 事件带来，渲染端在收尾时写进 assistant 消息的
 * `meta.runEnd`，重载后照实显示；缺失（老消息 / 没收到事件）= 不知道，不编。
 */
export interface MessageRunEndMeta {
  reason: LoopEndReasonWire
  /** reason = 'error' 时 Worker 报的异常类型（如 HttpRequestException / TimeoutException）。 */
  errorType?: string
  /** reason = 'error' 时能归因到 HTTP 应答的状态码。 */
  statusCode?: number
  /** 收尾时刻（渲染端时钟）。 */
  at?: number
}

/**
 * 全局会话 ⇄ 项目会话的派发/回执标记（iter-v3-5 S-278）。
 *
 * **存在的理由**：派活和回执以前都是裸文本，渲染端只能靠正则嗅探
 * `[GLOBAL AGENT WORK REQUEST]` 才认得出「这条不是用户说的话」。S-208 已经把
 * 「结构化字段进 meta、正文只给人看」定成口径，这里是同一套东西的延续。
 *
 * 落库位置：`messages.meta.globalDispatch`。只有 `sendMessage` 会写它，
 * 且它**不进 Worker**（`sendMessage` 发请求前 delete 掉）—— 模型看的是消息正文，
 * 不是这里。
 */
export interface GlobalDispatchMeta {
  /** `global_task_dispatches.id`，渲染端拿它 join 状态。 */
  dispatchId: string
  globalTaskId: string
  /**
   * `work_request` = 全局会话派活；`message` = 普通沟通。与 DB 的
   * `GlobalTaskDispatchKindValues` 同值域，别另起一套。
   */
  kind: 'work_request' | 'message'
  /**
   * 派发那一刻的任务标题快照。任务后来改名**不改**历史消息 —— 卡片上写的
   * 应当是当时的事实。缺失（老消息 / 任务已被删）时卡片只显示 id。
   */
  globalTaskTitle?: string
}

export interface MessageMeta {
  compactBoundary?: CompactBoundaryMeta
  compactSummary?: CompactSummaryMeta
  selectedFileReads?: SelectedFileReadsMeta
  compressionStatus?: CompressionStatusMeta
  requestModel?: MessageRequestModelMeta
  runEnd?: MessageRunEndMeta
  cronTaskId?: string
  cronRunId?: string
  globalDispatch?: GlobalDispatchMeta
}

export interface UnifiedMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentBlock[]
  createdAt: number
  /** Last DB mutation time (assistant replies update on every persistence boundary). */
  updatedAt?: number
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
