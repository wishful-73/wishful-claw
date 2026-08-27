import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AIProvider, AIModelConfig, ProviderType } from '../../../shared/types/provider'
import { aiProviderStorage } from '@renderer/lib/ipc/ai-provider-storage'
import { createProviderFromPreset, enrichDiscoveredModel, createCustomProvider, ensureBuiltinPresets, STORAGE_KEY, type ProviderState } from './provider-store-helpers'
import {
  toManagedModelConfig,
  cloneManagedModelConfig,
  sortManagedModels,
  collectBuiltinManagedModels,
  mergeManagedModelMissingFields,
  normalizeModelKey
} from './managed-models'

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProviderId: null,
      activeModelId: '',
      activeFastProviderId: null,
      activeFastModelId: '',
      defaultModel: null,

      // ── Managed models (global model library) ──
      managedModels: [],
      managedModelTombstones: [],

      getActiveProvider: () => {
        const { providers, activeProviderId } = get()
        if (!activeProviderId) return providers[0] ?? null
        return providers.find((p) => p.id === activeProviderId) ?? null
      },

      getProviderById: (id) => get().providers.find((p) => p.id === id) ?? null,

      addProviderFromPreset: (preset) => {
        const provider = createProviderFromPreset(preset)
        set((state) => ({
          providers: [...state.providers, provider],
          activeProviderId: state.activeProviderId ?? provider.id
        }))
        return provider
      },

      addCustomProvider: (name, type, baseUrl, apiKey) => {
        const provider = createCustomProvider(name, type, baseUrl, apiKey)
        set((state) => ({
          providers: [...state.providers, provider],
          activeProviderId: state.activeProviderId ?? provider.id
        }))
        return provider
      },

      updateProvider: (id, updates) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          )
        }))
      },

      deleteProvider: (id) => {
        set((state) => {
          const providers = state.providers.filter((p) => p.id !== id)
          let activeProviderId =
            state.activeProviderId === id
              ? (providers[0]?.id ?? null)
              : state.activeProviderId
          // Bug fix: when the deleted provider was active, fall back to an
          // auth-ready provider first so the composer doesn't show a stale
          // "no API key" banner while a fully configured provider exists.
          if (state.activeProviderId === id && providers.length > 0) {
            const authReady =
              providers.find((p) => p.requiresApiKey === false || !!p.apiKey) ?? null
            if (authReady) activeProviderId = authReady.id
          }
          // Keep activeModelId valid for the new active provider.
          let activeModelId = state.activeModelId
          const nextActive = providers.find((p) => p.id === activeProviderId)
          if (nextActive && !nextActive.models.some((m) => m.id === activeModelId)) {
            const fallbackModel =
              nextActive.models.find((m: AIModelConfig) => m.id === nextActive.defaultModel) ??
              nextActive.models.find((m: AIModelConfig) => m.enabled && (!m.category || m.category === 'chat')) ??
              nextActive.models.find((m: AIModelConfig) => m.enabled) ??
              nextActive.models[0]
            activeModelId = fallbackModel?.id ?? ''
          }
          return { providers, activeProviderId, activeModelId }
        })
      },

      setActiveProvider: (id) => set({ activeProviderId: id }),

      setActiveModel: (modelId) => set({ activeModelId: modelId }),

      setActiveFastProvider: (id) => set({ activeFastProviderId: id }),

      setActiveFastModel: (modelId) => set({ activeFastModelId: modelId }),

      getFastProviderConfig: () => {
        const { activeFastProviderId, activeFastModelId, providers } = get()
        if (!activeFastProviderId) return null
        const provider = providers.find((p) => p.id === activeFastProviderId)
        if (!provider) return null
        return { providerId: activeFastProviderId, model: activeFastModelId || provider.defaultModel || '' }
      },
      activeSpeechProviderId: null,
      activeSpeechModelId: '',
      getProviderConfigById: (id: string, _modelId?: string) => get().providers.find((p) => p.id === id) ?? null,
      getActiveModelConfig: () => {
        const { providers, activeProviderId, activeModelId } = get()
        const provider = providers.find((p) => p.id === activeProviderId)
        if (!provider) return null
        const model = provider.models?.find((m) => m.id === activeModelId)
        return model ?? null
      },
      getEffectiveMaxTokens: (userDefault?: number | null, _modelId?: string) => {
        return userDefault ?? 4096
      },
      getCompressionProviderConfig: () => {
        const { activeFastProviderId, activeFastModelId } = get()
        if (!activeFastProviderId) return null
        return { providerId: activeFastProviderId, model: activeFastModelId }
      },
      getTranslationProviderConfig: () => {
        const { activeTranslationProviderId, activeTranslationModelId } = get()
        if (!activeTranslationProviderId) return null
        return { providerId: activeTranslationProviderId, model: activeTranslationModelId }
      },
      activeImageProviderId: null,
      activeImageModelId: '',
      activeTranslationProviderId: null,
      activeTranslationModelId: '',
      getSpeechProviderConfig: () => {
        const { activeSpeechProviderId, activeSpeechModelId } = get()
        if (!activeSpeechProviderId) return null
        return { providerId: activeSpeechProviderId, model: activeSpeechModelId }
      },

      setDefaultModel: (modelId) => set({ defaultModel: modelId }),

      addModel: (providerId, model) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: [...p.models, model] }
              : p
          )
        }))
      },

      updateModel: (providerId, modelId, updates) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: p.models.map((m) =>
                    m.id === modelId ? { ...m, ...updates } : m
                  )
                }
              : p
          )
        }))
      },

      deleteModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
              : p
          )
        }))
      },

      setModels: (providerId, models) => {
        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== providerId) return p
            // Preserve user customizations for existing models (thinkingConfig, enabled, etc.)
            // while enriching newly discovered models with builtin metadata
            const existingById = new Map(p.models.map((m) => [m.id, m]))
            const merged = models.map((m) => {
              const existing = existingById.get(m.id)
              if (existing) {
                // Merge thinkingConfig: use the enriched/builtin config as the base
                // (so bodyParams/disabledBodyParams stay in sync with preset updates),
                // then fill in user-only fields (reasoningEffortLevels, defaultReasoningEffort)
                // that the enriched version may not carry.
                const mergedThinking = existing.thinkingConfig
                  ? { ...existing.thinkingConfig, ...m.thinkingConfig }
                  : m.thinkingConfig
                return { ...existing, ...m, thinkingConfig: mergedThinking }
              }
              // New model — enrich with builtin metadata
              return enrichDiscoveredModel(m)
            })
            return { ...p, models: merged }
          })
        }))
      },

      testConnection: async (provider, modelId) => {
        return window.api.workerRequest('provider/test', {
          type: provider.type,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          builtinId: provider.builtinId,
          modelId
        })
      },

      fetchModels: async (provider) => {
        const result = await window.api.workerRequest<{ ok: boolean; models?: AIModelConfig[]; error?: string }>(
          'provider/fetch-models',
          {
            type: provider.type,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            builtinId: provider.builtinId
          }
        )
        if (!result.ok) {
          throw new Error(result.error ?? 'Failed to fetch models')
        }
        // Enrich discovered models with builtin metadata (thinkingConfig, icon, pricing, etc.)
        return (result.models ?? []).map(enrichDiscoveredModel)
      },

      // ── Managed model methods ──
      addManagedModel: (model) =>
        set((state) => {
          const nextModel = toManagedModelConfig(model)
          const managedModels = sortManagedModels([
            ...state.managedModels.filter((item) => item.normalizedKey !== nextModel.normalizedKey),
            nextModel
          ])
          return {
            managedModels,
            managedModelTombstones: state.managedModelTombstones.filter(
              (item) => item !== nextModel.normalizedKey
            )
          }
        }),

      updateManagedModel: (modelId, model) =>
        set((state) => {
          const previousKey = normalizeModelKey(modelId)
          const nextModel = toManagedModelConfig(model)
          const managedModels = sortManagedModels([
            ...state.managedModels.filter(
              (item) =>
                item.normalizedKey !== previousKey && item.normalizedKey !== nextModel.normalizedKey
            ),
            nextModel
          ])
          const tombstones = new Set(state.managedModelTombstones)
          tombstones.delete(nextModel.normalizedKey)
          if (previousKey !== nextModel.normalizedKey) {
            tombstones.add(previousKey)
          }
          return {
            managedModels,
            managedModelTombstones: Array.from(tombstones)
          }
        }),

      removeManagedModel: (modelId) =>
        set((state) => {
          const modelKey = normalizeModelKey(modelId)
          const managedModels = state.managedModels.filter(
            (model) => model.normalizedKey !== modelKey
          )
          if (managedModels.length === state.managedModels.length) {
            return state
          }
          const tombstones = new Set(state.managedModelTombstones)
          tombstones.add(modelKey)
          return {
            managedModels,
            managedModelTombstones: Array.from(tombstones)
          }
        }),

      resetModelConfigurationToDefaults: () =>
        set(() => ({
          managedModels: sortManagedModels(collectBuiltinManagedModels()),
          managedModelTombstones: []
        })),

      getManagedModelById: (modelId) => {
        const modelKey = normalizeModelKey(modelId)
        return get().managedModels.find((model) => model.normalizedKey === modelKey) ?? null
      }
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => aiProviderStorage),
      partialize: (state) => ({
        providers: state.providers,
        managedModels: state.managedModels,
        managedModelTombstones: state.managedModelTombstones,
        activeProviderId: state.activeProviderId,
        activeModelId: state.activeModelId,
        activeFastProviderId: state.activeFastProviderId,
        activeFastModelId: state.activeFastModelId,
        defaultModel: state.defaultModel
      }),
      onRehydrateStorage: () => (state) => {
        // After hydration, ensure all builtin presets exist
        if (state) {
          ensureBuiltinPresets()
          syncManagedModelsWithBuiltins()
        }
      }
    }
  )
)

