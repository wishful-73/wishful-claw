import { nanoid } from 'nanoid'
import type { AIProvider, AIModelConfig, BuiltinProviderPreset, ProviderType, ReasoningEffortLevel } from '../../../shared/types/provider'
import type { ManagedModelConfig } from './managed-models'
import { builtinProviderPresets } from '@renderer/stores/providers'
import { createProviderFromPreset, isUnownedBuiltin, reconcileProviders } from './provider-materialization'
import { useProviderStore } from '@renderer/stores/provider-store'

export const STORAGE_KEY = 'wishful-claw-providers'

export { builtinProviderPresets }
export { createProviderFromPreset, materializeRecord, isUnownedBuiltin } from './provider-materialization'
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
  addCustomProvider: (name: string, type: ProviderType, baseUrl: string, apiKey?: string) => AIProvider
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

/**
 * R-9.5: drop materialized builtin records that carry no user intent.
 * Called when the AI provider management page opens — explicitly NOT during
 * hydration, per the boss: "启动本身就有很多东西需要处理，专项专做".
 * Returns how many records were pruned.
 */
export function pruneUnownedBuiltinProviders(): number {
  const state = useProviderStore.getState()
  let pruned = 0
  // R-9.6: keep every builtin in the list. Pruning only drops the "user owns this"
  // flag so the record stops being written — it stays visible as a preset projection.
  const nextProviders = state.providers.map((p) => {
    if (!isUnownedBuiltin(p)) return p
    pruned++
    // Replace with a fresh projection: the entry stays visible in the list,
    // it just stops being written to storage.
    const preset = builtinProviderPresets.find((x) => x.builtinId === p.builtinId)
    return preset ? createProviderFromPreset(preset) : p
  })
  if (pruned > 0) {
    useProviderStore.setState({ providers: nextProviders })
  }
  return pruned
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

export function createCustomProvider(name: string, type: ProviderType, baseUrl: string, apiKey = ''): AIProvider {
  return {
    id: nanoid(),
    name,
    type,
    apiKey,
    baseUrl,
    enabled: true,
    models: [],
    createdAt: Date.now(),
    requiresApiKey: true
  }
}

/**
 * R-9: Ensure every builtin preset is represented in the in-memory provider list.
 *
 * Builtin providers are **live projections of their preset** — rebuilt from
 * `builtinProviderPresets` on every startup, so preset data is always current.
 * They are never persisted unless the user has taken ownership
 * (see `materialized`); custom providers are passed through untouched.
 *
 * Migration: builds before R-9 gave builtin providers a random `nanoid()` id.
 * Those are re-keyed to their stable `builtinId` here and every reference remapped.
 * The old `presetVersion` upgrade gate is gone — preset changes now apply
 * automatically because unowned builtins are re-projected on every start.
 *
 * Called on store initialization (after hydration).
 */
export function ensureBuiltinPresets(): void {
  const state = useProviderStore.getState()
  const currentProviders = state.providers

  // The whole reconciliation rule lives in provider-materialization.ts (pure), so the
  // upgrade path is regression-tested from plain node.
  const { providers: nextProviders, idRemap } = reconcileProviders(currentProviders)

  const updates: Partial<ProviderState> = { providers: nextProviders }

  if (idRemap.size > 0) {
    const remap = (id: string | null) => (id ? idRemap.get(id) ?? id : id)
    updates.activeProviderId = remap(state.activeProviderId)
    updates.activeFastProviderId = remap(state.activeFastProviderId)
    updates.activeSpeechProviderId = remap(state.activeSpeechProviderId)
    updates.activeImageProviderId = remap(state.activeImageProviderId)
    updates.activeTranslationProviderId = remap(state.activeTranslationProviderId)
  }

  // If no active provider is set, pick the first available one
  const activeId = updates.activeProviderId ?? state.activeProviderId
  if (!activeId && nextProviders.length > 0) {
    const firstProvider = nextProviders[0]
    updates.activeProviderId = firstProvider.id
    const defaultModel = pickDefaultModel(firstProvider)
    if (defaultModel) updates.activeModelId = defaultModel.id
  }
  // If activeProviderId is set but activeModelId is empty, resolve a default model
  if (activeId && !(updates.activeModelId ?? state.activeModelId)) {
    const provider = nextProviders.find((p) => p.id === activeId)
    const defaultModel = provider ? pickDefaultModel(provider) : undefined
    if (defaultModel) updates.activeModelId = defaultModel.id
  }

  useProviderStore.setState(updates)
}

/** Pick a sensible default model for a provider. */
function pickDefaultModel(provider: AIProvider): AIModelConfig | undefined {
  return (
    provider.models.find((m) => m.id === provider.defaultModel) ??
    provider.models.find((m) => m.enabled && (!m.category || m.category === 'chat')) ??
    provider.models.find((m) => m.enabled) ??
    provider.models[0]
  )
}

