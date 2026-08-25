import { nanoid } from 'nanoid'
import type { AIProvider, AIModelConfig, BuiltinProviderPreset, ProviderType, ReasoningEffortLevel } from '../../../shared/types/provider'
import type { ManagedModelConfig } from './managed-models'
import { builtinProviderPresets } from '@renderer/stores/providers'
import { useProviderStore } from '@renderer/stores/provider-store'

export const STORAGE_KEY = 'wishful-claw-providers'

export { builtinProviderPresets }
export type { ManagedModelConfig } from './managed-models'
export type { BuiltinProviderPreset }

export interface ProviderState {
  providers: AIProvider[]
  activeProviderId: string | null
  activeModelId: string
  activeFastProviderId: string | null
  activeFastModelId: string
  defaultModel: string | null

  // ── Selectors ──
  getActiveProvider: () => AIProvider | null
  getProviderById: (id: string) => AIProvider | null

  // ── Mutations ──
  addProviderFromPreset: (preset: BuiltinProviderPreset) => AIProvider
  addCustomProvider: (name: string, type: ProviderType, baseUrl: string) => AIProvider
  updateProvider: (id: string, updates: Partial<AIProvider>) => void
  deleteProvider: (id: string) => void
  setActiveProvider: (id: string) => void
  setActiveModel: (modelId: string) => void
  setActiveFastProvider: (id: string) => void
  setActiveFastModel: (modelId: string) => void
  getFastProviderConfig: () => { providerId: string; model: string; apiKey?: string; requiresApiKey?: boolean; baseUrl?: string } | null
  // Speech provider stubs (for pet voice features)
  activeSpeechProviderId: string | null
  activeSpeechModelId: string
  getProviderConfigById: (id: string, _modelId?: string) => AIProvider | null
  getActiveModelConfig: () => { responseSummary?: any; enablePromptCache?: boolean; enableSystemPromptCache?: boolean } | null
  getEffectiveMaxTokens: (userDefault?: number | null, modelId?: string) => number
  getCompressionProviderConfig: () => { providerId: string | undefined; model: string } | null
  getTranslationProviderConfig: () => { providerId: string | null; model: string } | null
  activeImageProviderId: string | null
  activeImageModelId: string
  activeTranslationProviderId: string | null
  activeTranslationModelId: string
  getSpeechProviderConfig: () => { providerId: string | null; model: string } | null
  setDefaultModel: (modelId: string) => void

  // ── Model management ──
  addModel: (providerId: string, model: AIModelConfig) => void
  updateModel: (providerId: string, modelId: string, updates: Partial<AIModelConfig>) => void
  deleteModel: (providerId: string, modelId: string) => void
  setModels: (providerId: string, models: AIModelConfig[]) => void

  // ── Managed models (global model library) ──
  managedModels: ManagedModelConfig[]
  managedModelTombstones: string[]
  addManagedModel: (model: AIModelConfig) => void
  updateManagedModel: (modelId: string, model: AIModelConfig) => void
  removeManagedModel: (modelId: string) => void
  resetModelConfigurationToDefaults: () => void
  getManagedModelById: (modelId: string) => ManagedModelConfig | null

  // ── Worker API (test + fetch models) ──
  testConnection: (provider: AIProvider, modelId?: string) => Promise<{ ok: boolean; statusCode?: number; error?: string }>
  fetchModels: (provider: AIProvider) => Promise<AIModelConfig[]>
}

export function createProviderFromPreset(preset: BuiltinProviderPreset): AIProvider {
  return {
    id: nanoid(),
    name: preset.name,
    type: preset.type,
    apiKey: '',
    baseUrl: preset.defaultBaseUrl,
    enabled: preset.defaultEnabled ?? false,
    models: preset.defaultModels.map(m => ({ ...m })),
    builtinId: preset.builtinId,
    presetVersion: preset.version,
    createdAt: Date.now(),
    requiresApiKey: preset.requiresApiKey ?? true,
    defaultModel: preset.defaultModel
  }
}

/**
 * Normalize a model ID for case-insensitive matching.
 */
export function normalizeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

/** Default reasoning effort levels for thinking models that don't specify their own. */
export const DEFAULT_REASONING_EFFORT_LEVELS: ReasoningEffortLevel[] = ['medium', 'high', 'xhigh']
export const DEFAULT_REASONING_EFFORT: ReasoningEffortLevel = 'medium'

/**
 * Ensure a thinking model has reasoning effort levels configured.
 * If supportsThinking is true but reasoningEffortLevels is missing/empty,
 * fill in the default levels so the UI shows a usable effort selector
 * without requiring manual configuration.
 */
export function ensureDefaultReasoningEffort(model: AIModelConfig): AIModelConfig {
  if (!model.supportsThinking) return model
  if (model.thinkingConfig?.reasoningEffortLevels?.length) return model
  return {
    ...model,
    thinkingConfig: {
      ...(model.thinkingConfig ?? { bodyParams: {} }),
      reasoningEffortLevels: [...DEFAULT_REASONING_EFFORT_LEVELS],
      defaultReasoningEffort: model.thinkingConfig?.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT
    }
  }
}

/**
 * Global registry of all builtin models across all presets, keyed by normalized model ID.
 * This allows matching models from any provider (including custom/relay providers)
 * against builtin metadata (thinkingConfig, icon, pricing, etc.).
 * Thinking models without explicit reasoning effort levels get sensible defaults.
 */
