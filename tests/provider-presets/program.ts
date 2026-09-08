import assert from 'node:assert/strict'
import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import type { BuiltinProviderPreset } from '../../src/shared/types/provider'

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
  'together'
] as const

const allowedPresetTypes = new Set(['anthropic', 'openai-responses', 'openai-chat'])
const dynamicPresetIds = new Set(['lmstudio'])
let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function checkPreset(preset: BuiltinProviderPreset, requireDefaultModel: boolean): void {
  check(Number.isInteger(preset.version) && preset.version > 0, `${preset.builtinId} has a positive integer version`)
  check(allowedPresetTypes.has(preset.type), `${preset.builtinId} has a runtime-supported preset type`)
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

check(!uniqueIds.has('vertex-ai'), 'vertex-ai remains excluded')
check(!uniqueIds.has('routin-ai'), 'routin-ai remains excluded')

console.log(`Provider preset consistency checks passed (${checks} assertions, ${builtinProviderPresets.length} presets).`)
