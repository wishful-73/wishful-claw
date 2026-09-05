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
import { type ModelBinding, type SessionDefaultModelBinding, type ClaudeCodeConfig, type CodexConfig, type PromptRecommendationModelBindings, type MemoryOrganizationThinkingMode, type ClarifyPlanModeAutoSwitchTarget, type RecentWorkingTarget, type FileDiffViewMode, type LiveOutputAnimationStyle, type ShellExecutionEndpoint, type MainModelSelectionMode, type ProjectSessionDefaultCollaborationMode, type CoworkDefaultPermissionMode, type MemoryScopeMode, type MemoryOrganizationSchedule, type ProjectDefaultDirectoryMode, DEFAULT_THEME_MODE, DEFAULT_MAX_PARALLEL_TOOL_CALLS, DEFAULT_MAX_CONCURRENT_SUB_AGENTS, DEFAULT_MAX_TOOL_CALLS_PER_TURN, DEFAULT_SHELL_EXECUTION_ENDPOINT, createDefaultClaudeCodeConfig, createDefaultCodexConfig, normalizeShellExecutionEndpoint, sanitizeRecentWorkingTargets, clampMaxConcurrentSubAgents, clampMaxParallelToolCalls, clampMaxToolCallsPerTurn, clampRequestMaxRetries } from './settings-store-types'

