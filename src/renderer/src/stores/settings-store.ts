import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ProviderType, ReasoningEffortLevel } from '../lib/api/types'
import { ipcStorage } from '../lib/ipc/ipc-storage'
import {
  DEFAULT_APP_THEME_PRESET,
  DEFAULT_SSH_TERMINAL_THEME_PRESET,
  type AppThemePreset,
  type SshTerminalThemePreset
} from '../lib/theme-presets'
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  clampLeftSidebarWidth
} from '@renderer/components/layout/right-panel-defs'
import {
  DEFAULT_BROWSER_USER_DATA_SOURCE,
  normalizeBrowserUserDataSource,
  type BrowserUserDataSource
} from '../../../shared/browser-plugin'
import {
  detectSystemLanguage,
  type AppLanguage
} from '@renderer/lib/i18n-language'
import {
  DEFAULT_PERMISSION_POLICY,
  type PermissionPolicy
} from '../../../shared/permission-policy'
import { type ModelBinding, type CodexConfig, type MemoryOrganizationThinkingMode, type ClarifyPlanModeAutoSwitchTarget, type RecentWorkingTarget, type FileDiffViewMode, type LiveOutputAnimationStyle, type ShellExecutionEndpoint, type MainModelSelectionMode, type ProjectSessionDefaultCollaborationMode, type CoworkDefaultPermissionMode, type MemoryScopeMode, type MemoryOrganizationSchedule, type ProjectDefaultDirectoryMode, type BrowserSearchSettings, type LegacyWebSearchSettings, DEFAULT_THEME_MODE, DEFAULT_MAX_PARALLEL_TOOL_CALLS, DEFAULT_MAX_CONCURRENT_SUB_AGENTS, DEFAULT_MAX_TOOL_CALLS_PER_TURN, DEFAULT_MAX_RESIDENT_TURNS, DEFAULT_SHELL_EXECUTION_ENDPOINT, createDefaultProviderFallback, createDefaultCodexConfig, normalizeShellExecutionEndpoint, sanitizeRecentWorkingTargets, clampMaxConcurrentSubAgents, clampMaxParallelToolCalls, clampMaxToolCallsPerTurn, clampMaxResidentTurns, clampRequestMaxRetries, normalizeProviderFallback } from './settings-store-types'
import type { ProviderFallbackConfig } from '../../../shared/types/provider'
import { DEFAULT_BROWSER_SEARCH_SETTINGS } from '@renderer/lib/tools/browser-search/engines'
import { DEFAULT_LOG_LEVEL, normalizeLogLevel, type LogLevel } from '../../../shared/logging'
import type { UpdateBannerPosition } from '../../../shared/updater/types'

// Re-export types for consumers
export type {
  ClarifyPlanModeAutoSwitchTarget,
  CodexConfig,
  FileDiffViewMode,
  LiveOutputAnimationStyle,
  MainModelSelectionMode,
  ProjectSessionDefaultCollaborationMode,
  CoworkDefaultPermissionMode,
  MemoryOrganizationSchedule,
  MemoryOrganizationThinkingMode,
  MemoryScopeMode,
  ModelBinding,
  OnboardingLanguage,
  ProjectDefaultDirectoryMode,
  RecentWorkingTarget,
  ShellExecutionEndpoint,
  ThemeMode,
} from './settings-store-types'
export type { ProviderFallbackConfig } from '../../../shared/types/provider'
import { normalizeWorkingFolderPath } from './settings-store-types'
import { migrateSettings } from './settings-store-migrate'

// API request deadline constants (seconds, 0 = no limit)
export const DEFAULT_API_REQUEST_TIMEOUT_SECONDS = 100
export const MIN_API_REQUEST_TIMEOUT_SECONDS = 0
export const MAX_API_REQUEST_TIMEOUT_SECONDS = 86_400

export function clampApiRequestTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_API_REQUEST_TIMEOUT_SECONDS
  return Math.min(
    MAX_API_REQUEST_TIMEOUT_SECONDS,
    Math.max(MIN_API_REQUEST_TIMEOUT_SECONDS, Math.floor(value))
  )
}

