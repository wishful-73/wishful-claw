// R-9：builtin 服务商是 preset 的运行时投影（materialize / shouldPersist / isUnownedBuiltin）。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移，仅整体缩进 +2。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import {
  createProviderFromPreset,
  materializeRecord,
  isUnownedBuiltin,
  shouldPersist
} from '../../src/renderer/src/stores/provider-materialization'
import type { AIProvider } from '../../src/shared/types/provider'
import { check } from './checks'

export function runProjectionSuite(): void {
  // ─── R-9: builtin providers are runtime projections of their preset ───

  {
    const builtinIds = builtinProviderPresets.map((p) => p.builtinId)
    check(builtinIds.every((id) => !!id), 'R-9 every preset declares a builtinId')
    check(new Set(builtinIds).size === builtinIds.length, 'R-9 builtinIds are unique')
  }

  {
    const preset = builtinProviderPresets[0]
    const projected = createProviderFromPreset(preset)
    check(projected.id === preset.builtinId, 'R-9 builtin provider id equals its builtinId (stable across devices)')
    check(projected.virtual === true, 'R-9 a preset projection is marked virtual')
    check(!shouldPersist(projected), 'R-9 a virtual projection is never persisted')
    check(!isUnownedBuiltin(projected), 'R-9 a virtual projection is never pruned')
  }

  {
    const preset = builtinProviderPresets.find((p) => p.requiresApiKey !== false)!
    const owned = materializeRecord(createProviderFromPreset(preset))
    check(!owned.virtual, 'R-9 writing to a builtin drops the virtual flag')
    check(shouldPersist(owned), 'R-9 a real record is persisted')
    check(isUnownedBuiltin(owned), 'R-9 a real builtin with no user intent can return to virtual')
    check(
      !isUnownedBuiltin(materializeRecord({ ...createProviderFromPreset(preset), apiKey: 'sk-test' })),
      'R-9 a builtin with an api key is never pruned'
    )
    check(
      !isUnownedBuiltin(materializeRecord({ ...createProviderFromPreset(preset), enabled: true })),
      'R-9 an enabled builtin is never pruned'
    )
    check(
      !isUnownedBuiltin(materializeRecord({ ...createProviderFromPreset(preset), baseUrl: 'https://relay.example/v1' })),
      'R-9 a builtin with a customized baseUrl is never pruned'
    )
  }

  {
    // Records written before R-9 carry no `virtual` flag at all, so they are real
    // records by default and keep being persisted — no migration, no data rewritten.
    const preset = builtinProviderPresets.find((p) => p.requiresApiKey !== false)!
    const legacy: AIProvider = { ...createProviderFromPreset(preset), apiKey: 'sk-legacy', enabled: true }
    delete legacy.virtual
    check(shouldPersist(legacy), 'R-9 a pre-R-9 record (no virtual flag) is persisted as-is')
    check(!isUnownedBuiltin(legacy), 'R-9 a configured pre-R-9 record is never pruned')

    const legacyIdle: AIProvider = { ...createProviderFromPreset(preset) }
    delete legacyIdle.virtual
    check(isUnownedBuiltin(legacyIdle), 'R-9 an untouched pre-R-9 record can be pruned back to virtual')
  }

  {
    // oauth and local presets never carry an apiKey, so "no key" says nothing about intent
    const keyless = builtinProviderPresets.find((p) => p.requiresApiKey === false)!
    check(!!keyless, 'R-9 at least one preset declares requiresApiKey:false')
    const owned = materializeRecord(createProviderFromPreset(keyless))
    check(!isUnownedBuiltin(owned), 'R-9 keyless presets are never pruned on the apiKey rule alone')
  }

  {
    const custom = {
      id: 'nanoid-xyz',
      name: 'My relay',
      type: 'openai',
      apiKey: '',
      baseUrl: 'https://relay.example/v1',
      enabled: false,
      models: [],
      createdAt: Date.now()
    } as unknown as AIProvider
    check(materializeRecord(custom) === custom, 'R-9 custom providers are returned untouched')
    check(shouldPersist(custom), 'R-9 custom providers are always persisted')
    check(!isUnownedBuiltin(custom), 'R-9 custom providers are never pruned')
  }
}
