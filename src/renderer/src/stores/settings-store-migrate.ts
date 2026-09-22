import type { PermissionPolicy } from '../../../shared/permission-policy'
import { sanitizePermissionPolicy } from '../../../shared/permission-policy'
import {
  DEFAULT_LOG_LEVEL,
  normalizeLogLevel
} from '../../../shared/logging'
import {
  DEFAULT_APP_THEME_PRESET,
  DEFAULT_SSH_TERMINAL_THEME_PRESET,
  isAppThemePreset
} from '../lib/theme-presets'
import {
  clampLeftSidebarWidth
} from '@renderer/components/layout/right-panel-defs'
import {
  normalizeBrowserUserDataSource,
  type BrowserUserDataSource
} from '../../../shared/browser-plugin'
import {
  detectSystemLanguage,
  normalizeLanguageCode
} from '@renderer/lib/i18n-language'
import type { ShellExecutionEndpoint } from './settings-store-types'
import { DEFAULT_BROWSER_SEARCH_SETTINGS } from '@renderer/lib/tools/browser-search/engines'
import {
  DEFAULT_MAX_CONCURRENT_SUB_AGENTS,
  DEFAULT_REQUEST_MAX_RETRIES,
  DEFAULT_MAX_PARALLEL_TOOL_CALLS,
  DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_RESIDENT_TURNS,
  DEFAULT_THEME_MODE,
  DEFAULT_GLOBAL_CONTEXT_CAP_TOKENS,
  clampGlobalContextCapTokens,
  clampMaxConcurrentSubAgents,
  clampRequestMaxRetries,
  clampMaxParallelToolCalls,
  clampMaxToolCallsPerTurn,
  clampMaxResidentTurns,
  isThemeSetting,
  normalizeShellExecutionEndpoint,
  normalizeProviderFallback,
  sanitizeCodexConfigs,
  sanitizeRecentWorkingTargets,
  LEGACY_DEFAULT_THEME_MODE,
  LEGACY_DEFAULT_APP_THEME_PRESET,
  LEGACY_DEFAULT_SSH_TERMINAL_THEME_PRESET,
  V17_DEFAULT_THEME_MODE,
  V17_DEFAULT_APP_THEME_PRESET,
  V17_DEFAULT_SSH_TERMINAL_THEME_PRESET,
  V18_DEFAULT_THEME_MODE,
  V18_DEFAULT_APP_THEME_PRESET,
  V18_DEFAULT_SSH_TERMINAL_THEME_PRESET
} from './settings-store-types'
import {
  DEFAULT_API_REQUEST_TIMEOUT_SECONDS,
  clampApiRequestTimeoutSeconds
} from './settings-store'
import { LEFT_SIDEBAR_DEFAULT_WIDTH } from '@renderer/components/layout/right-panel-defs'

