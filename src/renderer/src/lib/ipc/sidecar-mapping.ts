
import { normalizeSidecarRecord, normalizeMaxParallelTools, normalizePlanRevision, normalizePlanExecution, normalizeSlashCommand, normalizeSystemCommand, normalizePluginChannelContext, normalizeRequestContextTexts, isNativeSidecarProviderConfig, SidecarProviderInput, sanitizeSidecarToolInput } from './sidecar-protocol'
import { toPermissionPolicySnapshot } from '../../../../shared/permission-policy'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { clampMaxConcurrentSubAgents } from '../../stores/settings-store'
import { CompressionConfig } from '../agent/context-compression-config'
import { resolveProviderUserAgent } from '../api/api-user-agent'
import { ContentBlock, MessageMeta, ProviderConfig, ToolDefinition, UnifiedMessage } from '../api/types'
import { SidecarAgentRunRequest, SidecarApprovalRequest, SidecarContentBlock, SidecarContextSource, SidecarPlanExecutionContext, SidecarPlanRevisionContext, SidecarPluginChannelContext, SidecarProviderConfig, SidecarSlashCommandContext, SidecarSystemCommandContext, SidecarToolDefinition, SidecarTranslationContext, SidecarUnifiedMessage, SidecarWebSearchConfig } from './sidecar-protocol-types'

export function mapSidecarContentBlock(block: ContentBlock): SidecarContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image':
      if (block.source.type !== 'base64' && block.source.type !== 'url') {
        return {
          type: 'text',
          text: block.source.filePath
            ? `[image] ${block.source.filePath}`
            : block.source.url
              ? `[image] ${block.source.url}`
              : '[image omitted: unsupported source]'
        }
      }
      return {
        type: 'image',
        source: {
          type: block.source.type,
          ...(block.source.mediaType ? { mediaType: block.source.mediaType } : {}),
          ...(block.source.data ? { data: block.source.data } : {}),
          ...(block.source.url ? { url: block.source.url } : {}),
          ...(block.source.filePath ? { filePath: block.source.filePath } : {})
        }
      }
    case 'image_error':
      return {
        type: 'text',
        text: `[image_error:${block.code}] ${block.message}`
      }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
        ...(block.extraContent ? { extraContent: block.extraContent } : {})
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.toolUseId,
        content: block.content,
        ...(block.isError ? { isError: true } : {})
      }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        ...(block.encryptedContent ? { encryptedContent: block.encryptedContent } : {}),
        ...(block.encryptedContentProvider
          ? { encryptedContentProvider: block.encryptedContentProvider }
          : {})
      }
    case 'agent_error':
      return {
        type: 'agent_error',
        code: block.code,
        message: block.message,
        ...(block.errorType ? { errorType: block.errorType } : {}),
        ...(block.details ? { details: block.details } : {}),
        ...(block.stackTrace ? { stackTrace: block.stackTrace } : {})
      }
    default:
      return null
  }
}

export function sanitizeSidecarMessageMeta(meta: MessageMeta | undefined): MessageMeta | undefined {
  if (!meta) return undefined
  if (!meta.compactSummary?.displayAnchor) return meta

  const { displayAnchor: _displayAnchor, ...compactSummary } = meta.compactSummary
  return {
    ...meta,
    compactSummary
  }
}

export function mapSidecarMessage(message: UnifiedMessage): SidecarUnifiedMessage | null {
  const meta = sanitizeSidecarMessageMeta(message.meta)

  if (typeof message.content === 'string') {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.usage ? { usage: message.usage } : {}),
      ...(message.providerResponseId ? { providerResponseId: message.providerResponseId } : {}),
      ...(message.source ? { source: message.source } : {}),
      ...(meta ? { meta } : {})
    }
  }

  const content: SidecarContentBlock[] = []
  for (const block of message.content) {
    const mapped = mapSidecarContentBlock(block)
    if (!mapped) continue
    content.push(mapped)
  }

  return {
    id: message.id,
    role: message.role,
    content: content.length > 0 ? content : '[empty content omitted during sidecar normalization]',
    createdAt: message.createdAt,
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.providerResponseId ? { providerResponseId: message.providerResponseId } : {}),
    ...(message.source ? { source: message.source } : {}),
    ...(meta ? { meta } : {})
  }
}

