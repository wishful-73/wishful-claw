import type { AIProvider, BuiltinProviderPreset } from '../../../shared/types/provider'

/**
 * Merge an outdated provider record with its builtin preset (pure function).
 *
 * This is the upgrade half of `ensureBuiltinPresets` — extracted so the merge rules can be
 * regression-tested without booting the renderer store. Rules:
 *   - Preset models are rebuilt from the preset, so price / context / thinking config refresh.
 *     The user's per-model `enabled` flag is preserved.
 *   - Models listed in `preset.deprecatedModelIds` are dropped. Without this filter they would
 *     be classified as user-added models and survive every future upgrade forever.
 *   - Other (user-added) models are preserved untouched.
 *   - `homepage` is refreshed from the preset — it only ever reaches an existing record
 *     through this path, which is why the preset version must be bumped whenever a preset
 *     gains a new field.
 *   - `type` is refreshed from the preset unless the user manually switched the protocol
 *     in the UI (`typeOverridden`); in that case the user's choice survives the upgrade.
 */
export function upgradeProviderFromPreset(
  current: AIProvider,
  preset: BuiltinProviderPreset
): AIProvider {
  const presetModelIds = new Set(preset.defaultModels.map((m) => m.id))
  const deprecatedModelIds = new Set(preset.deprecatedModelIds ?? [])

  const userCustomModels = current.models.filter(
    (m) => !presetModelIds.has(m.id) && !deprecatedModelIds.has(m.id)
  )

  const refreshedModels = preset.defaultModels.map((presetModel) => {
    const userModel = current.models.find((m) => m.id === presetModel.id)
    if (userModel) {
      return { ...presetModel, enabled: userModel.enabled }
    }
    return { ...presetModel }
  })

  return {
    ...current,
    type: current.typeOverridden ? current.type : preset.type,
    homepage: preset.homepage,
    models: [...refreshedModels, ...userCustomModels],
    presetVersion: preset.version
  }
}