// Re-export constants and functions for consumers
export {
  DEFAULT_MAX_CONCURRENT_SUB_AGENTS,
  DEFAULT_REQUEST_MAX_RETRIES,
  MAX_REQUEST_MAX_RETRIES,
  clampRequestMaxRetries,
  DEFAULT_MAX_PARALLEL_TOOL_CALLS,
  DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_RESIDENT_TURNS,
  DEFAULT_SHELL_EXECUTION_ENDPOINT,
  DEFAULT_THEME_MODE,
  MAX_MAX_CONCURRENT_SUB_AGENTS,
  MAX_MAX_PARALLEL_TOOL_CALLS,
  MAX_MAX_TOOL_CALLS_PER_TURN,
  MAX_MAX_RESIDENT_TURNS,
  MIN_MAX_CONCURRENT_SUB_AGENTS,
  MIN_MAX_PARALLEL_TOOL_CALLS,
  MIN_MAX_TOOL_CALLS_PER_TURN,
  MIN_MAX_RESIDENT_TURNS,
  clampMaxConcurrentSubAgents,
  clampMaxParallelToolCalls,
  clampMaxToolCallsPerTurn,
  clampMaxResidentTurns,
  createDefaultCodexConfig,
  getReasoningEffortKey,
  getRecentWorkingTargetKey,
  normalizeShellExecutionEndpoint,
  resolveReasoningEffortForModel,
  resolveShellExecutable,
} from './settings-store-types'

interface SettingsStore {
  provider: ProviderType
  apiKey: string
  baseUrl: string
  model: string
  fastModel: string
  maxTokens: number
  temperature: number
  systemPrompt: string
  theme: 'light' | 'dark' | 'system'
  themePreset: AppThemePreset
  sshTerminalThemePreset: SshTerminalThemePreset
  language: AppLanguage
  autoApprove: boolean
  permissionPolicy: PermissionPolicy
  autoUpdateEnabled: boolean
  clarifyAutoAcceptRecommended: boolean
  clarifyPlanModeAutoSwitchTarget: ClarifyPlanModeAutoSwitchTarget
  devMode: boolean
  thinkingEnabled: boolean
  fastModeEnabled: boolean
  reasoningEffort: ReasoningEffortLevel
  reasoningEffortByModel: Record<string, ReasoningEffortLevel>
  teamToolsEnabled: boolean
  builtinBrowserEnabled: boolean
  hooksEnabled: boolean
  browserUserDataReuseEnabled: boolean
  browserUserDataSource: BrowserUserDataSource
  contextCompressionEnabled: boolean
  /** Global trigger ratio shared by every chat model. */
  contextCompressionThreshold: number
  editorWorkspaceEnabled: boolean
  editorRemoteLanguageServiceEnabled: boolean
  maxParallelToolCalls: number
  maxToolCallsPerTurn: number
  maxConcurrentSubAgents: number
  /** T-3: 运行时驻留会话在内存里保留的最近轮数（轮 = 一条 user 消息及其后的回复）。 */
  maxResidentTurns: number
  toolResultFormat: 'toon' | 'json'
  fileDiffViewMode: FileDiffViewMode
  shellExecutionEndpoint: ShellExecutionEndpoint
  customShellExecutable: string
  shellEnvironmentVariablesText: string
  userName: string
  userAvatar: string
  onboardingCompleted: boolean
  onboardingCompletedAt: number | null
  onboardingInterests: string[]
  defaultSoulTemplateId: string
  defaultPersonaId: string
  conversationGuideSeen: boolean
  memoryUseMemories: boolean
  memoryScopeMode: MemoryScopeMode
  memoryMaxRolloutsPerStartup: number
  memoryMinRolloutIdleHours: number
  memoryMaxRawMemoriesForConsolidation: number
  memoryMaxUnusedDays: number
  memorySummaryBudgetTokens: number

  // Memory organization & recall settings
  memoryOrganizationEnabled: boolean
  memoryOrganizationSchedule: MemoryOrganizationSchedule
  memoryOrganizationNightlyTime: string
  memoryOrganizationModel: ModelBinding | null
  memoryOrganizationThinkingMode: MemoryOrganizationThinkingMode
  memoryOrganizationReasoningEffort: ReasoningEffortLevel | ''
  memoryWarmThresholdEphemeral: number
  memoryWarmThresholdStandard: number
  memoryWarmThresholdLasting: number
  memoryColdThresholdEphemeral: number
  memoryColdThresholdStandard: number
  memoryColdThresholdLasting: number
  memoryRecallMaxNotes: number
  memoryRecallMaxChars: number
  memoryRecallMinScore: number
  memoryRecallGlobalFallback: boolean
  memoryRecallVisibility: boolean

