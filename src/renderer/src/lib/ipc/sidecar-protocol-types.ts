import type {
  MessageMeta,
  ProviderConfig,
  TokenUsage,
  ToolDefinition,
  ToolResultContent,
  UnifiedMessage
} from '../api/types'
import type { ToolCallState } from '../agent/types'
import type { CompressionConfig } from '../agent/context-compression'
import { type PermissionPolicySnapshot } from '../../../../shared/permission-policy'

export interface SidecarTextBlock {
  type: 'text'
  text: string
}

export interface SidecarImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    mediaType?: string
    data?: string
    url?: string
    filePath?: string
  }
}

export interface SidecarToolCallExtraContent {
  google?: {
    thought_signature?: string
  }
  openaiResponses?: {
    computerUse?: {
      kind: 'computer_use'
      computerCallId: string
      computerActionType: string
      computerActionIndex: number
      autoAddedScreenshot?: boolean
    }
  }
}

export interface SidecarToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  extraContent?: SidecarToolCallExtraContent
}

export interface SidecarToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: ToolResultContent
  isError?: boolean
}

export interface SidecarThinkingBlock {
  type: 'thinking'
  thinking: string
  encryptedContent?: string
  encryptedContentProvider?: 'anthropic' | 'openai-responses' | 'google'
}

export interface SidecarAgentErrorBlock {
  type: 'agent_error'
  code: 'runtime_error' | 'tool_error' | 'unknown'
  message: string
  errorType?: string
  details?: string
  stackTrace?: string
}

export type SidecarContentBlock =
  | SidecarTextBlock
  | SidecarImageBlock
  | SidecarToolUseBlock
  | SidecarToolResultBlock
  | SidecarThinkingBlock
  | SidecarAgentErrorBlock

export interface SidecarUnifiedMessage {
  id: string
  role: UnifiedMessage['role']
  content: string | SidecarContentBlock[]
  createdAt: number
  usage?: TokenUsage
  providerResponseId?: string
  source?: UnifiedMessage['source']
  meta?: MessageMeta
}

export interface SidecarProviderConfig {
  type?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  contextLength?: number
  category?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  useSystemProxy?: boolean
  allowInsecureTls?: boolean
  thinkingEnabled?: boolean
  thinkingConfig?: ProviderConfig['thinkingConfig']
  reasoningEffort?: string
  providerId?: string
  providerBuiltinId?: string
  userAgent?: string
  sessionId?: string
  responsesSessionScope?: string
  serviceTier?: string
  enablePromptCache?: boolean
  enableSystemPromptCache?: boolean
  promptCacheKey?: string
  cacheTtl?: ProviderConfig['cacheTtl']
  requestOverrides?: ProviderConfig['requestOverrides']
  instructionsPrompt?: string
  responseSummary?: string
  responsesImageGeneration?: ProviderConfig['responsesImageGeneration']
  imageGenerationStream?: ProviderConfig['imageGenerationStream']
  computerUseEnabled?: boolean
  builtinSearchEnabled?: boolean
  organization?: string
  project?: string
  accountId?: string
  websocketUrl?: string
  websocketMode?: 'auto' | 'disabled'
}

export interface SidecarToolDefinition {
  name: string
  description: string
  inputSchema: ToolDefinition['inputSchema']
}

export interface SidecarWebSearchConfig {
  enabled: boolean
  provider:
    | 'tavily'
    | 'searxng'
    | 'exa'
    | 'exa-mcp'
    | 'bocha'
    | 'zhipu'
    | 'google'
    | 'bing'
    | 'baidu'
  apiKey?: string
  searchEngine?: string
  maxResults?: number
  timeout?: number
}

export interface SidecarTranslationContext {
  enabled: true
  sourceLanguage: string
  targetLanguage: string
}

export interface SidecarContextSource {
  sessionId: string
  maxMessages?: number
  compressionMode?: 'none' | 'auto' | 'force'
}

export interface SidecarPlanRevisionContext {
  title: string
  filePath?: string
  feedback?: string
}

export interface SidecarPlanExecutionContext {
  filePath?: string
  acp?: boolean
}

export interface SidecarSlashCommandContext {
  commandName: string
  rawArguments?: string
  parsedArguments?: string[]
}

export interface SidecarSystemCommandContext {
  name: string
  content: string
}

export interface SidecarPluginChannelContext {
  channelName?: string
  channelId: string
  chatId?: string
  chatType?: 'p2p' | 'group'
  senderId?: string
  senderName?: string
  availableTools?: string[]
  autoReply?: boolean
}

export interface SidecarAgentRunRequest {
  messages: SidecarUnifiedMessage[]
  contextSource?: SidecarContextSource
  liveOverlayMessages?: SidecarUnifiedMessage[]
  provider: SidecarProviderConfig
  /** Dedicated provider used only to summarize context during compression. */
  compressionProvider?: SidecarProviderConfig
  tools: SidecarToolDefinition[]
  subAgentToolCatalog?: SidecarToolDefinition[]
  webSearch?: SidecarWebSearchConfig
  imagePluginProvider?: SidecarProviderConfig
  /**
   * Provider config sub-agents (Task tool) run on. Sourced from the configured fast model
   * so delegated work uses the cheaper/faster model; the native worker prefers it over the
   * parent provider unless a per-call or agent-frontmatter model override is present. Falls
   * back to the main model when no distinct fast model is configured.
   */
  subAgentProvider?: SidecarProviderConfig
  runId?: string
  sessionId?: string
  projectId?: string
  workingFolder?: string
  scope?: 'global' | 'project'
  collaborationMode?: 'chat' | 'cowork'
  runtimeRole?: 'sessionAgent' | 'goalRunner' | 'subAgent' | 'goalSubAgent' | 'automation' | 'pet' | 'translation' | 'providerTurn'
  toolPreset?: string
  maxIterations: number
  forceApproval: boolean
  permissionMode: 'default' | 'whitelist' | 'fullAccess'
  maxParallelTools?: number
  maxToolCallsPerTurn?: number
  maxConcurrentSubAgents: number
  compression?: CompressionConfig
  sessionMode?: 'agent' | 'chat'
  planMode?: boolean
  planModeAllowedTools?: string[]
  permissionPolicy?: PermissionPolicySnapshot
  planRevision?: SidecarPlanRevisionContext
  planExecution?: SidecarPlanExecutionContext
  slashCommand?: SidecarSlashCommandContext
  systemCommand?: SidecarSystemCommandContext
  pluginChannelContext?: SidecarPluginChannelContext
  requestContextTexts?: string[]
  teamToolsActive?: boolean
  activeTeamName?: string
  goalRunSource?: 'user_turn' | 'continue'
  pluginId?: string
  pluginChatId?: string
  pluginChatType?: 'p2p' | 'group'
  pluginSenderId?: string
  pluginSenderName?: string
  callerAgent?: string
  sshConnectionId?: string
  captureFinalMessages?: boolean
  providerTurnOnly?: boolean
  includeFullDebugBody?: boolean
  translation?: SidecarTranslationContext
}

export interface SidecarApprovalRequest {
  runId?: string
  sessionId?: string
  toolCall: ToolCallState
}

export interface SidecarApprovalResponse {
  approved: boolean
  reason?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

