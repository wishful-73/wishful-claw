import assert from 'node:assert/strict'
import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import { upgradeProviderFromPreset } from '../../src/renderer/src/stores/provider-preset-upgrade'
import {
  createProviderFromPreset,
  materializeRecord,
  isUnownedBuiltin,
  shouldPersist,
  reconcileProviders,
  resetProviderToPreset
} from '../../src/renderer/src/stores/provider-materialization'
import type { AIProvider, BuiltinProviderPreset } from '../../src/shared/types/provider'

const expectedNewPresetIds = [
  'cerebras',
  'fireworks',
  'groq',
  'huggingface',
  'hunyuan',
  'infini',
  'lmstudio',
  'meta',
  'mistral',
  'modelscope',
  'novita',
  'nvidia',
  'opencode',
  'opencode-go',
  'ppio',
  'stepfun',
  'together',
  'sensenova',
  'agnes'
] as const

const allowedPresetTypes = new Set(['anthropic', 'openai-responses', 'openai-chat'])
const dynamicPresetIds = new Set(['lmstudio', 'sensenova', 'agnes'])
let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function checkPreset(preset: BuiltinProviderPreset, requireDefaultModel: boolean): void {
  check(Number.isInteger(preset.version) && preset.version > 0, `${preset.builtinId} has a positive integer version`)
  check(allowedPresetTypes.has(preset.type), `${preset.builtinId} has a runtime-supported preset type`)
  check(/^https:\/\//.test(preset.homepage), `${preset.builtinId} has an HTTPS homepage`)
  if (requireDefaultModel) {
    check(preset.defaultModels.length > 0, `${preset.builtinId} has at least one default model`)
    check(
      preset.defaultModel !== undefined &&
        preset.defaultModels.some((model) => model.id === preset.defaultModel && model.enabled),
      `${preset.builtinId} defaultModel exists and is enabled`
    )

    const modelIds = new Set<string>()
    for (const model of preset.defaultModels) {
      check(model.enabled === true, `${preset.builtinId}/${model.id} is enabled`)
      check(!modelIds.has(model.id), `${preset.builtinId} model ids are unique`)
      modelIds.add(model.id)
    }
  }
}

const ids = builtinProviderPresets.map((preset) => preset.builtinId)
const uniqueIds = new Set(ids)
const expectedNewPresetSet = new Set(expectedNewPresetIds)
check(uniqueIds.size === ids.length, 'all registered builtinIds are unique')
for (const preset of builtinProviderPresets) {
  checkPreset(preset, expectedNewPresetSet.has(preset.builtinId) && !dynamicPresetIds.has(preset.builtinId))
}

for (const builtinId of expectedNewPresetIds) {
  check(uniqueIds.has(builtinId), `${builtinId} is registered`)
}

const sensenova = builtinProviderPresets.find((preset) => preset.builtinId === 'sensenova')
check(sensenova?.defaultBaseUrl === 'https://token.sensenova.cn/v1', 'sensenova base URL is correct')
check(sensenova?.homepage === 'https://www.sensenova.cn/token-plan', 'sensenova homepage is correct')
check(sensenova?.defaultModels.length === 0, 'sensenova uses dynamic model discovery')

const agnes = builtinProviderPresets.find((preset) => preset.builtinId === 'agnes')
check(agnes?.defaultBaseUrl === 'https://apihub.agnes-ai.com/v1', 'agnes base URL is correct')
check(agnes?.homepage === 'https://www.agnes-ai.com/', 'agnes homepage is correct')
check(agnes?.defaultModels.length === 0, 'agnes uses dynamic model discovery')

check(!uniqueIds.has('vertex-ai'), 'vertex-ai remains excluded')
check(!uniqueIds.has('routin-ai'), 'routin-ai remains excluded')

// ── deprecatedModelIds must never also be a live default model ──
for (const preset of builtinProviderPresets) {
  if (!preset.deprecatedModelIds?.length) continue
  const live = new Set(preset.defaultModels.map((model) => model.id))
  for (const id of preset.deprecatedModelIds) {
    check(!live.has(id), `${preset.builtinId} deprecated id "${id}" is not also a default model`)
  }
}

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

// ─── R-9: the whole upgrade path, new install and pre-R-9 legacy config ───

{
  // New install: nothing persisted, so everything is a virtual projection.
  const fresh = reconcileProviders([])
  check(fresh.providers.length === builtinProviderPresets.length, 'R-9 new install yields one entry per preset')
  check(fresh.providers.every((p) => p.virtual === true), 'R-9 new install entries are all virtual')
  check(fresh.providers.every((p) => p.id === p.builtinId), 'R-9 new install ids equal builtinIds')
  check(fresh.providers.every((p) => !shouldPersist(p)), 'R-9 a brand new install persists nothing')
}

{
  // Pre-R-9 legacy config: every builtin was persisted with a random nanoid id.
  // Two of them carry real user configuration; the rest were never touched.
  const legacy: AIProvider[] = builtinProviderPresets.map((preset, i) => ({
    ...createProviderFromPreset(preset),
    id: `nanoid-legacy-${i}`
  }))
  for (const p of legacy) delete p.virtual

  const legacyDeepseekId = 'nanoid-deepseek-0001'
  const legacyOpenaiId = 'nanoid-openai-0002'

  const deepseek = legacy.find((p) => p.builtinId === 'deepseek')!
  deepseek.id = legacyDeepseekId
  deepseek.apiKey = 'sk-legacy-deepseek'
  deepseek.enabled = true
  deepseek.baseUrl = 'https://relay.example/deepseek'
  deepseek.models = [
    ...deepseek.models,
    { ...deepseek.models[0], id: 'my-private-model', name: 'My private model', enabled: true }
  ]

  const openai = legacy.find((p) => p.builtinId === 'openai')!
  openai.id = legacyOpenaiId
  openai.enabled = true

  const custom: AIProvider = {
    id: 'nanoid-custom-relay',
    name: 'My relay',
    type: 'openai',
    apiKey: 'sk-relay',
    baseUrl: 'https://relay.example/v1',
    enabled: true,
    models: [],
    createdAt: Date.now()
  }
  legacy.push(custom)

  const { providers } = reconcileProviders(legacy)

  const migrated = providers.find((p) => p.builtinId === 'deepseek')!
  check(!!migrated, 'R-9 the configured legacy provider survives the upgrade')
  // R-9.C.8: legacy ids are kept. Provider ids are persisted outside this store (chat
  // sessions in SQLite, plugin / pet / channel stores, cron agentId, OAuth bindings),
  // none of which can be remapped from here — re-keying would dangle all of them.
  check(migrated.id === legacyDeepseekId, 'R-9 a legacy record keeps its own id — external references stay valid')
  check(migrated.apiKey === 'sk-legacy-deepseek', 'R-9 legacy apiKey is preserved')
  check(migrated.enabled === true, 'R-9 legacy enabled flag is preserved')
  check(migrated.baseUrl === 'https://relay.example/deepseek', 'R-9 legacy custom baseUrl is preserved')
  check(migrated.models.some((m) => m.id === 'my-private-model'), 'R-9 user-added models are preserved')
  check(shouldPersist(migrated), 'R-9 a configured legacy record keeps being persisted')

  const migratedOpenai = providers.find((p) => p.builtinId === 'openai')!
  check(migratedOpenai.id === legacyOpenaiId, 'R-9 every legacy record keeps its own id')
  check(migratedOpenai.enabled === true, 'R-9 an enabled legacy provider stays enabled')

  check(providers.some((p) => p.id === 'nanoid-custom-relay'), 'R-9 custom providers survive the upgrade')
  check(providers.length === builtinProviderPresets.length + 1, 'R-9 no provider is lost during migration')
  check(!isUnownedBuiltin(migrated), 'R-9 a configured legacy record is never pruned')
}

{
  // R-9.C.7: a user may own several records for one preset (official + relay).
  // Collapsing them on a Map key would silently destroy one.
  const preset = builtinProviderPresets[0]
  const first: AIProvider = {
    ...createProviderFromPreset(preset),
    id: 'nanoid-first',
    apiKey: 'sk-first',
    enabled: true
  }
  const second: AIProvider = {
    ...createProviderFromPreset(preset),
    id: 'nanoid-second',
    name: `${preset.name} (relay)`,
    baseUrl: 'https://relay.example/v1',
    enabled: true
  }
  delete first.virtual
  delete second.virtual

  const { providers } = reconcileProviders([first, second])
  check(providers.some((p) => p.id === 'nanoid-first'), 'R-9 the first record of a preset keeps the preset slot')
  check(
    providers.some((p) => p.id === 'nanoid-second'),
    'R-9 an extra record of the same preset is kept, not collapsed away'
  )
  check(
    providers.length === builtinProviderPresets.length + 1,
    'R-9 duplicate builtinId records survive the upgrade'
  )
}

{
  // R-9.6 / R-9.C.8: "restore factory defaults" restores preset values but keeps the id,
  // so sessions / plugins / cron tasks pointing at the record keep resolving.
  const preset = builtinProviderPresets.find((p) => p.builtinId === 'deepseek')!
  const owned: AIProvider = {
    ...createProviderFromPreset(preset),
    id: 'nanoid-owned',
    apiKey: 'sk-owned',
    enabled: true,
    baseUrl: 'https://relay.example/v1'
  }
  delete owned.virtual

  const reset = resetProviderToPreset(owned)!
  check(!!reset, 'R-9 a known builtin can be reset to its preset')
  check(reset.id === 'nanoid-owned', 'R-9 reset keeps the id so external references keep resolving')
  check(reset.apiKey === '', 'R-9 reset clears the apiKey')
  check(reset.baseUrl === preset.defaultBaseUrl, 'R-9 reset restores the default baseUrl')
  check(reset.virtual === true, 'R-9 reset returns the record to virtual, so it stops being persisted')
  check(
    resetProviderToPreset({
      id: 'nanoid-custom',
      name: 'My relay',
      type: 'openai',
      apiKey: '',
      baseUrl: 'https://relay.example/v1',
      enabled: true,
      models: []
    }) === null,
    'R-9 a custom provider has no preset to reset to'
  )
}

console.log(`Provider preset consistency checks passed (${checks} assertions, ${builtinProviderPresets.length} presets).`)
