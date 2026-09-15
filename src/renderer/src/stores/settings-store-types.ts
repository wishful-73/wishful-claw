import type { ReasoningEffortLevel, ThinkingConfig } from '../lib/api/types'
import type { ProviderFallbackCandidate, ProviderFallbackConfig } from '../../../shared/types/provider'
import type { CollaborationMode, PermissionMode } from './chat-store/types'
import { type AppThemePreset, type SshTerminalThemePreset } from '../lib/theme-presets'
import { type AppLanguage } from '@renderer/lib/i18n-language'

export interface ModelBinding {
  providerId: string
  modelId: string
}

export interface CodexConfig {
  id: string
  name: string
  providerId: string
  modelId: string
}

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

// Provider fallback (iter-29 / S-21): ordered failover candidates, used when the
// provider in use hits a quota / rate limit. Off by default — opt-in per install.
export const DEFAULT_PROVIDER_FALLBACK: ProviderFallbackConfig = {
  enabled: false,
  candidates: []
}

/**
 * Fresh copy of the default. Callers mutate the config they are handed, so the
 * arrays must never be shared with the module-level constant.
 */
export function createDefaultProviderFallback(): ProviderFallbackConfig {
  return { enabled: DEFAULT_PROVIDER_FALLBACK.enabled, candidates: [] }
}

/**
 * Keeps the persisted fallback config well-formed: a boolean flag and a list of
 * candidates that is duplicate-free per provider and keeps the user's order.
 *
 * Migrates the pre-`candidates` shape too. That shape was a bare list of provider
 * ids with no model, so the provider is carried over with an **empty** modelId: the
 * runtime skips an empty model rather than guessing one, and the settings pane shows
 * it as "pick a model". Silently substituting a default model would quietly change
 * where a handover lands, which is exactly what the explicit model is here to prevent.
 *
 * Unknown ids are *not* pruned — a provider may be temporarily absent (e.g. the store
 * has not hydrated yet); the runtime skips whatever does not resolve.
 */
export function normalizeProviderFallback(value: unknown): ProviderFallbackConfig {
  if (!value || typeof value !== 'object') return createDefaultProviderFallback()
  const raw = value as { enabled?: unknown; candidates?: unknown; priority?: unknown }
  return { enabled: raw.enabled === true, candidates: readCandidates(raw) }
}

function readCandidates(raw: { candidates?: unknown; priority?: unknown }): ProviderFallbackCandidate[] {
  const source = Array.isArray(raw.candidates)
    ? raw.candidates
    : Array.isArray(raw.priority)
      // Pre-candidates shape: ids only, so the model is left for the user to choose.
      ? raw.priority.map((providerId) => ({ providerId, modelId: '' }))
      : []

  const seen = new Set<string>()
  const candidates: ProviderFallbackCandidate[] = []
  for (const entry of source) {
    const candidate = readCandidate(entry)
    // One entry per provider: its models share a single quota, so a repeat is a no-op.
    if (!candidate || seen.has(candidate.providerId)) continue
    seen.add(candidate.providerId)
    candidates.push(candidate)
  }
  return candidates
}

function readCandidate(entry: unknown): ProviderFallbackCandidate | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as { providerId?: unknown; modelId?: unknown }
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
  if (!providerId) return null
  const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : ''
  return { providerId, modelId }
}

export const DEFAULT_MAX_CONCURRENT_SUB_AGENTS = 2
export const MIN_MAX_CONCURRENT_SUB_AGENTS = 1
export const MAX_MAX_CONCURRENT_SUB_AGENTS = 8
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 15
export const MIN_MAX_TOOL_CALLS_PER_TURN = 1
export const MAX_MAX_TOOL_CALLS_PER_TURN = 50
// T-3: 运行时驻留会话在内存里保留的最近轮数（轮 = 一条 user 消息及其后的回复）。
export const DEFAULT_MAX_RESIDENT_TURNS = 15
export const MIN_MAX_RESIDENT_TURNS = 5
export const MAX_MAX_RESIDENT_TURNS = 50

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

export function createDefaultCodexConfig(): CodexConfig {
  return {
    id: DEFAULT_AI_CODING_CONFIG_ID,
    name: '默认 1',
    providerId: '',
    modelId: ''
  }
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
export function clampMaxResidentTurns(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESIDENT_TURNS
  return Math.min(
    MAX_MAX_RESIDENT_TURNS,
    Math.max(MIN_MAX_RESIDENT_TURNS, Math.floor(value))
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

// ── BrowserSearch (S-23) ──

/**
 * A user-defined search engine.
 *
 * `basic` is a URL template parsed with the generic h2/h3 heuristic, and its hits
 * are marked low confidence. `selector` adds a render mode and CSS selectors for
 * precise parsing. Feeding the fetched HTML to a model to parse is deliberately
 * *not* a tier: it is slow, costly and unstable, so it is not a main path.
 */
export interface CustomSearchEngine {
  id: string
  name: string
  enabled: boolean
  /** Intent this engine joins (general / tech / academic / finance / social / knowledge). */
  intent: string
  tier: 'basic' | 'selector'
  /** Must contain the `{query}` placeholder. */
  urlTemplate: string
  renderMode: 'http' | 'rendered'
  selectors: {
    item: string
    title: string
    url: string
    snippet: string
  }
}

export interface BrowserSearchSettings {
  /** Built-in engine ids the user enabled. */
  enabledEngineIds: string[]
  /** Per-intent engine overrides. An intent with no entry uses the built-in routing. */
  intentEngines: Record<string, string[]>
  /** When false, every enabled engine is queried and intent detection is skipped. */
  autoRoute: boolean
  /** Maximum results after deduplication. */
  maxResults: number
  customEngines: CustomSearchEngine[]
}

/**
 * Pre-S-23 WebSearch configuration, preserved verbatim.
 *
 * The API-search chain it configured is gone, but the values are kept so an
 * existing provider choice and API key are not silently dropped — the old fields
 * would otherwise disappear the first time the user opened settings.
 */
export interface LegacyWebSearchSettings {
  enabled: boolean
  provider: string
  apiKey: string
  engine: string
  maxResults: number
  timeout: number
}