export const builtinModelRegistry = new Map<string, AIModelConfig>()
for (const preset of builtinProviderPresets) {
  for (const model of preset.defaultModels) {
    const key = normalizeModelKey(model.id)
    if (!builtinModelRegistry.has(key)) {
      builtinModelRegistry.set(key, ensureDefaultReasoningEffort({ ...model }))
    }
  }
}

/**
 * Look up a model in the builtin registry by model ID.
 * Returns a partial AIModelConfig with metadata (thinkingConfig, icon, pricing, etc.)
 * or undefined if no match is found.
 */
export function resolveBuiltinModelFallback(modelId: string): AIModelConfig | undefined {
  return builtinModelRegistry.get(normalizeModelKey(modelId))
}

/**
 * Merge a raw discovered model with builtin metadata.
 * Builtin metadata (thinkingConfig, icon, supportsThinking, pricing, etc.) is used
 * as the base; discovered values override it. A provider that returns the model ID
 * as its name is treated as having no display name, so builtin friendly names win.
 */
export function enrichDiscoveredModel(raw: AIModelConfig): AIModelConfig {
  const fallback = resolveBuiltinModelFallback(raw.id)
  if (!fallback) return ensureDefaultReasoningEffort(raw)
  const hasUsefulDiscoveredName = Boolean(raw.name?.trim()) && raw.name.trim() !== raw.id
  const merged = {
    ...fallback,
    ...raw,
    ...(hasUsefulDiscoveredName ? { name: raw.name } : { name: fallback.name })
  }
  // If raw overrode thinkingConfig without reasoningEffortLevels, restore from fallback
  if (merged.supportsThinking && !merged.thinkingConfig?.reasoningEffortLevels?.length) {
    return ensureDefaultReasoningEffort(merged)
  }
  return merged
}

export function createCustomProvider(name: string, type: ProviderType, baseUrl: string): AIProvider {
  return {
    id: nanoid(),
    name,
    type,
    apiKey: '',
    baseUrl,
    enabled: true,
    models: [],
    createdAt: Date.now(),
    requiresApiKey: true
  }
}

/**
 * Ensure all builtin presets exist in the provider list.
 * Missing presets are added with defaultEnabled state.
 * Existing presets with outdated version are upgraded:
 *   - New models from the preset are added (preserving user-added models)
 *   - Preset model metadata (price, context, thinking config, etc.) is refreshed
 *   - Provider type/baseUrl are updated if the preset changed them
 *   - User customizations (apiKey, enabled, per-model enabled flags) are preserved
 * Called on store initialization (after hydration).
 */
export function ensureBuiltinPresets(): void {
  const currentProviders = useProviderStore.getState().providers
  let changed = false
  const nextProviders = [...currentProviders]

  for (const preset of builtinProviderPresets) {
    const existing = currentProviders.findIndex(p => p.builtinId === preset.builtinId)
    if (existing === -1) {
      // Missing preset — add it
      const provider = createProviderFromPreset(preset)
      nextProviders.push(provider)
      changed = true
      continue
    }

    const current = currentProviders[existing]
    if ((current.presetVersion ?? 0) >= preset.version) continue

    // Version upgrade — refresh model list while preserving user state
    const presetModelIds = new Set(preset.defaultModels.map(m => m.id))
    const userCustomModels = current.models.filter(m => !presetModelIds.has(m.id))

    // For preset models, preserve user's enabled flag; refresh all other metadata
    const refreshedModels = preset.defaultModels.map(presetModel => {
      const userModel = current.models.find(m => m.id === presetModel.id)
      if (userModel) {
        return { ...presetModel, enabled: userModel.enabled }
      }
      return { ...presetModel }
    })

    nextProviders[existing] = {
      ...current,
      type: preset.type,
      baseUrl: preset.defaultBaseUrl,
      models: [...refreshedModels, ...userCustomModels],
      presetVersion: preset.version
    }
    changed = true
  }

  const state = useProviderStore.getState()
  const updates: Partial<ProviderState> = {}
  if (changed) {
    updates.providers = nextProviders
  }
  // If no active provider is set, pick the first available one
  if (!state.activeProviderId && nextProviders.length > 0) {
    const firstProvider = nextProviders[0]
    updates.activeProviderId = firstProvider.id
    // Pick default model
    const defaultModel =
      firstProvider.models.find((m: AIModelConfig) => m.id === firstProvider.defaultModel) ??
      firstProvider.models.find((m: AIModelConfig) => m.enabled && (!m.category || m.category === 'chat')) ??
      firstProvider.models.find((m: AIModelConfig) => m.enabled) ??
      firstProvider.models[0]
    if (defaultModel) {
      updates.activeModelId = defaultModel.id
    }
  }
  // If activeProviderId is set but activeModelId is empty, resolve a default model
  if (state.activeProviderId && !state.activeModelId) {
    const provider = nextProviders.find((p) => p.id === state.activeProviderId)
    if (provider) {
      const defaultModel =
        provider.models.find((m: AIModelConfig) => m.id === provider.defaultModel) ??
        provider.models.find((m: AIModelConfig) => m.enabled && (!m.category || m.category === 'chat')) ??
        provider.models.find((m: AIModelConfig) => m.enabled) ??
        provider.models[0]
      if (defaultModel) {
        updates.activeModelId = defaultModel.id
      }
    }
  }
  if (Object.keys(updates).length > 0) {
    useProviderStore.setState(updates)
  }
}

