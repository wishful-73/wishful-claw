import type {
  ProviderConfig
} from '../api/types'
import { summarizeToolInputForHistory } from '../tools/tool-input-sanitizer'

// Type definitions extracted to sidecar-protocol-types.ts
export type {
  SidecarTextBlock,
  SidecarImageBlock,
  SidecarToolCallExtraContent,
  SidecarToolUseBlock,
  SidecarToolResultBlock,
  SidecarThinkingBlock,
  SidecarAgentErrorBlock,
  SidecarContentBlock,
  SidecarUnifiedMessage,
  SidecarProviderConfig,
  SidecarToolDefinition,
  SidecarTranslationContext,
  SidecarContextSource,
  SidecarPlanRevisionContext,
  SidecarPlanExecutionContext,
  SidecarSlashCommandContext,
  SidecarSystemCommandContext,
  SidecarPluginChannelContext,
  SidecarAgentRunRequest,
  SidecarApprovalRequest,
  SidecarApprovalResponse,
} from './sidecar-protocol-types'
import { SidecarPlanExecutionContext, SidecarPlanRevisionContext, SidecarPluginChannelContext, SidecarSlashCommandContext, SidecarSystemCommandContext, isRecord } from './sidecar-protocol-types'

export function normalizeSidecarRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function sanitizeSidecarToolInput(name: string, rawInput: unknown): Record<string, unknown> {
  const input = normalizeSidecarRecord(rawInput)
  return summarizeToolInputForHistory(name, input)
}

export function normalizeMaxParallelTools(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(16, Math.max(1, Math.floor(value)))
}

export function normalizePlanRevision(
  value: SidecarPlanRevisionContext | null | undefined
): SidecarPlanRevisionContext | undefined {
  if (!value) return undefined
  const title = value.title.trim()
  if (!title) return undefined
  const filePath = value.filePath?.trim()
  const feedback = value.feedback?.trim()
  return {
    title,
    ...(filePath ? { filePath } : {}),
    ...(feedback ? { feedback } : {})
  }
}

export function normalizePlanExecution(
  value: SidecarPlanExecutionContext | null | undefined
): SidecarPlanExecutionContext | undefined {
  if (!value) return undefined
  const filePath = value.filePath?.trim()
  return {
    ...(filePath ? { filePath } : {}),
    ...(value.acp ? { acp: true } : {})
  }
}

export function normalizeSlashCommand(
  value: SidecarSlashCommandContext | null | undefined
): SidecarSlashCommandContext | undefined {
  if (!value) return undefined
  const commandName = value.commandName.trim().toLowerCase()
  if (!commandName) return undefined
  const rawArguments = value.rawArguments?.trim()
  const parsedArguments = (value.parsedArguments ?? []).map((item) => item.trim())
  if (!rawArguments && parsedArguments.length === 0) return undefined
  return {
    commandName,
    ...(rawArguments ? { rawArguments } : {}),
    parsedArguments
  }
}

export function normalizeSystemCommand(
  value: SidecarSystemCommandContext | null | undefined
): SidecarSystemCommandContext | undefined {
  if (!value) return undefined
  const name = value.name.trim()
  const content = value.content.trim()
  if (!name || !content) return undefined
  return { name, content }
}

export function normalizePluginChannelContext(
  value: SidecarPluginChannelContext | null | undefined
): SidecarPluginChannelContext | undefined {
  if (!value) return undefined
  const channelId = value.channelId.trim()
  if (!channelId) return undefined

  const channelName = value.channelName?.trim()
  const chatId = value.chatId?.trim()
  const senderId = value.senderId?.trim()
  const senderName = value.senderName?.trim()
  const availableTools = Array.from(
    new Set((value.availableTools ?? []).map((item) => item.trim()).filter(Boolean))
  )
  return {
    ...(channelName ? { channelName } : {}),
    channelId,
    ...(chatId ? { chatId } : {}),
    ...(value.chatType ? { chatType: value.chatType } : {}),
    ...(senderId ? { senderId } : {}),
    ...(senderName ? { senderName } : {}),
    ...(availableTools.length > 0 ? { availableTools } : {}),
    ...(value.autoReply ? { autoReply: true } : {})
  }
}

export function normalizeRequestContextTexts(value: readonly string[] | null | undefined): string[] {
  if (!value) return []
  return value.map((item) => item.trim()).filter(Boolean)
}

/** Minimal provider shape accepted by sidecar mapping functions. Accepts both full ProviderConfig and lightweight { providerId, model } selections. */
export type SidecarProviderInput = Partial<Omit<ProviderConfig, 'providerId'>> & { model?: string; providerId?: string | null }

export function isNativeSidecarProviderConfig(provider: SidecarProviderInput): boolean {
  if (
    provider.type !== 'openai-chat' &&
    provider.type !== 'openai-responses' &&
    provider.type !== 'anthropic' &&
    provider.type !== 'gemini' &&
    provider.type !== 'vertex-ai'
  ) {
    return false
  }
  if (provider.category && provider.category !== 'chat') return false
  return true
}


// Re-export mapping functions from separate module
export { mapSidecarContentBlock, mapSidecarMessage, mapSidecarProvider, buildSidecarAgentRunRequest, sanitizeSidecarMessageMeta, normalizeSidecarApprovalRequest } from './sidecar-mapping'
