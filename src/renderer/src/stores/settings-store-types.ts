import type { ReasoningEffortLevel, ThinkingConfig } from '../lib/api/types'
import type { CollaborationMode, PermissionMode } from './chat-store/types'
import { type AppThemePreset, type SshTerminalThemePreset } from '../lib/theme-presets'
import { type AppLanguage } from '@renderer/lib/i18n-language'

export interface ModelBinding {
  providerId: string
  modelId: string
}

export type ClaudeCodePermissionOption = 'dangerouslySkipPermissions'

export interface SessionDefaultModelBinding extends ModelBinding {
  useGlobalActiveModel: boolean
}

export interface ClaudeCodeConfig {
  id: string
  name: string
  providerId: string
  defaultModelId: string
  smallFastModelId: string
  sonnetModelId: string
  opusModelId: string
  haikuModelId: string
  permissionOptions: ClaudeCodePermissionOption[]
}

export interface CodexConfig {
  id: string
  name: string
  providerId: string
  modelId: string
}

export type PromptRecommendationModelBinding = ModelBinding | 'disabled' | null

export type PromptRecommendationModelBindings = Record<
  'chat' | 'clarify' | 'cowork' | 'code' | 'acp',
  PromptRecommendationModelBinding
>

export type MainModelSelectionMode = 'auto' | 'manual'
export type ProjectSessionDefaultCollaborationMode = CollaborationMode
export type CoworkDefaultPermissionMode = PermissionMode
export type MemoryScopeMode = 'hybrid'
export type MemoryOrganizationSchedule = 'nightly' | 'startup'
export type MemoryOrganizationThinkingMode = 'default' | 'enabled' | 'disabled'
export type ClarifyPlanModeAutoSwitchTarget = 'off' | 'code' | 'acp'
export type ProjectDefaultDirectoryMode = 'last-used' | 'custom'
export type FileDiffViewMode = 'split' | 'inline' | 'code' | 'preview'
export type ThemeMode = 'light' | 'dark' | 'system'
export type LiveOutputAnimationStyle = 'agile' | 'elegant'
export type OnboardingLanguage = AppLanguage
export type ShellExecutionEndpoint =
  | 'auto'
  | 'zsh'
  | 'bash'
  | 'sh'
  | 'powershell'
  | 'pwsh'
  | 'cmd'
  | 'custom'
export const DEFAULT_THEME_MODE = 'system' as const
export const DEFAULT_SHELL_EXECUTION_ENDPOINT: ShellExecutionEndpoint = 'auto'
export const LEGACY_DEFAULT_THEME_MODE = 'system' as const
export const LEGACY_DEFAULT_APP_THEME_PRESET: AppThemePreset = 'studio'
export const LEGACY_DEFAULT_SSH_TERMINAL_THEME_PRESET: SshTerminalThemePreset = 'graphite'
export const V17_DEFAULT_THEME_MODE = 'dark' as const
export const V17_DEFAULT_APP_THEME_PRESET: AppThemePreset = 'mulberry'
export const V17_DEFAULT_SSH_TERMINAL_THEME_PRESET: SshTerminalThemePreset = 'mulberry'
export const V18_DEFAULT_THEME_MODE = 'dark' as const
export const V18_DEFAULT_APP_THEME_PRESET: AppThemePreset = 'graphite'
export const V18_DEFAULT_SSH_TERMINAL_THEME_PRESET: SshTerminalThemePreset = 'graphite'

export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 3
export const MIN_MAX_PARALLEL_TOOL_CALLS = 1
export const MAX_MAX_PARALLEL_TOOL_CALLS = 16

// Provider retry constants (attempts, 0 = unlimited)
export const DEFAULT_REQUEST_MAX_RETRIES = 10
export const MAX_REQUEST_MAX_RETRIES = 100

export function clampRequestMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REQUEST_MAX_RETRIES
  return Math.min(MAX_REQUEST_MAX_RETRIES, Math.max(0, Math.floor(value)))
}

export const DEFAULT_MAX_CONCURRENT_SUB_AGENTS = 2
export const MIN_MAX_CONCURRENT_SUB_AGENTS = 1
export const MAX_MAX_CONCURRENT_SUB_AGENTS = 8
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 15
export const MIN_MAX_TOOL_CALLS_PER_TURN = 1
export const MAX_MAX_TOOL_CALLS_PER_TURN = 50

