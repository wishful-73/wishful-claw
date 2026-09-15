// Shared types, interfaces, and constants for InputArea modules

import type { LucideIcon } from 'lucide-react'
import type { AIModelConfig, MessageRequestModelMeta, RequestTiming, TokenUsage, UnifiedMessage } from '@renderer/lib/api/types'
import type { ManualCompressionResult, PendingSessionMessageItem, SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import type { AppPluginId } from '@renderer/lib/app-plugin/types'
import type { AppMode } from '@renderer/stores/ui-store'
import type { CommandCatalogItem } from '@renderer/lib/commands/command-loader'
import type { ImageAttachment } from '@renderer/lib/image-attachments'

export interface ContextRingProps {
  sessionId?: string | null
  onCompressContext?: () => void | Promise<void>
  isCompressing?: boolean
}

export interface FileSearchItem {
  name: string
  path: string
}

export interface SlashSuggestionItem {
  key: string
  name: string
  label?: string
  summary: string
  kind: 'command' | 'skill' | 'plugin'
  pluginId?: AppPluginId
}


export interface AppPluginPromptItem {
  id: AppPluginId
  title: string
  description: string
}

export const EMPTY_QUEUED_MESSAGES: PendingSessionMessageItem[] = []
export const INTERNAL_FILE_DRAG_MIME = 'application/x-wishfulclaw-file-paths'
export const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}
export const MIN_INPUT_HEIGHT = 120
export const DEFAULT_SESSION_INPUT_HEIGHT = 160
export const MAX_INPUT_HEIGHT = 500
export const MIN_MESSAGE_LIST_HEIGHT = 120
export const EDITOR_MIN_HEIGHT = 60
export const FALLBACK_MAX_VIEWPORT_RATIO = 0.6
export const MAX_SLASH_COMMAND_RESULTS = 8
export const BUILTIN_SLASH_COMMANDS: CommandCatalogItem[] = []

export type ContextCompressionStatus = 'idle' | 'compressing' | ManualCompressionResult


export interface RuntimeOutputSnapshot {
  text: string
  hasTextOutput: boolean
  hasActiveThinking: boolean
}


export type RuntimeMetricTone = 'input' | 'cacheHit' | 'cacheCreate' | 'output' | 'speed' | 'latency'


export interface RuntimeStatusView {
  text: string
  Icon: LucideIcon
  className: string
  spin?: boolean
}


export interface RuntimeUsageTotals {
  inputTokens: number
  outputTokens: number
  billableInputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  inputCost: number | null
  outputCost: number | null
  cacheReadCost: number | null
  cacheCreationCost: number | null
  totalCost: number | null
  latestRequestTiming: RequestTiming | null
}

export interface ComposerRuntimeStatusProps {
  sessionId: string
  isStreaming: boolean
  draftInputTokens: number
  isOptimizing?: boolean
  pendingImageReads?: number
  contextCompressionStatus: ContextCompressionStatus
  contextCompressionStatusLabel: string
  model?: AIModelConfig | null
  /**
   * Pre-formatted `服务商 · 模型` label, set only while the session runs in auto mode — that
   * mode hides the concrete model behind a handover chain, so the footer is the only place
   * naming it. Manual sessions leave it null; their switcher already shows the model.
   */
  autoModelLabel?: string | null
  className?: string
  messagesOverride?: readonly UnifiedMessage[]
  streamingMessageIdOverride?: string | null
  usageOverride?: TokenUsage
  showStatus?: boolean
}


export interface InputAreaProps {
  sessionId?: string | null
  onSend?: (text: string, images?: ImageAttachment[], options?: SendMessageOptions) => void
  onStop?: () => void
  onSelectFolder?: () => void
  isStreaming?: boolean
  workingFolder?: string
  hideWorkingFolderIndicator?: boolean
  hideWorkingFolderPicker?: boolean
  onCompressContext?: () => ManualCompressionResult | void | Promise<ManualCompressionResult | void>
  disabled?: boolean
  draftKeyOverride?: string | null
  suppressPendingQueue?: boolean
  hideGoalSessionBar?: boolean
  hideModeSwitch?: boolean
  modelRoute?: 'main' | 'fast'
  readOnlyModel?: MessageRequestModelMeta | null
  attachedFooter?: boolean
  fullWidth?: boolean
}


export const placeholderKeys: Record<AppMode, string> = {
  chat: 'input.placeholder',
  clarify: 'input.placeholderClarify',
  cowork: 'input.placeholderCowork',
  code: 'input.placeholderCode',
  acp: 'input.placeholderAcp'
}

export const defaultRecommendationKeys: Record<AppMode, string> = {
  chat: 'input.recommendationDefaultChat',
  clarify: 'input.recommendationDefaultClarify',
  cowork: 'input.recommendationDefaultCowork',
  code: 'input.recommendationDefaultCode',
  acp: 'input.recommendationDefaultAcp'
}