// Re-export types for consumers
export type {
  ClarifyPlanModeAutoSwitchTarget,
  ClaudeCodeConfig,
  ClaudeCodePermissionOption,
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
  PromptRecommendationModelBinding,
  PromptRecommendationModelBindings,
  RecentWorkingTarget,
  SessionDefaultModelBinding,
  ShellExecutionEndpoint,
  ThemeMode,
} from './settings-store-types'
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
  DEFAULT_SHELL_EXECUTION_ENDPOINT,
  DEFAULT_THEME_MODE,
  MAX_MAX_CONCURRENT_SUB_AGENTS,
  MAX_MAX_PARALLEL_TOOL_CALLS,
  MAX_MAX_TOOL_CALLS_PER_TURN,
  MIN_MAX_CONCURRENT_SUB_AGENTS,
  MIN_MAX_PARALLEL_TOOL_CALLS,
  MIN_MAX_TOOL_CALLS_PER_TURN,
  clampMaxConcurrentSubAgents,
  clampMaxParallelToolCalls,
  clampMaxToolCallsPerTurn,
  createDefaultClaudeCodeConfig,
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
  /** Dedicated summarizer model. Null keeps using the current session model. */
  contextCompressionModel: ModelBinding | null
  editorWorkspaceEnabled: boolean
  editorRemoteLanguageServiceEnabled: boolean
  maxParallelToolCalls: number
  maxToolCallsPerTurn: number
  maxConcurrentSubAgents: number
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
  /** Chat column fills the whole conversation panel instead of the 820px cap. */
  conversationPanelFullWidth: boolean

  // Web Search Settings
  webSearchEnabled: boolean
  webSearchProvider:
    | 'tavily'
    | 'searxng'
    | 'exa'
    | 'exa-mcp'
    | 'bocha'
    | 'zhipu'
    | 'google'
    | 'bing'
    | 'baidu'
  webSearchApiKey: string
  webSearchEngine: string
  webSearchMaxResults: number
  webSearchTimeout: number

  // API Request Timeout (seconds, 0 = no limit)
  apiRequestTimeoutSeconds: number

  // Provider max retry attempts on 429/5xx (0 = unlimited, default 10)
  requestMaxRetries: number

  // CodeGraph Settings (opt-in standalone sidecar; default off)
  codegraphEnabled: boolean
  // Register the full 8-tool CodeGraph surface for agents (default: explore only,
  // matching upstream's DEFAULT_MCP_TOOLS)
  codegraphFullToolSurface: boolean

  // Network Settings
  systemProxyUrl: string

  // Prompt Recommendation Settings
  promptRecommendationModels: PromptRecommendationModelBindings
  newSessionDefaultModel: SessionDefaultModelBinding | null
  mainModelSelectionMode: MainModelSelectionMode
  projectSessionDefaultCollaborationMode: ProjectSessionDefaultCollaborationMode
  coworkDefaultPermissionMode: CoworkDefaultPermissionMode
  claudeCodeConfigs: ClaudeCodeConfig[]
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
      contextCompressionModel: null,
      editorWorkspaceEnabled: false,
      editorRemoteLanguageServiceEnabled: false,
      maxParallelToolCalls: DEFAULT_MAX_PARALLEL_TOOL_CALLS,
      maxToolCallsPerTurn: DEFAULT_MAX_TOOL_CALLS_PER_TURN,
      maxConcurrentSubAgents: DEFAULT_MAX_CONCURRENT_SUB_AGENTS,
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
      conversationPanelFullWidth: false,

      // Web Search Settings
      webSearchEnabled: false,
      webSearchProvider: 'tavily',
      webSearchApiKey: '',
      webSearchEngine: 'google',
      webSearchMaxResults: 5,
      webSearchTimeout: 30000,

      // API Request Timeout (seconds, 0 = no limit, default 100s)
      apiRequestTimeoutSeconds: 100,

      // Provider max retry attempts on 429/5xx (0 = unlimited, default 10)
      requestMaxRetries: 10,

      // CodeGraph Settings (opt-in standalone sidecar; default off)
      codegraphEnabled: false,
      codegraphFullToolSurface: false,

      // Network Settings
      systemProxyUrl: '',

      // Prompt Recommendation Settings
      promptRecommendationModels: {
        chat: null,
        clarify: null,
        cowork: null,
        code: null,
        acp: null
      },
      newSessionDefaultModel: null,
      mainModelSelectionMode: 'auto',
      projectSessionDefaultCollaborationMode: 'cowork',
      coworkDefaultPermissionMode: 'fullAccess',
      claudeCodeConfigs: [createDefaultClaudeCodeConfig()],
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
                })
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
      version: 35,
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
        contextCompressionModel: state.contextCompressionModel,
        editorWorkspaceEnabled: state.editorWorkspaceEnabled,
        editorRemoteLanguageServiceEnabled: state.editorRemoteLanguageServiceEnabled,
        maxParallelToolCalls: clampMaxParallelToolCalls(state.maxParallelToolCalls),
        maxToolCallsPerTurn: clampMaxToolCallsPerTurn(state.maxToolCallsPerTurn),
        maxConcurrentSubAgents: clampMaxConcurrentSubAgents(state.maxConcurrentSubAgents),
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
        // Web Search Settings
        webSearchEnabled: state.webSearchEnabled,
        webSearchProvider: state.webSearchProvider,
        webSearchApiKey: state.webSearchApiKey,
        webSearchEngine: state.webSearchEngine,
        webSearchMaxResults: state.webSearchMaxResults,
        webSearchTimeout: state.webSearchTimeout,
        apiRequestTimeoutSeconds: clampApiRequestTimeoutSeconds(
          state.apiRequestTimeoutSeconds
        ),
        requestMaxRetries: clampRequestMaxRetries(state.requestMaxRetries),
        // CodeGraph Settings
        codegraphEnabled: state.codegraphEnabled,
        codegraphFullToolSurface: state.codegraphFullToolSurface,
        // Network Settings
        systemProxyUrl: state.systemProxyUrl,
        // Prompt Recommendation Settings
        promptRecommendationModels: state.promptRecommendationModels,
        newSessionDefaultModel: state.newSessionDefaultModel,
        mainModelSelectionMode: state.mainModelSelectionMode,
        projectSessionDefaultCollaborationMode: state.projectSessionDefaultCollaborationMode,
        coworkDefaultPermissionMode: state.coworkDefaultPermissionMode,
        claudeCodeConfigs: state.claudeCodeConfigs,
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