export interface RecentWorkingTarget {
  workingFolder: string
  sshConnectionId: string | null
  updatedAt: number
}

const MAX_RECENT_WORKING_TARGETS = 8
const DEFAULT_AI_CODING_CONFIG_ID = 'default'

export function readStringField(item: Record<string, unknown>, key: string): string {
  const value = item[key]
  return typeof value === 'string' ? value : ''
}

export function sanitizeClaudeCodePermissionOptions(value: unknown): ClaudeCodePermissionOption[] {
  if (!Array.isArray(value)) return []
  return value.includes('dangerouslySkipPermissions') ? ['dangerouslySkipPermissions'] : []
}

export function createDefaultClaudeCodeConfig(): ClaudeCodeConfig {
  return {
    id: DEFAULT_AI_CODING_CONFIG_ID,
    name: '默认 1',
    providerId: '',
    defaultModelId: '',
    smallFastModelId: '',
    sonnetModelId: '',
    opusModelId: '',
    haikuModelId: '',
    permissionOptions: []
  }
}

export function createDefaultCodexConfig(): CodexConfig {
  return {
    id: DEFAULT_AI_CODING_CONFIG_ID,
    name: '默认 1',
    providerId: '',
    modelId: ''
  }
}

export function sanitizeClaudeCodeConfigs(configs: unknown): ClaudeCodeConfig[] {
  if (!Array.isArray(configs)) return [createDefaultClaudeCodeConfig()]

  const usedIds = new Set<string>()
  const sanitized = configs
    .map((item, index): ClaudeCodeConfig | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const rawId = readStringField(record, 'id').trim() || `claude-${index + 1}`
      const id = usedIds.has(rawId) ? `${rawId}-${index + 1}` : rawId
      usedIds.add(id)
      return {
        id,
        name: readStringField(record, 'name').trim() || `默认 ${index + 1}`,
        providerId: readStringField(record, 'providerId'),
        defaultModelId: readStringField(record, 'defaultModelId'),
        smallFastModelId: readStringField(record, 'smallFastModelId'),
        sonnetModelId: readStringField(record, 'sonnetModelId'),
        opusModelId: readStringField(record, 'opusModelId'),
        haikuModelId: readStringField(record, 'haikuModelId'),
        permissionOptions: sanitizeClaudeCodePermissionOptions(record.permissionOptions)
      }
    })
    .filter((item): item is ClaudeCodeConfig => Boolean(item))

  return sanitized.length > 0 ? sanitized : [createDefaultClaudeCodeConfig()]
}

export function sanitizeCodexConfigs(configs: unknown): CodexConfig[] {
  if (!Array.isArray(configs)) return [createDefaultCodexConfig()]

  const usedIds = new Set<string>()
  const sanitized = configs
    .map((item, index): CodexConfig | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const rawId = readStringField(record, 'id').trim() || `codex-${index + 1}`
      const id = usedIds.has(rawId) ? `${rawId}-${index + 1}` : rawId
      usedIds.add(id)
      return {
        id,
        name: readStringField(record, 'name').trim() || `默认 ${index + 1}`,
        providerId: readStringField(record, 'providerId'),
        modelId: readStringField(record, 'modelId')
      }
    })
    .filter((item): item is CodexConfig => Boolean(item))

  return sanitized.length > 0 ? sanitized : [createDefaultCodexConfig()]
}