// ── Sync managed models with builtin presets ──

function syncManagedModelsWithBuiltins(): void {
  const state = useProviderStore.getState()
  const builtinModels = collectBuiltinManagedModels()
  if (builtinModels.length === 0) return

  const tombstones = new Set(state.managedModelTombstones)
  const managedModels = state.managedModels.map((model) => cloneManagedModelConfig(model))
  const managedIndexes = new Map(
    managedModels.map((model, index) => [model.normalizedKey, index] as const)
  )
  let changed = false

  for (const builtinModel of builtinModels) {
    if (tombstones.has(builtinModel.normalizedKey)) {
      continue
    }

    const existingIndex = managedIndexes.get(builtinModel.normalizedKey)
    if (existingIndex === undefined) {
      managedIndexes.set(builtinModel.normalizedKey, managedModels.length)
      managedModels.push(cloneManagedModelConfig(builtinModel))
      changed = true
      continue
    }

    const result = mergeManagedModelMissingFields(managedModels[existingIndex], builtinModel)
    if (result.changed) {
      managedModels[existingIndex] = result.model
      changed = true
    }
  }

  if (changed) {
    useProviderStore.setState({ managedModels: sortManagedModels(managedModels) })
  }
}

// ── Helper functions (from WishfulClaw, simplified) ──

