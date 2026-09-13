import type { AIProvider, BuiltinProviderPreset } from '../../../shared/types/provider'
import { builtinProviderPresets } from './providers'

/**
 * R-9 builtin provider materialization.
 *
 * Builtin providers are projected from their preset at runtime and marked `virtual`.
 * A virtual record is never persisted; the moment the user changes something the flag
 * is dropped and it becomes a real record. The default is "real", so records written
 * before R-9 need no migration and no user data is ever rewritten.
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
    defaultModel: preset.defaultModel,
    // R-9: synthesized at runtime, therefore never persisted. The flag is dropped
    // the moment the user changes anything (see `materializeRecord`).
    virtual: true
  }
}

/**
 * R-9: turn a virtual projection into a real record by dropping the flag.
 * Anything without the flag (including every record written before R-9) is real
 * and persisted, which is why no migration is needed.
 */
export function materializeRecord<T extends AIProvider>(provider: T): T {
  if (!provider.virtual) return provider
  const { virtual: _dropped, ...rest } = provider
  return rest as T
}

/**
 * R-9: true when a real builtin record carries no user intent and can safely go back
 * to being a virtual projection. Deliberately conservative — keeping one costs a few
 * KB of stale JSON, dropping one wrongly loses a user's configuration forever.
 * The `requiresApiKey === false` guard covers presets that never carry a key
 * (codex-oauth / copilot-oauth / lmstudio / ollama / moonshot-coding).
 */
export function isUnownedBuiltin(provider: AIProvider): boolean {
  if (!provider.builtinId || provider.virtual) return false
  const preset = builtinProviderPresets.find((p) => p.builtinId === provider.builtinId)
  if (!preset) return false
  if (provider.enabled) return false
  if (provider.apiKey) return false
  if (preset.requiresApiKey === false) return false
  if (provider.baseUrl && provider.baseUrl !== preset.defaultBaseUrl) return false
  return true
}

/** R-9: whether a record belongs in persisted storage. */
export function shouldPersist(provider: AIProvider): boolean {
  return !provider.virtual
}
