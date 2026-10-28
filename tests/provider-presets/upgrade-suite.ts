// R-8：已持久化的记录只能通过版本升级路径拿到新 preset 字段；手动改过协议类型的记录保留用户类型。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移，仅整体缩进 +2。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import { upgradeProviderFromPreset } from '../../src/renderer/src/stores/provider-preset-upgrade'
import {
  createProviderFromPreset,
  isUnownedBuiltin
} from '../../src/renderer/src/stores/provider-materialization'
import type { AIProvider } from '../../src/shared/types/provider'
import { check } from './checks'

export function runUpgradeSuite(): void {
  // ── Regression (R-8): an already-persisted provider record only ever receives new preset
  //    fields (homepage / type) through the version-upgrade path. If this regresses, every
  //    existing user keeps the stale value even though the preset declares a new one.
  {
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'deepseek')!
    const retiredId = preset.deprecatedModelIds![0]
    const liveModelId = preset.defaultModels[0].id

    const staleRecord: AIProvider = {
      id: 'stale-provider',
      name: preset.name,
      type: 'openai-chat',
      apiKey: 'sk-test',
      baseUrl: 'https://stale.example.com/v1',
      enabled: true,
      builtinId: preset.builtinId,
      presetVersion: preset.version - 1,
      homepage: 'https://stale.example.com',
      createdAt: 0,
      models: [
        // user disabled a preset model and its price has drifted
        { ...preset.defaultModels[0], enabled: false, inputPrice: 999 },
        // a retired model still lingering in the persisted list
        { id: retiredId, name: 'Retired', enabled: true },
        // a genuinely user-added model
        { id: 'my-custom-model', name: 'My Custom', enabled: true }
      ]
    }

    const upgraded = upgradeProviderFromPreset(staleRecord, preset)

    check(upgraded.homepage === preset.homepage, 'version upgrade backfills homepage onto an existing record')
    check(upgraded.type === preset.type, 'version upgrade refreshes type onto an existing record')
    check(upgraded.presetVersion === preset.version, 'version upgrade records the new preset version')
    check(upgraded.apiKey === 'sk-test', 'version upgrade preserves apiKey')
    check(upgraded.baseUrl === 'https://stale.example.com/v1', 'version upgrade preserves user baseUrl')

    const refreshed = upgraded.models.find((m) => m.id === liveModelId)!
    check(refreshed.enabled === false, 'version upgrade preserves the user per-model enabled flag')
    check(refreshed.inputPrice === preset.defaultModels[0].inputPrice, 'version upgrade refreshes preset model metadata')
    check(
      !upgraded.models.some((m) => m.id === retiredId),
      'version upgrade drops models listed in deprecatedModelIds'
    )
    check(upgraded.models.some((m) => m.id === 'my-custom-model'), 'version upgrade preserves user-added models')
  }

  // ── A builtin whose protocol type was manually switched keeps the user's type ──
  //    across preset version upgrades, and such a record is never pruned back to virtual.
  {
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'deepseek')!
    const switched: AIProvider = {
      ...createProviderFromPreset(preset),
      apiKey: 'sk-test',
      enabled: true,
      type: 'openai-chat'
    }
    delete switched.virtual
    switched.typeOverridden = true

    const upgraded = upgradeProviderFromPreset({ ...switched }, preset)
    check(upgraded.type === 'openai-chat', 'preset upgrade keeps a user-switched protocol type')
    check(upgraded.homepage === preset.homepage, 'preset upgrade still refreshes homepage for a type-switched record')

    check(!isUnownedBuiltin({ ...switched, enabled: false, apiKey: '' }), 'a builtin with a manually switched type is never pruned')
    check(isUnownedBuiltin({ ...switched, enabled: false, apiKey: '', typeOverridden: undefined }), 'a builtin without a type switch can still be pruned')
  }
}
