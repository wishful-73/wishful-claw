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
  if (provider.typeOverridden) return false
  if (preset.requiresApiKey === false) return false
  if (provider.baseUrl && provider.baseUrl !== preset.defaultBaseUrl) return false
  return true
}

/** R-9: whether a record belongs in persisted storage. */
export function shouldPersist(provider: AIProvider): boolean {
  return !provider.virtual
}

/**
 * R-9.6: project a builtin back to its factory defaults.
 *
 * The id is deliberately preserved — sessions, plugins, cron tasks and OAuth bindings
 * all reference provider ids, and a "reset to factory" is not an invitation to break
 * every one of them. Returns null when the provider is not a known builtin.
 */
export function resetProviderToPreset(provider: AIProvider): AIProvider | null {
  if (!provider.builtinId) return null
  const preset = builtinProviderPresets.find((p) => p.builtinId === provider.builtinId)
  if (!preset) return null
  return { ...createProviderFromPreset(preset), id: provider.id }
}

export interface ProviderReconciliation {
  /** Full in-memory list: virtual projections + real records + custom providers. */
  providers: AIProvider[]
}

/**
 * R-9: build the in-memory provider list from whatever was persisted.
 *
 * Pure on purpose — this *is* the upgrade path, so it can be regression-tested from
 * plain node without booting the store (see `tests/provider-presets`).
 *
 * - Builtin presets with a persisted record keep that record **completely untouched**,
 *   id included (R-9.2: 已物化的用户自己管理).
 * - Builtin presets without one become virtual projections, so preset data is current.
 * - Records written before R-9 have no `virtual` flag, therefore count as real and
 *   survive as-is — no migration, no user data rewritten.
 */
export function reconcileProviders(persisted: AIProvider[]): ProviderReconciliation {
  const persistedByBuiltinId = new Map<string, AIProvider>()
  const customProviders: AIProvider[] = []
  // R-9.C.7: a user may legitimately own several records for one preset (official +
  // relay). Only the first maps to the preset slot; the rest are kept verbatim so
  // nothing the user created is silently collapsed away.
  const extraBuiltinRecords: AIProvider[] = []
  for (const p of persisted) {
    if (!p.builtinId) {
      customProviders.push(p)
      continue
    }
    if (persistedByBuiltinId.has(p.builtinId)) {
      extraBuiltinRecords.push(p)
      continue
    }
    persistedByBuiltinId.set(p.builtinId, p)
  }

  const providers: AIProvider[] = []

  for (const preset of builtinProviderPresets) {
    const existing = persistedByBuiltinId.get(preset.builtinId)
    // R-9.C.8: NEVER re-key an existing record to `preset.builtinId`. Provider ids are
    // persisted outside this store — chat sessions in SQLite, app-plugin-store,
    // pet-agent-store, channel-store, settings-store org/translation models, cron
    // agentId, OAuth bindings — and none of those can be remapped from here.
    // Re-keying would dangle all of them. Stable builtinId applies to records created
    // from R-9 on; legacy records keep the id they already have.
    providers.push(existing ?? createProviderFromPreset(preset))
  }
  for (const p of extraBuiltinRecords) providers.push(p)
  for (const p of customProviders) providers.push(p)

  return { providers }
}