export function mapSidecarProvider(provider: SidecarProviderInput): SidecarProviderConfig {
  return {
    type: provider.type,
    apiKey: provider.apiKey,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    model: provider.model,
    ...(provider.contextLength !== undefined ? { contextLength: provider.contextLength } : {}),
    ...(provider.category ? { category: provider.category } : {}),
    ...(provider.maxTokens !== undefined ? { maxTokens: provider.maxTokens } : {}),
    ...(provider.temperature !== undefined ? { temperature: provider.temperature } : {}),
    ...(provider.systemPrompt ? { systemPrompt: provider.systemPrompt } : {}),
    ...(provider.useSystemProxy !== undefined ? { useSystemProxy: provider.useSystemProxy } : {}),
    ...(provider.allowInsecureTls !== undefined
      ? { allowInsecureTls: provider.allowInsecureTls }
      : {}),
    ...(provider.thinkingEnabled !== undefined
      ? { thinkingEnabled: provider.thinkingEnabled }
      : {}),
    ...(provider.thinkingConfig ? { thinkingConfig: provider.thinkingConfig } : {}),
    ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
    ...(provider.requestTimeoutSeconds !== undefined
      ? { requestTimeoutSeconds: provider.requestTimeoutSeconds }
      : {}),
    ...(provider.requestMaxRetries !== undefined
      ? { requestMaxRetries: provider.requestMaxRetries }
      : {}),
    ...(provider.providerId ? { providerId: provider.providerId } : {}),
    ...(provider.providerBuiltinId ? { providerBuiltinId: provider.providerBuiltinId } : {}),
    userAgent: resolveProviderUserAgent(provider.userAgent),
    ...(provider.sessionId ? { sessionId: provider.sessionId } : {}),
    ...(provider.responsesSessionScope
      ? { responsesSessionScope: provider.responsesSessionScope }
      : {}),
    ...(provider.serviceTier ? { serviceTier: provider.serviceTier } : {}),
    ...(provider.enablePromptCache !== undefined
      ? { enablePromptCache: provider.enablePromptCache }
      : {}),
    ...(provider.enableSystemPromptCache !== undefined
      ? { enableSystemPromptCache: provider.enableSystemPromptCache }
      : {}),
    ...(provider.promptCacheKey ? { promptCacheKey: provider.promptCacheKey } : {}),
    ...(provider.cacheTtl ? { cacheTtl: provider.cacheTtl } : {}),
    ...(provider.requestOverrides ? { requestOverrides: provider.requestOverrides } : {}),
    ...(provider.instructionsPrompt ? { instructionsPrompt: provider.instructionsPrompt } : {}),
    ...(provider.responseSummary ? { responseSummary: provider.responseSummary } : {}),
    ...(provider.responsesImageGeneration
      ? { responsesImageGeneration: provider.responsesImageGeneration }
      : {}),
    ...(provider.imageGenerationStream
      ? { imageGenerationStream: provider.imageGenerationStream }
      : {}),
    ...(provider.computerUseEnabled !== undefined
      ? { computerUseEnabled: provider.computerUseEnabled }
      : {}),
    ...(provider.builtinSearchEnabled !== undefined
      ? { builtinSearchEnabled: provider.builtinSearchEnabled }
      : {}),
    ...(provider.organization ? { organization: provider.organization } : {}),
    ...(provider.project ? { project: provider.project } : {}),
    ...(provider.accountId ? { accountId: provider.accountId } : {}),
    ...(provider.websocketUrl ? { websocketUrl: provider.websocketUrl } : {}),
    ...(provider.websocketMode ? { websocketMode: provider.websocketMode } : {})
  }
}

function mapSidecarTool(tool: ToolDefinition): SidecarToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
}

export function mapSidecarWebSearchConfig(tools: ToolDefinition[]): SidecarWebSearchConfig | undefined {
  if (!tools.some((tool) => tool.name === 'WebSearch' || tool.name === 'WebFetch')) {
    return undefined
  }

  const settings = useSettingsStore.getState()
  if (!settings.webSearchEnabled) return undefined
  return {
    enabled: true,
    provider: settings.webSearchProvider,
    ...(settings.webSearchApiKey ? { apiKey: settings.webSearchApiKey } : {}),
    ...(settings.webSearchEngine ? { searchEngine: settings.webSearchEngine } : {}),
    maxResults: settings.webSearchMaxResults,
    timeout: settings.webSearchTimeout
  }
}

