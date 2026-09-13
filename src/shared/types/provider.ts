/**
 * Provider core type definitions.
 * Shared between renderer, preload, and main process.
 *
 * Aligned with WishfulClaw's type system — API Key mode only (no OAuth/channel).
 * All request-protocol, caching, compression, and tool-capability fields preserved.
 */

// ─── Provider Types ───

export type ProviderType =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'openai-images'
  | 'seedance-video'
  | 'xai-video'
  | 'gemini'
  | 'vertex-ai'

export type ModelCategory = 'chat' | 'speech' | 'embedding' | 'image' | 'video'

export type ResponseSummary = 'auto' | 'concise' | 'detailed'

export type ServiceTier = 'auto' | 'default' | 'flex' | 'priority'

export type AuthMode = 'apiKey' | 'oauth' | 'channel'

export type ReasoningEffortLevel =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

// ─── Responses Image Generation ───

export type ResponsesImageGenerationAction = 'auto' | 'generate' | 'edit'
export type ResponsesImageGenerationBackground = 'auto' | 'transparent' | 'opaque'
export type ResponsesImageGenerationInputFidelity = 'low' | 'high'
export type ResponsesImageGenerationModeration = 'auto' | 'low'
export type ResponsesImageGenerationOutputFormat = 'png' | 'webp' | 'jpeg'
export type ResponsesImageGenerationQuality = 'auto' | 'low' | 'medium' | 'high'
export type ResponsesImageGenerationSize = 'auto' | '1024x1024' | '1024x1536' | '1536x1024'

export interface ResponsesImageGenerationInputMask {
  fileId?: string
  imageUrl?: string
}

export interface ResponsesImageGenerationConfig {
  enabled?: boolean
  action?: ResponsesImageGenerationAction
  background?: ResponsesImageGenerationBackground
  inputFidelity?: ResponsesImageGenerationInputFidelity
  inputImageMask?: ResponsesImageGenerationInputMask
  moderation?: ResponsesImageGenerationModeration
  outputCompression?: number
  outputFormat?: ResponsesImageGenerationOutputFormat
  partialImages?: number
  quality?: ResponsesImageGenerationQuality
  size?: ResponsesImageGenerationSize
}

export interface ImageGenerationStreamConfig {
  enabled?: boolean
  partialImages?: number
}

// ─── Thinking Config ───

export interface ThinkingConfig {
  /** Extra key-value pairs merged into the request body when thinking is enabled */
  bodyParams: Record<string, unknown>
  /** Extra key-value pairs merged into the request body when thinking is explicitly disabled */
  disabledBodyParams?: Record<string, unknown>
  /** Force-override temperature when thinking is active (e.g. Anthropic requires 1) */
  forceTemperature?: number
  /**
   * Available reasoning effort levels for this model.
   * When set, the UI shows a level selector instead of a simple toggle.
   */
  reasoningEffortLevels?: ReasoningEffortLevel[]
  /** Default reasoning effort level when thinking is first enabled */
  defaultReasoningEffort?: ReasoningEffortLevel
}

// ─── Request Overrides ───

export interface RequestOverrides {
  /** Extra headers to include with API requests */
  headers?: Record<string, string>
  /** Body key-value overrides merged into the request body */
  body?: Record<string, unknown>
  /** Body keys to omit from the final payload */
  omitBodyKeys?: string[]
}

// ─── Provider UI Config ───

export interface ProviderUiConfig {
  /** Hide OAuth settings fields and related hints in the UI */
  hideOAuthSettings?: boolean
}

// ─── OAuth ───

export type OAuthFlowType = 'authorization_code' | 'device_code'
export type OAuthRequestMode = 'form' | 'json'

export interface OAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientIdLocked?: boolean
  scope?: string
  flowType?: OAuthFlowType
  /** Base GitHub / OAuth host, used to derive endpoints when individual URLs are not overridden */
  host?: string
  /** API host used for token exchange endpoints (e.g. https://api.github.com or GHE api/v3) */
  apiHost?: string
  /** Device code endpoint for OAuth device flow */
  deviceCodeUrl?: string
  /** Copilot / provider-specific token exchange endpoint used after OAuth login */
  tokenExchangeUrl?: string
  /** Use system proxy for OAuth token exchanges */
  useSystemProxy?: boolean
  includeScopeInTokenRequest?: boolean
  tokenRequestMode?: OAuthRequestMode
  tokenRequestHeaders?: Record<string, string>
  refreshRequestMode?: OAuthRequestMode
  refreshRequestHeaders?: Record<string, string>
  refreshScope?: string
  deviceCodeRequestMode?: OAuthRequestMode
  deviceCodeRequestHeaders?: Record<string, string>
  redirectPath?: string
  redirectPort?: number
  extraParams?: Record<string, string>
  usePkce?: boolean
}

export interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
  accountId?: string
  idToken?: string
  deviceId?: string
  copilotAccessToken?: string
  copilotTokenType?: string
  copilotExpiresAt?: number
  copilotRefreshAt?: number
  copilotApiUrl?: string
  copilotChatEnabled?: boolean
  copilotSku?: string
  copilotTelemetry?: string
}

export interface AccountRateLimit {
  /** When the rate-limit was first observed (epoch ms) */
  limitedAt: number
  /** When the rate-limit window is expected to reset (epoch ms). Accounts auto-revive once now >= resetAt. */
  resetAt: number
  /** Origin of the rate-limit marker */
  reason: 'http-429' | 'codex-quota'
  /** For Codex quota markers, which window saturated */
  windowType?: 'primary' | 'secondary'
  /** Human-readable detail (shown in UI tooltip) */
  message?: string
}

export interface ProviderOAuthAccount {
  /** Stable UUID used as the account key */
  id: string
  /** Required — primary display label and dedup key on import */
  email: string
  /** Optional user-friendly nickname */
  label?: string
  oauth: OAuthToken
  /** Set when the account is temporarily rate-limited; cleared once resetAt elapses */
  rateLimit?: AccountRateLimit
  createdAt: number
  lastUsedAt?: number
}

// ─── Channel Auth ───

export interface ChannelConfig {
  vcodeUrl: string
  tokenUrl: string
  userUrl: string
  defaultChannelType?: 'sms' | 'email'
  requiresAppToken?: boolean
  defaultAppId?: string
  appIdLocked?: boolean
}

export interface ChannelAuth {
  appId: string
  appToken?: string
  accessToken?: string
  accessTokenExpiresAt?: number
  channelType?: 'sms' | 'email'
  userInfo?: Record<string, unknown>
}

// ─── AI Model Config ───

export interface AIModelConfig {
  id: string
  name: string
  enabled: boolean
  /** Optional protocol override for this model; falls back to provider.type when omitted */
  type?: ProviderType
  /** How this model should be used (chat, speech, embedding, image, video) */
  category?: ModelCategory
  /** Icon key for model-level icon (e.g. 'openai', 'claude', 'gemini', 'deepseek') */
  icon?: string
  contextLength?: number
  /** Allow context compression to use the model's full configured context length when it exceeds 200K */
  enableExtendedContextCompression?: boolean
  /** Full context compression trigger ratio, clamped to 0.3 ~ 0.9 */
  contextCompressionThreshold?: number
  maxOutputTokens?: number
  /** Price per million input tokens (USD) */
  inputPrice?: number
  /** Price per million output tokens (USD) */
  outputPrice?: number
  /** Price per million tokens for cache creation/write (USD) */
  cacheCreationPrice?: number
  /** Price per million tokens for cache hit/read (USD) */
  cacheHitPrice?: number
  /** GitHub Copilot premium request multiplier */
  premiumRequestMultiplier?: number
  /** Plans that commonly expose this model in Copilot */
  availablePlans?: string[]
  /** Whether the model supports image/vision input */
  supportsVision?: boolean
  /** Whether the model supports function/tool calling */
  supportsFunctionCall?: boolean
  /** Whether the model supports toggleable thinking/reasoning mode */
  supportsThinking?: boolean
  /** Whether the model supports audio input/output */
  audio?: boolean
  /** Whether the model supports OpenAI Computer Use via the Responses API */
  supportsComputerUse?: boolean
  /** Whether Computer Use is enabled for this model */
  enableComputerUse?: boolean
  /**
   * Whether this model supports the provider's built-in/native web search server tool
   * (Anthropic `web_search_20250305`, OpenAI Responses `web_search`). Defaults to false.
   */
  supportsBuiltinSearch?: boolean
  /**
   * Whether the provider's built-in/native web search tool is enabled for this model.
   * Only effective when `supportsBuiltinSearch` is true.
   */
  enableBuiltinSearch?: boolean
  /** Whether this model supports the OpenAI Responses WebSocket transport. Defaults to false. */
  supportsWebsocket?: boolean
  /**
   * Whether this model supports the OpenAI Responses `image_generation` server tool.
   * Defaults to false; the tool is only injected when this is true.
   */
  supportsImageGeneration?: boolean
  /** Configuration describing how to enable thinking for this model */
  thinkingConfig?: ThinkingConfig
  /** OpenAI Responses: summary of reasoning (auto/concise/detailed) */
  responseSummary?: ResponseSummary
  /** OpenAI Responses: image_generation tool configuration */
  responsesImageGeneration?: ResponsesImageGenerationConfig
  /** OpenAI-compatible endpoints: enable prompt caching with the app-global cache key */
  enablePromptCache?: boolean
  /** Anthropic: enable system prompt caching */
  enableSystemPromptCache?: boolean
  /** Anthropic: cache TTL duration — '5m' (default) or '1h' (requires extended-cache-ttl beta) */
  cacheTtl?: '5m' | '1h'
  /** Optional request overrides applied only to this model */
  requestOverrides?: RequestOverrides
  /** OpenAI-compatible service tier (e.g. priority). Effective when fast mode is enabled. */
  serviceTier?: ServiceTier
  /** OpenAI Responses WebSocket endpoint override for this model */
  websocketUrl?: string
  /** OpenAI Responses transport mode for this model */
  websocketMode?: 'auto' | 'disabled'
}