/**
 * Migrate persisted settings state to the current schema.
 * Handles version upgrades, field defaults, and theme preset normalization.
 */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const state = persisted as Record<string, unknown>
  const matchesLegacyThemeDefaults =
    (state.theme === undefined || state.theme === LEGACY_DEFAULT_THEME_MODE) &&
    (state.themePreset === undefined ||
      state.themePreset === LEGACY_DEFAULT_APP_THEME_PRESET) &&
    (state.sshTerminalThemePreset === undefined ||
      state.sshTerminalThemePreset === LEGACY_DEFAULT_SSH_TERMINAL_THEME_PRESET)
  const matchesV17ThemeDefaults =
    (state.theme === undefined || state.theme === V17_DEFAULT_THEME_MODE) &&
    (state.themePreset === undefined || state.themePreset === V17_DEFAULT_APP_THEME_PRESET) &&
    (state.sshTerminalThemePreset === undefined ||
      state.sshTerminalThemePreset === V17_DEFAULT_SSH_TERMINAL_THEME_PRESET)
  const matchesV18ThemeDefaults =
    (state.theme === undefined || state.theme === V18_DEFAULT_THEME_MODE) &&
    (state.themePreset === undefined || state.themePreset === V18_DEFAULT_APP_THEME_PRESET) &&
    (state.sshTerminalThemePreset === undefined ||
      state.sshTerminalThemePreset === V18_DEFAULT_SSH_TERMINAL_THEME_PRESET)
  if (typeof state.language === 'string') {
    state.language = normalizeLanguageCode(state.language)
  } else {
    state.language = detectSystemLanguage()
  }
  // iter-29 (S-23): the API-backed WebSearch chain was retired. Its six settings
  // fields are not deleted — an existing provider choice and API key are moved
  // into `legacyWebSearch` so nothing the user configured disappears. The search
  // configuration itself lives in `browserSearch` from here on.
  if (state.browserSearch === undefined || typeof state.browserSearch !== 'object') {
    state.browserSearch = { ...DEFAULT_BROWSER_SEARCH_SETTINGS }
  }
  if (state.legacyWebSearch === undefined) {
    const hasLegacyConfig =
      state.webSearchProvider !== undefined ||
      state.webSearchApiKey !== undefined ||
      state.webSearchEnabled !== undefined
    state.legacyWebSearch = hasLegacyConfig
      ? {
          enabled: state.webSearchEnabled === true,
          provider: typeof state.webSearchProvider === 'string' ? state.webSearchProvider : 'tavily',
          apiKey: typeof state.webSearchApiKey === 'string' ? state.webSearchApiKey : '',
          engine: typeof state.webSearchEngine === 'string' ? state.webSearchEngine : 'google',
          maxResults:
            typeof state.webSearchMaxResults === 'number' ? state.webSearchMaxResults : 5,
          timeout: typeof state.webSearchTimeout === 'number' ? state.webSearchTimeout : 30000
        }
      : null
  }
  delete state.webSearchEnabled
  delete state.webSearchProvider
  delete state.webSearchApiKey
  delete state.webSearchEngine
  delete state.webSearchMaxResults
  delete state.webSearchTimeout
  if (state.systemProxyUrl === undefined) {
    state.systemProxyUrl = ''
  }
  if (state.apiRequestTimeoutSeconds === undefined ||
      typeof state.apiRequestTimeoutSeconds !== 'number') {
    state.apiRequestTimeoutSeconds = DEFAULT_API_REQUEST_TIMEOUT_SECONDS
  } else {
    state.apiRequestTimeoutSeconds = clampApiRequestTimeoutSeconds(
      state.apiRequestTimeoutSeconds as number
    )
  }
  // Add CodeGraph opt-in flag if missing (default off)
  if (state.requestMaxRetries === undefined ||
      typeof state.requestMaxRetries !== 'number') {
    state.requestMaxRetries = DEFAULT_REQUEST_MAX_RETRIES
  } else {
    state.requestMaxRetries = clampRequestMaxRetries(
      state.requestMaxRetries as number
    )
  }
  // v36: log level moved into the unified settings store (default: error only)
  if (state.logLevel === undefined) {
    state.logLevel = DEFAULT_LOG_LEVEL
  } else {
    state.logLevel = normalizeLogLevel(state.logLevel)
  }
  if (state.codegraphEnabled === undefined) {
    state.codegraphEnabled = false
  }
  if (state.codegraphFullToolSurface === undefined) {
    state.codegraphFullToolSurface = false
  }
  if (state.newSessionDefaultModel === undefined) {
    state.newSessionDefaultModel = null
  }
  if (
    typeof state.contextCompressionThreshold !== 'number' ||
    !Number.isFinite(state.contextCompressionThreshold)
  ) {
    state.contextCompressionThreshold = 0.8
  } else {
    state.contextCompressionThreshold = Math.min(
      0.9,
      Math.max(0.3, state.contextCompressionThreshold as number)
    )
  }
  // v41 / S-107 调档：全局上限从手输数字改成固定档位（200K / 400K / 800K / 1M），
  // 取消了「不限制」。历史值必须在这里吸附一次 —— 只靠 partialize 是不够的：那只管写回
  // 磁盘，内存里仍是老值，会出现「滑杆停在 400K、发给后端的还是 384000」这种前后端两套账。
  // 老配置里的 0（旧的「不限制」哨兵）和缺失值一律落到默认档 1M，不会被压到 200K。
  if (state.contextCapTokens === undefined || typeof state.contextCapTokens !== 'number') {
    state.contextCapTokens = DEFAULT_GLOBAL_CONTEXT_CAP_TOKENS
  } else {
    state.contextCapTokens = clampGlobalContextCapTokens(state.contextCapTokens as number)
  }
  if (state.mainModelSelectionMode === undefined) {
    state.mainModelSelectionMode = 'auto'
  }
  if (
    state.projectSessionDefaultCollaborationMode !== 'chat' &&
    state.projectSessionDefaultCollaborationMode !== 'cowork'
  ) {
    state.projectSessionDefaultCollaborationMode = 'cowork'
  }
  if (
    state.coworkDefaultPermissionMode !== 'default' &&
    state.coworkDefaultPermissionMode !== 'fullAccess'
  ) {
    state.coworkDefaultPermissionMode = 'fullAccess'
  }
  state.codexConfigs = sanitizeCodexConfigs(state.codexConfigs)
  state.permissionPolicy = sanitizePermissionPolicy(state.permissionPolicy as PermissionPolicy)
  if (state.projectDefaultDirectoryMode === undefined) {
    state.projectDefaultDirectoryMode = 'last-used'
  }
  if (state.projectDefaultDirectory === undefined) {
    state.projectDefaultDirectory = ''
  }
  if (state.lastProjectDirectory === undefined) {
    state.lastProjectDirectory = ''
  }
  state.recentWorkingTargets = sanitizeRecentWorkingTargets(state.recentWorkingTargets)
  if (state.launchAtLogin === undefined) {
    state.launchAtLogin = false
  }
  // Add appearance settings if missing
  if (!isThemeSetting(state.theme)) {
    state.theme = DEFAULT_THEME_MODE
  } else if (
    (version < 17 && matchesLegacyThemeDefaults) ||
    (version < 18 && matchesV17ThemeDefaults) ||
    (version < 19 && matchesV18ThemeDefaults)
  ) {
    state.theme = DEFAULT_THEME_MODE
  }
  if (state.backgroundColor === undefined) {
    state.backgroundColor = ''
  }
  // 统一迁移为默认配色（远航蓝 ocean），覆盖任何历史默认值（如旧版 graphite）
  state.themePreset = DEFAULT_APP_THEME_PRESET
  if (!isAppThemePreset(state.sshTerminalThemePreset as string)) {
    state.sshTerminalThemePreset = DEFAULT_SSH_TERMINAL_THEME_PRESET
  } else if (
    (version < 17 && matchesLegacyThemeDefaults) ||
    (version < 18 && matchesV17ThemeDefaults) ||
    (version < 19 && matchesV18ThemeDefaults)
  ) {
    state.sshTerminalThemePreset = DEFAULT_SSH_TERMINAL_THEME_PRESET
  }
  if (state.fontFamily === undefined) {
    state.fontFamily = ''
  }
  if (state.fontSize === undefined || typeof state.fontSize !== 'number') {
    state.fontSize = 16
  }
  if (state.animationsEnabled === undefined) {
    state.animationsEnabled = true
  }
  if (
    state.liveOutputAnimationStyle === undefined ||
    (state.liveOutputAnimationStyle !== 'agile' &&
      state.liveOutputAnimationStyle !== 'elegant')
  ) {
    state.liveOutputAnimationStyle = 'agile'
  }
  if (state.toolbarCollapsedByDefault === undefined) {
    state.toolbarCollapsedByDefault = false
  }
  if (state.leftSidebarWidth === undefined || typeof state.leftSidebarWidth !== 'number') {
    state.leftSidebarWidth = LEFT_SIDEBAR_DEFAULT_WIDTH
  } else {
    state.leftSidebarWidth = clampLeftSidebarWidth(state.leftSidebarWidth as number)
  }
  if (state.conversationPanelFullWidth === undefined) {
    state.conversationPanelFullWidth = false
  }
  if (state.autoUpdateEnabled === undefined) {
    state.autoUpdateEnabled = true
  }
  if (state.clarifyAutoAcceptRecommended === undefined) {
    state.clarifyAutoAcceptRecommended = false
  }
  if (state.clarifyPlanModeAutoSwitchTarget === undefined) {
    state.clarifyPlanModeAutoSwitchTarget = 'off'
  }
  if (state.editorWorkspaceEnabled === undefined) {
    state.editorWorkspaceEnabled = false
  }
  if (state.editorRemoteLanguageServiceEnabled === undefined) {
    state.editorRemoteLanguageServiceEnabled = false
  }
  if (typeof state.hooksEnabled !== 'boolean') {
    state.hooksEnabled = false
  }
  if (
    state.maxParallelToolCalls === undefined ||
    typeof state.maxParallelToolCalls !== 'number'
  ) {
    state.maxParallelToolCalls = DEFAULT_MAX_PARALLEL_TOOL_CALLS
  } else {
    state.maxParallelToolCalls = clampMaxParallelToolCalls(state.maxParallelToolCalls as number)
  }
  if (
    state.maxToolCallsPerTurn === undefined ||
    typeof state.maxToolCallsPerTurn !== 'number'
  ) {
    state.maxToolCallsPerTurn = DEFAULT_MAX_TOOL_CALLS_PER_TURN
  } else {
    state.maxToolCallsPerTurn = clampMaxToolCallsPerTurn(state.maxToolCallsPerTurn as number)
  }
  if (
    state.maxConcurrentSubAgents === undefined ||
    typeof state.maxConcurrentSubAgents !== 'number'
  ) {
    state.maxConcurrentSubAgents = DEFAULT_MAX_CONCURRENT_SUB_AGENTS
  } else {
    state.maxConcurrentSubAgents = clampMaxConcurrentSubAgents(state.maxConcurrentSubAgents as number)
  }
  if (
    state.maxResidentTurns === undefined ||
    typeof state.maxResidentTurns !== 'number'
  ) {
    state.maxResidentTurns = DEFAULT_MAX_RESIDENT_TURNS
  } else {
    state.maxResidentTurns = clampMaxResidentTurns(state.maxResidentTurns as number)
  }
  if (state.reasoningEffortByModel === undefined) {
    state.reasoningEffortByModel = {}
  }
  if (state.toolResultFormat === undefined) {
    state.toolResultFormat = 'toon'
  }
  if (state.fileDiffViewMode === undefined) {
    state.fileDiffViewMode = 'split'
  }
  if (state.browserUserDataReuseEnabled === undefined) {
    state.browserUserDataReuseEnabled = true
  }
  state.browserUserDataSource = normalizeBrowserUserDataSource(state.browserUserDataSource as BrowserUserDataSource)
  state.shellExecutionEndpoint = normalizeShellExecutionEndpoint(state.shellExecutionEndpoint as ShellExecutionEndpoint)
  if (typeof state.customShellExecutable !== 'string') {
    state.customShellExecutable = ''
  }
  if (typeof state.shellEnvironmentVariablesText !== 'string') {
    state.shellEnvironmentVariablesText = ''
  }
  if (state.onboardingCompleted === undefined) {
    state.onboardingCompleted = false
  }
  if (
    state.onboardingCompletedAt !== null &&
    typeof state.onboardingCompletedAt !== 'number'
  ) {
    state.onboardingCompletedAt = null
  }
  if (!Array.isArray(state.onboardingInterests)) {
    state.onboardingInterests = []
  } else {
    state.onboardingInterests = state.onboardingInterests.filter(
      (item: unknown): item is string => typeof item === 'string' && (item as string).trim().length > 0
    )
  }
  if (typeof state.defaultSoulTemplateId !== 'string') {
    state.defaultSoulTemplateId = ''
  }
  if (state.conversationGuideSeen === undefined) {
    state.conversationGuideSeen = false
  }
  if (state.memoryUseMemories === undefined) {
    state.memoryUseMemories = true
  }
  state.memoryScopeMode = 'hybrid'
  if (
    state.memoryMaxRolloutsPerStartup === undefined ||
    typeof state.memoryMaxRolloutsPerStartup !== 'number'
  ) {
    state.memoryMaxRolloutsPerStartup = 8
  }
  if (
    state.memoryMinRolloutIdleHours === undefined ||
    typeof state.memoryMinRolloutIdleHours !== 'number'
  ) {
    state.memoryMinRolloutIdleHours = 0
  }
  if (
    state.memoryMaxRawMemoriesForConsolidation === undefined ||
    typeof state.memoryMaxRawMemoriesForConsolidation !== 'number'
  ) {
    state.memoryMaxRawMemoriesForConsolidation = 500
  }
  if (
    state.memoryMaxUnusedDays === undefined ||
    typeof state.memoryMaxUnusedDays !== 'number'
  ) {
    state.memoryMaxUnusedDays = 180
  }
  if (
    state.memorySummaryBudgetTokens === undefined ||
    typeof state.memorySummaryBudgetTokens !== 'number'
  ) {
    state.memorySummaryBudgetTokens = 12_000
  }

  // Memory organization & recall settings (daily memory organization plan)
  if (state.memoryOrganizationEnabled === undefined) {
    state.memoryOrganizationEnabled = true
  }
  if (state.memoryOrganizationSchedule !== 'nightly' && state.memoryOrganizationSchedule !== 'startup') {
    state.memoryOrganizationSchedule = 'nightly'
  }
  if (typeof state.memoryOrganizationNightlyTime !== 'string' || !/^\d{2}:\d{2}$/.test(state.memoryOrganizationNightlyTime)) {
    state.memoryOrganizationNightlyTime = '00:00'
  }
  const organizationModel = state.memoryOrganizationModel
  const organizationProviderId =
    organizationModel && typeof organizationModel === 'object' && !Array.isArray(organizationModel) &&
    typeof (organizationModel as Record<string, unknown>).providerId === 'string'
      ? (organizationModel as Record<string, string>).providerId.trim()
      : ''
  const organizationModelId =
    organizationModel && typeof organizationModel === 'object' && !Array.isArray(organizationModel) &&
    typeof (organizationModel as Record<string, unknown>).modelId === 'string'
      ? (organizationModel as Record<string, string>).modelId.trim()
      : ''
  if (!organizationProviderId || !organizationModelId) {
    state.memoryOrganizationModel = null
  } else {
    state.memoryOrganizationModel = {
      providerId: organizationProviderId,
      modelId: organizationModelId
    }
  }
  if (
    state.memoryOrganizationThinkingMode !== 'default' &&
    state.memoryOrganizationThinkingMode !== 'enabled' &&
    state.memoryOrganizationThinkingMode !== 'disabled'
  ) {
    state.memoryOrganizationThinkingMode = 'default'
  }
  const validReasoningEfforts = new Set([
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  ])
  if (
    state.memoryOrganizationReasoningEffort !== '' &&
    (typeof state.memoryOrganizationReasoningEffort !== 'string' ||
      !validReasoningEfforts.has(state.memoryOrganizationReasoningEffort))
  ) {
    state.memoryOrganizationReasoningEffort = ''
  }
  if (typeof state.memoryWarmThresholdEphemeral !== 'number') {
    state.memoryWarmThresholdEphemeral = 7
  }
  if (typeof state.memoryWarmThresholdStandard !== 'number') {
    state.memoryWarmThresholdStandard = 30
  }
  if (typeof state.memoryWarmThresholdLasting !== 'number') {
    state.memoryWarmThresholdLasting = 90
  }
  if (typeof state.memoryColdThresholdEphemeral !== 'number') {
    state.memoryColdThresholdEphemeral = 21
  }
  if (typeof state.memoryColdThresholdStandard !== 'number') {
    state.memoryColdThresholdStandard = 90
  }
  if (typeof state.memoryColdThresholdLasting !== 'number') {
    state.memoryColdThresholdLasting = 180
  }
  if (typeof state.memoryRecallMaxNotes !== 'number') {
    state.memoryRecallMaxNotes = 5
  }
  if (typeof state.memoryRecallMaxChars !== 'number') {
    state.memoryRecallMaxChars = 4000
  }
  if (typeof state.memoryRecallMinScore !== 'number') {
    state.memoryRecallMinScore = 0
  }
  if (state.memoryRecallGlobalFallback === undefined) {
    state.memoryRecallGlobalFallback = true
  }
  if (state.memoryRecallVisibility === undefined) {
    state.memoryRecallVisibility = true
  }
  // iter-29 (S-21): provider fallback. Normalized rather than replaced wholesale, so a
  // chain the user already built survives a reload. This is also where the pre-model
  // shape (`priority: string[]`) is upgraded: each provider is carried over with an
  // empty modelId, which the runtime skips until the user picks one.
  state.providerFallback = normalizeProviderFallback(state.providerFallback)
  return state
}