export function buildSidecarAgentRunRequest(args: {
  messages: UnifiedMessage[]
  provider: ProviderConfig
  tools: ToolDefinition[]
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
  permissionMode?: 'default' | 'whitelist' | 'fullAccess'
  maxParallelTools?: number
  maxToolCallsPerTurn?: number
  compression?: CompressionConfig | null
  imagePluginProvider?: ProviderConfig | null
  sessionMode?: 'normal' | 'agent' | 'chat'
  planMode?: boolean
  planModeAllowedTools?: readonly string[]
  planRevision?: SidecarPlanRevisionContext | null
  planExecution?: SidecarPlanExecutionContext | null
  slashCommand?: SidecarSlashCommandContext | null
  systemCommand?: SidecarSystemCommandContext | null
  pluginChannelContext?: SidecarPluginChannelContext | null
  requestContextTexts?: readonly string[] | null
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
  contextSource?: SidecarContextSource
  liveOverlayMessages?: UnifiedMessage[]
}): SidecarAgentRunRequest | null {
  const provider = mapSidecarProvider(args.provider)

  const messages: SidecarUnifiedMessage[] = []
  for (const message of args.messages) {
    const mapped = mapSidecarMessage(message)
    if (!mapped) return null
    messages.push(mapped)
  }

  const maxParallelTools = normalizeMaxParallelTools(args.maxParallelTools)
  const webSearch = mapSidecarWebSearchConfig(args.tools)
  // Use only the tools provided by the caller (already filtered by Worker preset).
  // Renderer-registered tool handlers remain available for execution by name,
  // but their definitions are NOT merged into the LLM tool list — the Worker's
  // ToolPreset is the single source of truth for what the LLM sees.
  const mergedTools = args.tools
  const subAgentToolCatalog: SidecarToolDefinition[] = []
  // Global settings snapshot, applied to every run this module builds (incl. sub-agents,
  // which inherit the parent's parameters in the native worker).
  const settings = useSettingsStore.getState()
  const permissionPolicy = toPermissionPolicySnapshot(settings.permissionPolicy)
  const maxConcurrentSubAgents = clampMaxConcurrentSubAgents(settings.maxConcurrentSubAgents)
  const imagePluginProvider = args.imagePluginProvider
    ? mapSidecarProvider(args.imagePluginProvider)
    : null
  // Route sub-agents (Task tool) to the configured fast model. getFastProviderConfig()
  // resolves the explicit fast selection, else a sensible default, else the main model —
  // so this degrades to today's parent-inherit behavior when no distinct fast model is set.
  const fastProviderConfig = useProviderStore.getState().getFastProviderConfig()
  const subAgentProvider = fastProviderConfig ? mapSidecarProvider(fastProviderConfig) : null
  const configuredCompressionProvider = useProviderStore.getState().getCompressionProviderConfig()
  const compressionProvider =
    args.compression &&
    configuredCompressionProvider &&
    isNativeSidecarProviderConfig(configuredCompressionProvider)
      ? mapSidecarProvider(configuredCompressionProvider)
      : null
  const planRevision = normalizePlanRevision(args.planRevision)
  const planExecution = normalizePlanExecution(args.planExecution)
  const slashCommand = normalizeSlashCommand(args.slashCommand)
  const systemCommand = normalizeSystemCommand(args.systemCommand)
  const pluginChannelContext = normalizePluginChannelContext(args.pluginChannelContext)
  const requestContextTexts = normalizeRequestContextTexts(args.requestContextTexts)
  const liveOverlayMessages: SidecarUnifiedMessage[] = []
  for (const message of args.liveOverlayMessages ?? []) {
    const mapped = mapSidecarMessage(message)
    if (!mapped) return null
    liveOverlayMessages.push(mapped)
  }

  return {
    messages,
    ...(args.contextSource ? { contextSource: args.contextSource } : {}),
    ...(liveOverlayMessages.length > 0 ? { liveOverlayMessages } : {}),
    provider,
    ...(compressionProvider ? { compressionProvider } : {}),
    tools: mergedTools.map(mapSidecarTool),
    ...(subAgentToolCatalog.length > 0 ? { subAgentToolCatalog } : {}),
    ...(webSearch ? { webSearch } : {}),
    ...(imagePluginProvider ? { imagePluginProvider } : {}),
    ...(subAgentProvider ? { subAgentProvider } : {}),
    ...(args.runId ? { runId: args.runId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.projectId ? { projectId: args.projectId } : {}),
    ...(args.workingFolder ? { workingFolder: args.workingFolder } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.collaborationMode ? { collaborationMode: args.collaborationMode } : {}),
    ...(args.runtimeRole ? { runtimeRole: args.runtimeRole } : {}),
    ...(args.toolPreset ? { toolPreset: args.toolPreset } : {}),
    ...(args.compression ? { compression: args.compression } : {}),
    maxIterations: args.maxIterations,
    forceApproval: args.forceApproval,
    permissionMode: args.permissionMode ?? (settings.autoApprove ? 'fullAccess' : 'default'),
    ...(maxParallelTools !== undefined ? { maxParallelTools } : {}),
    ...(args.maxToolCallsPerTurn !== undefined ? { maxToolCallsPerTurn: args.maxToolCallsPerTurn } : {}),
    maxConcurrentSubAgents,
    ...(args.sessionMode ? { sessionMode: args.sessionMode } : {}),
    ...(args.planMode ? { planMode: true } : {}),
    ...(args.planModeAllowedTools && args.planModeAllowedTools.length > 0
      ? { planModeAllowedTools: [...args.planModeAllowedTools] }
      : {}),
    ...(permissionPolicy ? { permissionPolicy } : {}),
    ...(planRevision ? { planRevision } : {}),
    ...(planExecution ? { planExecution } : {}),
    ...(slashCommand ? { slashCommand } : {}),
    ...(systemCommand ? { systemCommand } : {}),
    ...(pluginChannelContext ? { pluginChannelContext } : {}),
    ...(requestContextTexts.length > 0 ? { requestContextTexts } : {}),
    ...(args.teamToolsActive ? { teamToolsActive: true } : {}),
    ...(args.activeTeamName ? { activeTeamName: args.activeTeamName } : {}),
    ...(args.goalRunSource ? { goalRunSource: args.goalRunSource } : {}),
    ...(args.pluginId ? { pluginId: args.pluginId } : {}),
    ...(args.pluginChatId ? { pluginChatId: args.pluginChatId } : {}),
    ...(args.pluginChatType ? { pluginChatType: args.pluginChatType } : {}),
    ...(args.pluginSenderId ? { pluginSenderId: args.pluginSenderId } : {}),
    ...(args.pluginSenderName ? { pluginSenderName: args.pluginSenderName } : {}),
    ...(args.callerAgent ? { callerAgent: args.callerAgent } : {}),
    ...(args.sshConnectionId ? { sshConnectionId: args.sshConnectionId } : {}),
    ...(args.captureFinalMessages ? { captureFinalMessages: true } : {}),
    ...(args.providerTurnOnly ? { providerTurnOnly: true } : {}),
    ...(args.includeFullDebugBody ? { includeFullDebugBody: true } : {}),
    ...(args.translation ? { translation: args.translation } : {})
  }
}

export function normalizeSidecarApprovalRequest(rawValue: unknown): SidecarApprovalRequest | null {
  const value = normalizeSidecarRecord(rawValue)
  const toolCall = normalizeSidecarRecord(value.toolCall)
  const id = typeof toolCall.id === 'string' ? toolCall.id : ''
  const name = typeof toolCall.name === 'string' ? toolCall.name : ''
  if (!id || !name) return null

  return {
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    toolCall: {
      id,
      name,
      input: sanitizeSidecarToolInput(name, normalizeSidecarRecord(toolCall.input)),
      status: 'pending_approval',
      requiresApproval: true,
      startedAt: Number(toolCall.startedAt ?? Date.now())
    }
  }
}
