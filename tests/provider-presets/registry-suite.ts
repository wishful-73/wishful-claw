// preset 注册表断言：唯一性、类型、homepage、默认模型、动态发现型号的厂商、排除项、deprecated id。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移，仅整体缩进 +2。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import { check, checkPreset, dynamicPresetIds, expectedNewPresetIds } from './checks'

export function runRegistrySuite(): void {
  const ids = builtinProviderPresets.map((preset) => preset.builtinId)
  const uniqueIds = new Set(ids)
  // expectedNewPresetIds 是 `as const` 数组，直接 new Set 会得到字面量联合的 Set，
  // 而 preset.builtinId 声明成 string —— 显式标 Set<string> 才能按 string 查。
  const expectedNewPresetSet = new Set<string>(expectedNewPresetIds)
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
}
