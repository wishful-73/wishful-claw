import type { AIProvider, BuiltinProviderPreset } from '../../../shared/types/provider'
import { builtinProviderPresets } from './providers'

/**
 * R-9 builtin provider materialization.
 *
 * Kept free of store imports on purpose so the rules can be regression-tested
 * from plain node (see `tests/provider-presets`).
 */

export function createProviderFromPreset(preset: BuiltinProviderPreset): AIProvider {
  return {
    // R-9: builtin providers carry their stable preset id, so references survive
    // across devices and reinstalls. Only custom providers get a random nanoid.
    id: preset.builtinId,
    name: preset.name,
    type: preset.type,
    apiKey: '',
    baseUrl: preset.defaultBaseUrl,
    homepage: preset.homepage,
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
 * R-9: mark a builtin provider as owned by the user, which is what makes it persist.
 * Unowned builtins are live projections of their preset and stay out of storage;
 * custom providers are always persisted, so they are returned unchanged.
 */
export function markMaterialized<T extends AIProvider>(provider: T): T {
  if (!provider.builtinId || provider.materialized) return provider
  return { ...provider, materialized: true }
}

/**
 * R-9.5: a builtin record carries no user intent and can safely be dropped back
 * to "unowned" (it will simply be re-projected from its preset).
 *
 * Deliberately conservative — the cost of keeping one is a few KB of stale JSON,
 * the cost of dropping one wrongly is losing a user's configuration forever.
 * The `baseUrl` check is the 5th criterion from the plan (listed as a "conservative
 * backstop" there); it is included because it is nearly free while losing a custom
 * baseUrl is not recoverable.
 */
export function isUnownedBuiltin(provider: AIProvider): boolean {
  if (!provider.builtinId || !provider.materialized) return false
  const preset = builtinProviderPresets.find((p) => p.builtinId === provider.builtinId)
  if (!preset) return false
  if (provider.enabled) return false
  if (provider.apiKey) return false
  // codex-oauth / copilot-oauth / lmstudio / ollama / moonshot-coding never carry
  // an apiKey by design, so "no key" says nothing about user intent for them.
  if (preset.requiresApiKey === false) return false
  if (provider.baseUrl && provider.baseUrl !== preset.defaultBaseUrl) return false
  return true
}
