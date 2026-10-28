// provider-presets 套件的断言辅助与共享常量。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移。

import assert from 'node:assert/strict'
import type { BuiltinProviderPreset } from '../../src/shared/types/provider'

export const expectedNewPresetIds = [
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

export const allowedPresetTypes = new Set(['anthropic', 'openai-responses', 'openai-chat'])
export const dynamicPresetIds = new Set(['lmstudio', 'sensenova', 'agnes'])
export let checks = 0

export function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

export function checkPreset(preset: BuiltinProviderPreset, requireDefaultModel: boolean): void {
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