export function normalizeWorkingFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim()
  if (!trimmed) return ''
  if (trimmed === '/') return '/'
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`
  }
  return trimmed.replace(/[\\/]+$/, '')
}

export function getRecentWorkingTargetKey(target: {
  workingFolder?: string | null
  sshConnectionId?: string | null
}): string {
  return `${target.sshConnectionId ?? 'local'}::${normalizeWorkingFolderPath(target.workingFolder ?? '').toLowerCase()}`
}

export function sanitizeRecentWorkingTargets(targets: unknown): RecentWorkingTarget[] {
  if (!Array.isArray(targets)) return []

  const deduped = new Map<string, RecentWorkingTarget>()

  for (const item of targets) {
    if (!item || typeof item !== 'object') continue

    const workingFolder = normalizeWorkingFolderPath(
      'workingFolder' in item && typeof item.workingFolder === 'string' ? item.workingFolder : ''
    )
    if (!workingFolder) continue

    const sshConnectionId =
      'sshConnectionId' in item && typeof item.sshConnectionId === 'string'
        ? item.sshConnectionId
        : null
    const updatedAt =
      'updatedAt' in item && typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()

    deduped.set(getRecentWorkingTargetKey({ workingFolder, sshConnectionId }), {
      workingFolder,
      sshConnectionId,
      updatedAt
    })
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_WORKING_TARGETS)
}

export function isThemeSetting(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function clampMaxParallelToolCalls(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_PARALLEL_TOOL_CALLS
  return Math.min(
    MAX_MAX_PARALLEL_TOOL_CALLS,
    Math.max(MIN_MAX_PARALLEL_TOOL_CALLS, Math.floor(value))
  )
}

export function clampMaxConcurrentSubAgents(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_SUB_AGENTS
  return Math.min(
    MAX_MAX_CONCURRENT_SUB_AGENTS,
    Math.max(MIN_MAX_CONCURRENT_SUB_AGENTS, Math.floor(value))
  )
}


export function clampMaxToolCallsPerTurn(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_TOOL_CALLS_PER_TURN
  return Math.min(
    MAX_MAX_TOOL_CALLS_PER_TURN,
    Math.max(MIN_MAX_TOOL_CALLS_PER_TURN, Math.floor(value))
  )
}
export function normalizeShellExecutionEndpoint(value: unknown): ShellExecutionEndpoint {
  if (
    value === 'auto' ||
    value === 'zsh' ||
    value === 'bash' ||
    value === 'sh' ||
    value === 'powershell' ||
    value === 'pwsh' ||
    value === 'cmd' ||
    value === 'custom'
  ) {
    return value
  }
  return DEFAULT_SHELL_EXECUTION_ENDPOINT
}

export function resolveShellExecutable({
  endpoint,
  customShellExecutable,
  platform
}: {
  endpoint: ShellExecutionEndpoint
  customShellExecutable?: string | null
  platform?: string | null
}): string | undefined {
  const normalizedEndpoint = normalizeShellExecutionEndpoint(endpoint)
  if (normalizedEndpoint === 'auto') return undefined
  if (normalizedEndpoint === 'custom') {
    const custom = customShellExecutable?.trim()
    return custom || undefined
  }

  const normalizedPlatform = platform?.trim().toLowerCase()
  if (normalizedPlatform === 'win32') {
    if (normalizedEndpoint === 'powershell') return 'powershell.exe'
    if (normalizedEndpoint === 'pwsh') return 'pwsh.exe'
    if (normalizedEndpoint === 'cmd') return 'cmd.exe'
    return undefined
  }

  if (normalizedEndpoint === 'zsh') return '/bin/zsh'
  if (normalizedEndpoint === 'bash') return '/bin/bash'
  if (normalizedEndpoint === 'sh') return '/bin/sh'
  return undefined
}

export function getReasoningEffortKey(
  providerId?: string | null,
  modelId?: string | null
): string | null {
  if (!providerId || !modelId) return null
  return `${providerId}:${modelId}`
}

export function resolveReasoningEffortForModel({
  reasoningEffort,
  reasoningEffortByModel,
  providerId,
  modelId,
  thinkingConfig
}: {
  reasoningEffort: ReasoningEffortLevel
  reasoningEffortByModel?: Record<string, ReasoningEffortLevel>
  providerId?: string | null
  modelId?: string | null
  thinkingConfig?: ThinkingConfig
}): ReasoningEffortLevel {
  const key = getReasoningEffortKey(providerId, modelId)
  const levels = thinkingConfig?.reasoningEffortLevels
  const savedEffort = key ? reasoningEffortByModel?.[key] : undefined

  if (savedEffort && (!levels || levels.includes(savedEffort))) {
    return savedEffort
  }

  return thinkingConfig?.defaultReasoningEffort ?? reasoningEffort
}