  // Appearance Settings
  backgroundColor: string
  fontFamily: string
  fontSize: number
  animationsEnabled: boolean
  liveOutputAnimationStyle: LiveOutputAnimationStyle
  toolbarCollapsedByDefault: boolean
  leftSidebarWidth: number
  /**
   * Where the floating update banner was dragged to, or `null` while it still lives on its default
   * anchored corner. See {@link UpdateBannerPosition} for why `null` is not a position.
   */
  updateBannerPosition: UpdateBannerPosition | null
  /** Chat column fills the whole conversation panel instead of the 820px cap. */
  conversationPanelFullWidth: boolean

  // Search (iter-29 S-23). The API-backed WebSearch chain was retired; the
  // multi-engine scraper is configured here instead.
  browserSearch: BrowserSearchSettings
  /** Pre-S-23 WebSearch config, kept so an existing provider/API key survives.
   *  Never read by the search code. */
  legacyWebSearch: LegacyWebSearchSettings | null

  // API Request Timeout (seconds, 0 = no limit)
  apiRequestTimeoutSeconds: number

  // Provider max retry attempts on 429/5xx (0 = unlimited, default 10)
  requestMaxRetries: number

  // Provider fallback (iter-29 / S-21): ordered failover candidates used when the
  // provider in use hits a quota / rate limit. Off unless the user opts in.
  providerFallback: ProviderFallbackConfig

  // CodeGraph Settings (opt-in standalone sidecar; default off)
  codegraphEnabled: boolean
  // Register the full 8-tool CodeGraph surface for agents (default: explore only,
  // matching upstream's DEFAULT_MCP_TOOLS)
  codegraphFullToolSurface: boolean

  // Network Settings
  systemProxyUrl: string

  // Logging Settings (persisted by main into settings/general.json; error
  // entries are always written regardless of this level)
  logLevel: LogLevel

  // Session model selection
  newSessionDefaultModel: ModelBinding | null
  mainModelSelectionMode: MainModelSelectionMode
  projectSessionDefaultCollaborationMode: ProjectSessionDefaultCollaborationMode
  coworkDefaultPermissionMode: CoworkDefaultPermissionMode
  codexConfigs: CodexConfig[]
  projectDefaultDirectoryMode: ProjectDefaultDirectoryMode
  projectDefaultDirectory: string
  lastProjectDirectory: string
  recentWorkingTargets: RecentWorkingTarget[]
  defaultShell: string
  launchAtLogin: boolean

  updateSettings: (patch: Partial<SettingsStoreData>) => void
  pushRecentWorkingTarget: (target: {
    workingFolder: string
    sshConnectionId?: string | null
  }) => void
  clearRecentWorkingTargets: () => void
}

type SettingsStoreData = Omit<
  SettingsStore,
  'updateSettings' | 'pushRecentWorkingTarget' | 'clearRecentWorkingTargets'