export function modelSupportsVision(
  model: AIModelConfig | null | undefined,
  providerType?: ProviderType
): boolean {
  if (!model) return providerType === 'openai-images'
  const requestType = model.type ?? providerType
  return Boolean(
    model.supportsVision || model.category === 'image' || requestType === 'openai-images'
  )
}

export function isProviderAuthReady(provider: AIProvider | null | undefined): boolean {
  if (!provider) return false
  const authMode = provider.authMode ?? 'apiKey'
  if (authMode === 'apiKey') {
    return provider.requiresApiKey === false || provider.apiKey.trim().length > 0
  }
  return false
}

export function isProviderAvailableForModelSelection(
  provider: AIProvider | null | undefined
): boolean {
  if (!provider?.enabled) return false
  return isProviderAuthReady(provider)
}

export function modelSupportsBuiltinSearch(
  model: AIModelConfig | null | undefined,
  providerType?: ProviderType
): boolean {
  if (!model) return false
  const requestType = model.type ?? providerType
  return (
    (requestType === 'anthropic' || requestType === 'openai-responses') &&
    model.supportsBuiltinSearch === true
  )
}

export function modelSupportsResponsesWebsocket(
  model: AIModelConfig | null | undefined,
  providerType?: ProviderType
): boolean {
  if (!model) return false
  const requestType = model.type ?? providerType
  return requestType === 'openai-responses' && model.supportsWebsocket === true
}

export function modelSupportsResponsesImageGeneration(
  model: AIModelConfig | null | undefined,
  providerType?: ProviderType
): boolean {
  if (!model) return false
  const requestType = model.type ?? providerType
  return requestType === 'openai-responses' && model.supportsImageGeneration === true
}

/**
 * Initialize provider store — call once on app startup.
 * Ensures builtin presets exist even before hydration completes.
 */
export function initProviderStore(): void {
  // If store hasn't hydrated yet, ensure builtins after hydration
  if (!useProviderStore.persist.hasHydrated()) {
    useProviderStore.persist.onFinishHydration(() => {
      ensureBuiltinPresets()
    })
  } else {
    ensureBuiltinPresets()
  }
}