// ─── AI Provider ───

export interface AIProvider {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  baseUrl: string
  /** Optional official website for this provider */
  homepage?: string
  enabled: boolean
  models: AIModelConfig[]
  builtinId?: string
  /** Built-in preset version most recently applied to this persisted provider. */
  presetVersion?: number
  createdAt: number
  /** Whether this provider requires an API key. Defaults to true when omitted. */
  requiresApiKey?: boolean
  /** Whether to route API requests via the system proxy */
  useSystemProxy?: boolean
  /** Whether to skip TLS certificate validation for this provider's agent requests */
  allowInsecureTls?: boolean
  /** Whether requests include the temperature parameter. Defaults to true when omitted. */
  sendTemperature?: boolean
  /** Whether requests include the max output tokens parameter. Defaults to true when omitted. */
  sendMaxOutputTokens?: boolean
  /** Custom User-Agent header (e.g. Moonshot套餐 requires 'RooCode/3.48.0') */
  userAgent?: string
  /** Default model ID to use when this provider is first selected */
  defaultModel?: string
  /** Authentication mode for this provider */
  authMode?: AuthMode
  /** OAuth token payload (if authMode === 'oauth') */
  oauth?: OAuthToken
  /** Multi-account list. Priority order = array order. First entry is the default. */
  oauthAccounts?: ProviderOAuthAccount[]
  /** Currently selected account id. Falls back to the first usable entry in oauthAccounts. */
  activeAccountId?: string
  /** OAuth configuration for this provider */
  oauthConfig?: OAuthConfig
  /** Channel auth data (if authMode === 'channel') */
  channel?: ChannelAuth
  /** Channel auth configuration */
  channelConfig?: ChannelConfig
  /** Optional request overrides (headers/body) for this provider */
  requestOverrides?: RequestOverrides
  /** Optional prompt name to use for Responses instructions */
  instructionsPrompt?: string
  /** Optional UI configuration for this provider */
  ui?: ProviderUiConfig
  /** OpenAI Responses WebSocket endpoint override for this provider */
  websocketUrl?: string
  /** OpenAI Responses transport mode for this provider */
  websocketMode?: 'auto' | 'disabled'
  /** Anthropic: cache TTL duration — '5m' (default) or '1h'. Model-level overrides provider-level. */
  cacheTtl?: '5m' | '1h'
}

// ─── Builtin Provider Preset ───

export interface BuiltinProviderPreset {
  builtinId: string
  /** Monotonic preset version. Increment when built-in values should replace persisted config. */
  version: number
  name: string
  type: ProviderType
  defaultBaseUrl: string
  defaultModels: AIModelConfig[]
  deprecatedModelIds?: string[]
  defaultEnabled?: boolean
  requiresApiKey?: boolean
  homepage: string
  /** Link for users to create/manage API keys */
  apiKeyUrl?: string
  /** Whether to route API requests via the system proxy */
  useSystemProxy?: boolean
  /** Custom User-Agent header for providers that require platform identification */
  userAgent?: string
  /** Default model ID to use when this provider is first selected */
  defaultModel?: string
  /** Authentication mode for this provider */
  authMode?: AuthMode
  /** OAuth configuration (when authMode === 'oauth') */
  oauthConfig?: OAuthConfig
  /** Channel auth configuration (when authMode === 'channel') */
  channelConfig?: ChannelConfig
  /** Optional request overrides (headers/body) for this provider */
  requestOverrides?: RequestOverrides
  /** Optional prompt name to use for Responses instructions */
  instructionsPrompt?: string
  /** Optional UI configuration for this provider */
  ui?: ProviderUiConfig
  /** OpenAI Responses WebSocket endpoint override for this provider preset */
  websocketUrl?: string
  /** OpenAI Responses transport mode for this provider preset; unset means disabled (opt-in) */
  websocketMode?: 'auto' | 'disabled'
}

// ─── Provider Test / Fetch Results ───

export interface ProviderTestResult {
  ok: boolean
  statusCode?: number
  error?: string
}

export interface ProviderFetchModelsResult {
  ok: boolean
  models?: AIModelConfig[]
  error?: string
}