>

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: 'claude-sonnet-4-20250514',
      fastModel: 'claude-3-5-haiku-20241022',
      maxTokens: 32000,
      temperature: 0.7,
      systemPrompt: '',
      theme: DEFAULT_THEME_MODE,
      themePreset: DEFAULT_APP_THEME_PRESET,
      sshTerminalThemePreset: DEFAULT_SSH_TERMINAL_THEME_PRESET,
      language: detectSystemLanguage(),
      autoApprove: false,
      permissionPolicy: { ...DEFAULT_PERMISSION_POLICY },
      autoUpdateEnabled: true,
      clarifyAutoAcceptRecommended: false,
      clarifyPlanModeAutoSwitchTarget: 'off',
      devMode: false,
      thinkingEnabled: false,
      fastModeEnabled: false,
      reasoningEffort: 'medium',
      reasoningEffortByModel: {},
      teamToolsEnabled: false,
      builtinBrowserEnabled: true,
      hooksEnabled: false,
      browserUserDataReuseEnabled: true,
      browserUserDataSource: DEFAULT_BROWSER_USER_DATA_SOURCE,
      contextCompressionEnabled: true,
      contextCompressionThreshold: 0.8,
      editorWorkspaceEnabled: false,
      editorRemoteLanguageServiceEnabled: false,
      maxParallelToolCalls: DEFAULT_MAX_PARALLEL_TOOL_CALLS,
      maxToolCallsPerTurn: DEFAULT_MAX_TOOL_CALLS_PER_TURN,
      maxConcurrentSubAgents: DEFAULT_MAX_CONCURRENT_SUB_AGENTS,
      maxResidentTurns: DEFAULT_MAX_RESIDENT_TURNS,
      toolResultFormat: 'toon',
      fileDiffViewMode: 'split',
      shellExecutionEndpoint: DEFAULT_SHELL_EXECUTION_ENDPOINT,
      customShellExecutable: '',
      shellEnvironmentVariablesText: '',
      userName: '',
      userAvatar: '',
      onboardingCompleted: false,
      onboardingCompletedAt: null,
      onboardingInterests: [],
      defaultSoulTemplateId: '',
      defaultPersonaId: '',
      conversationGuideSeen: false,
      memoryUseMemories: true,
      memoryScopeMode: 'hybrid',
      memoryMaxRolloutsPerStartup: 8,
      memoryMinRolloutIdleHours: 0,
      memoryMaxRawMemoriesForConsolidation: 500,
      memoryMaxUnusedDays: 180,
      memorySummaryBudgetTokens: 12_000,

      // Memory organization & recall settings
      memoryOrganizationEnabled: true,
      memoryOrganizationSchedule: 'nightly',
      memoryOrganizationNightlyTime: '00:00',
      memoryOrganizationModel: null,
      memoryOrganizationThinkingMode: 'default',
      memoryOrganizationReasoningEffort: '',
      memoryWarmThresholdEphemeral: 7,
      memoryWarmThresholdStandard: 30,
      memoryWarmThresholdLasting: 90,
      memoryColdThresholdEphemeral: 21,
      memoryColdThresholdStandard: 90,
      memoryColdThresholdLasting: 180,
      memoryRecallMaxNotes: 5,
      memoryRecallMaxChars: 4000,
      memoryRecallMinScore: 0,
      memoryRecallGlobalFallback: true,
      memoryRecallVisibility: true,

      // Appearance Settings
      backgroundColor: '',
      fontFamily: '',
      fontSize: 16,
      animationsEnabled: true,
      liveOutputAnimationStyle: 'agile',
      toolbarCollapsedByDefault: false,
      leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
      updateBannerPosition: null,
      conversationPanelFullWidth: false,

      // Search (iter-29 S-23)
      browserSearch: { ...DEFAULT_BROWSER_SEARCH_SETTINGS },
      legacyWebSearch: null,

      // API Request Timeout (seconds, 0 = no limit, default 100s)
      apiRequestTimeoutSeconds: 100,

      // Provider max retry attempts on 429/5xx (0 = unlimited, default 10)
      requestMaxRetries: 10,

      // Provider fallback (iter-29 / S-21)
      providerFallback: createDefaultProviderFallback(),

      // CodeGraph Settings (opt-in standalone sidecar; default off)
      codegraphEnabled: false,
      codegraphFullToolSurface: false,

      // Network Settings
      systemProxyUrl: '',

      // Logging Settings (default: error only)
      logLevel: DEFAULT_LOG_LEVEL,

      // Session model selection
      newSessionDefaultModel: null,
      mainModelSelectionMode: 'auto',
      projectSessionDefaultCollaborationMode: 'cowork',
      coworkDefaultPermissionMode: 'fullAccess',
      codexConfigs: [createDefaultCodexConfig()],
      projectDefaultDirectoryMode: 'last-used',
      defaultShell: '',
      launchAtLogin: false,
      projectDefaultDirectory: '',
      lastProjectDirectory: '',
      recentWorkingTargets: [],

      updateSettings: (patch) =>
        set((state) => {
          const nextPatch = {
            ...patch,
            ...(patch.maxParallelToolCalls === undefined
              ? {}
              : { maxParallelToolCalls: clampMaxParallelToolCalls(patch.maxParallelToolCalls) }),
            ...(patch.maxToolCallsPerTurn === undefined
              ? {}
              : { maxToolCallsPerTurn: clampMaxToolCallsPerTurn(patch.maxToolCallsPerTurn) }),
            ...(patch.maxConcurrentSubAgents === undefined
              ? {}
              : {
                  maxConcurrentSubAgents: clampMaxConcurrentSubAgents(patch.maxConcurrentSubAgents)
                }),
            ...(patch.maxResidentTurns === undefined
              ? {}
              : { maxResidentTurns: clampMaxResidentTurns(patch.maxResidentTurns) })
          }

          const hasChanges = (Object.keys(nextPatch) as Array<keyof SettingsStoreData>).some(
            (key) => !Object.is(state[key], nextPatch[key])
          )
          return hasChanges ? nextPatch : state
        }),
      pushRecentWorkingTarget: (target) =>
        set((state) => ({
          recentWorkingTargets: sanitizeRecentWorkingTargets([
            {
              workingFolder: normalizeWorkingFolderPath(target.workingFolder),
              sshConnectionId: target.sshConnectionId ?? null,
              updatedAt: Date.now()
            },
            ...state.recentWorkingTargets
          ])
        })),
      clearRecentWorkingTargets: () => set({ recentWorkingTargets: [] })
    }),
    {
      name: 'wishfulclaw-settings',
      version: 39,
      storage: createJSONStorage(() => ipcStorage),
      migrate: (persisted: unknown, version: number) => {
        return migrateSettings(persisted, version) as unknown as SettingsStore
      },
      partialize: (state) => ({
        provider: state.provider,
        baseUrl: state.baseUrl,
        model: state.model,
        fastModel: state.fastModel,
        maxTokens: state.maxTokens,
        temperature: state.temperature,
        systemPrompt: state.systemPrompt,
        theme: state.theme,
        themePreset: state.themePreset,
        sshTerminalThemePreset: state.sshTerminalThemePreset,
        language: state.language,
        autoApprove: state.autoApprove,
        permissionPolicy: state.permissionPolicy,
        autoUpdateEnabled: state.autoUpdateEnabled,
        clarifyAutoAcceptRecommended: state.clarifyAutoAcceptRecommended,
        clarifyPlanModeAutoSwitchTarget: state.clarifyPlanModeAutoSwitchTarget,
        devMode: state.devMode,
        thinkingEnabled: state.thinkingEnabled,
        fastModeEnabled: state.fastModeEnabled,
        reasoningEffort: state.reasoningEffort,
        reasoningEffortByModel: state.reasoningEffortByModel,
        teamToolsEnabled: state.teamToolsEnabled,
        contextCompressionEnabled: state.contextCompressionEnabled,
        contextCompressionThreshold: state.contextCompressionThreshold,
        editorWorkspaceEnabled: state.editorWorkspaceEnabled,
        editorRemoteLanguageServiceEnabled: state.editorRemoteLanguageServiceEnabled,
        maxParallelToolCalls: clampMaxParallelToolCalls(state.maxParallelToolCalls),
        maxToolCallsPerTurn: clampMaxToolCallsPerTurn(state.maxToolCallsPerTurn),
        maxConcurrentSubAgents: clampMaxConcurrentSubAgents(state.maxConcurrentSubAgents),
        maxResidentTurns: clampMaxResidentTurns(state.maxResidentTurns),
        toolResultFormat: state.toolResultFormat,
        fileDiffViewMode: state.fileDiffViewMode,
        shellExecutionEndpoint: normalizeShellExecutionEndpoint(state.shellExecutionEndpoint),
        customShellExecutable: state.customShellExecutable,
        shellEnvironmentVariablesText: state.shellEnvironmentVariablesText,
        userName: state.userName,
        userAvatar: state.userAvatar,
        onboardingCompleted: state.onboardingCompleted,
        onboardingCompletedAt: state.onboardingCompletedAt,
        onboardingInterests: state.onboardingInterests,
        defaultSoulTemplateId: state.defaultSoulTemplateId,
        defaultPersonaId: state.defaultPersonaId,
        conversationGuideSeen: state.conversationGuideSeen,
        memoryUseMemories: state.memoryUseMemories,
        memoryScopeMode: 'hybrid' as const,
        memoryMaxRolloutsPerStartup: state.memoryMaxRolloutsPerStartup,
        memoryMinRolloutIdleHours: state.memoryMinRolloutIdleHours,
        memoryMaxRawMemoriesForConsolidation: state.memoryMaxRawMemoriesForConsolidation,
        memoryMaxUnusedDays: state.memoryMaxUnusedDays,
        memorySummaryBudgetTokens: state.memorySummaryBudgetTokens,
        memoryOrganizationEnabled: state.memoryOrganizationEnabled,
        memoryOrganizationSchedule: state.memoryOrganizationSchedule,
        memoryOrganizationNightlyTime: state.memoryOrganizationNightlyTime,
        memoryOrganizationModel: state.memoryOrganizationModel,
        memoryOrganizationThinkingMode: state.memoryOrganizationThinkingMode,
        memoryOrganizationReasoningEffort: state.memoryOrganizationReasoningEffort,
        memoryWarmThresholdEphemeral: state.memoryWarmThresholdEphemeral,
        memoryWarmThresholdStandard: state.memoryWarmThresholdStandard,
        memoryWarmThresholdLasting: state.memoryWarmThresholdLasting,
        memoryColdThresholdEphemeral: state.memoryColdThresholdEphemeral,
        memoryColdThresholdStandard: state.memoryColdThresholdStandard,
        memoryColdThresholdLasting: state.memoryColdThresholdLasting,
        memoryRecallMaxNotes: state.memoryRecallMaxNotes,
        memoryRecallMaxChars: state.memoryRecallMaxChars,
        memoryRecallMinScore: state.memoryRecallMinScore,
        memoryRecallGlobalFallback: state.memoryRecallGlobalFallback,
        memoryRecallVisibility: state.memoryRecallVisibility,
        // Appearance Settings
        backgroundColor: state.backgroundColor,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        animationsEnabled: state.animationsEnabled,
        liveOutputAnimationStyle: state.liveOutputAnimationStyle,
        toolbarCollapsedByDefault: state.toolbarCollapsedByDefault,
        leftSidebarWidth: clampLeftSidebarWidth(state.leftSidebarWidth),
        conversationPanelFullWidth: state.conversationPanelFullWidth,
        // Search (iter-29 S-23)
        browserSearch: state.browserSearch,
        legacyWebSearch: state.legacyWebSearch,
        apiRequestTimeoutSeconds: clampApiRequestTimeoutSeconds(
          state.apiRequestTimeoutSeconds
        ),
        requestMaxRetries: clampRequestMaxRetries(state.requestMaxRetries),
        providerFallback: normalizeProviderFallback(state.providerFallback),
        // CodeGraph Settings
        codegraphEnabled: state.codegraphEnabled,
        codegraphFullToolSurface: state.codegraphFullToolSurface,
        // Network Settings
        systemProxyUrl: state.systemProxyUrl,
        // Logging Settings
        logLevel: normalizeLogLevel(state.logLevel),
        // Session model selection
        newSessionDefaultModel: state.newSessionDefaultModel,
        mainModelSelectionMode: state.mainModelSelectionMode,
        projectSessionDefaultCollaborationMode: state.projectSessionDefaultCollaborationMode,
        coworkDefaultPermissionMode: state.coworkDefaultPermissionMode,
        codexConfigs: state.codexConfigs,
        projectDefaultDirectoryMode: state.projectDefaultDirectoryMode,
        projectDefaultDirectory: state.projectDefaultDirectory,
        lastProjectDirectory: state.lastProjectDirectory,
        recentWorkingTargets: state.recentWorkingTargets,
        defaultShell: state.defaultShell,
        launchAtLogin: state.launchAtLogin,
        builtinBrowserEnabled: state.builtinBrowserEnabled,
        hooksEnabled: state.hooksEnabled,
        browserUserDataReuseEnabled: state.browserUserDataReuseEnabled,
        browserUserDataSource: normalizeBrowserUserDataSource(state.browserUserDataSource)
        // NOTE: apiKey is intentionally excluded from localStorage persistence.
        // In production, it should be stored securely in the main process.
      })
    }
  )
)
