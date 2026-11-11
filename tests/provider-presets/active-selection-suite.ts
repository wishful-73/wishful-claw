// S-359：active provider / active model 的可用判据 —— `enabled` 在两层都是硬门槛。
//
// 回归的是 v1.0.8（7fc9647a，S-318 A 段）引入的缺陷：
// 1. 服务商层：挑选用 `requiresApiKey === false || !!apiKey`，完全不看 `enabled`。
//    内置 projection 默认 false，ollama / lmstudio 又免 key ⇒ 空配置启动必中 ollama。
// 2. 模型层：`pickDefaultModel` 的第一档 `m.id === provider.defaultModel` 不看 enabled，
//    最后一档 `models[0]` 更是无条件 ⇒ 用户把 preset 默认模型关掉后，
//    每次启动都被拨回那个停用模型（实测：小米套餐选中 `mimo-v2.5-pro`，实际只启用了
//    `mimo-v2.6-flash`）。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import {
  createProviderFromPreset,
  isProviderUsable,
  pickActiveProvider,
  pickDefaultModel,
  resolveActiveProvider
} from '../../src/renderer/src/stores/provider-materialization'
import type { AIProvider } from '../../src/shared/types/provider'
import { check } from './checks'

export function runActiveSelectionSuite(): void {
  const ollamaPreset = builtinProviderPresets.find((p) => p.builtinId === 'ollama')!
  const deepseekPreset = builtinProviderPresets.find((p) => p.builtinId === 'deepseek')!

  // Projection defaults: every builtin starts disabled, so this is exactly what a
  // fresh install carries into the auto-selection step.
  const ollama: AIProvider = createProviderFromPreset(ollamaPreset)
  const deepseek: AIProvider = {
    ...createProviderFromPreset(deepseekPreset),
    enabled: true,
    apiKey: 'sk-test'
  }

  check(ollama.enabled === false, 'builtin projection starts disabled')
  check(ollama.requiresApiKey === false, 'ollama does not require an API key')

  // ── isProviderUsable: provider-level enabled is a hard gate ──
  check(!isProviderUsable(ollama), 'a disabled no-key provider is not usable')
  check(!isProviderUsable({ ...deepseek, enabled: false }), 'a disabled keyed provider is not usable')
  check(!isProviderUsable({ ...deepseek, apiKey: '   ' }), 'a keyed provider with a blank key is not usable')
  check(!isProviderUsable(null), 'no provider is not usable')
  check(!isProviderUsable(undefined), 'undefined is not usable')

  // ── isProviderUsable: model-level enabled is a hard gate too ──
  check(
    !isProviderUsable({ ...ollama, enabled: true }),
    'an enabled no-key provider with zero models is not usable'
  )
  const allModelsOff: AIProvider = {
    ...deepseek,
    models: deepseek.models.map((m) => ({ ...m, enabled: false }))
  }
  check(!isProviderUsable(allModelsOff), 'a provider whose every model is disabled is not usable')
  const oneModelOn: AIProvider = {
    ...deepseek,
    models: deepseek.models.map((m, i) => ({ ...m, enabled: i === 0 }))
  }
  check(isProviderUsable(oneModelOn), 'a provider with at least one enabled model is usable')

  // ── pickDefaultModel: only enabled models qualify ──
  const xiaomiLike: AIProvider = {
    ...deepseek,
    defaultModel: 'mimo-v2.5-pro',
    models: [
      { id: 'mimo-v2.5', name: 'mimo-v2.5', enabled: false },
      { id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro', enabled: false },
      { id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash', enabled: true },
      { id: 'mimo-v2.6-pro', name: 'mimo-v2.6-pro', enabled: false }
    ]
  }
  check(
    pickDefaultModel(xiaomiLike)?.id === 'mimo-v2.6-flash',
    'defaultModel pointing at a disabled model is skipped for an enabled one'
  )
  check(
    pickDefaultModel({ ...xiaomiLike, models: xiaomiLike.models.map((m) => ({ ...m, enabled: false })) }) ===
      undefined,
    'a provider with no enabled model has no default model'
  )

  // ── pickActiveProvider: a disabled provider must never win, even when listed first ──
  check(
    pickActiveProvider([ollama, deepseek])?.id === deepseek.id,
    'auto-selection skips a disabled no-key provider listed before a configured one'
  )
  check(pickActiveProvider([ollama]) === null, 'auto-selection returns null when nothing is enabled')

  // ── resolveActiveProvider: startup migration ──
  const pinned = resolveActiveProvider([ollama, deepseek], ollama.id)
  check(pinned.changed === true, 'a pinned disabled provider is replaced at startup')
  check(pinned.providerId === deepseek.id, 'replacement lands on the enabled provider')
  check(pinned.modelId === pickDefaultModel(deepseek)!.id, 'replacement carries the enabled default model')

  const kept = resolveActiveProvider([ollama, deepseek], deepseek.id)
  check(kept.changed === false, 'a usable active provider is left untouched')
  check(kept.providerId === deepseek.id, 'usable active keeps its id')

  const empty = resolveActiveProvider([ollama], ollama.id)
  check(empty.changed === true, 'a disabled-only list forces a re-resolution')
  check(empty.providerId === null, 'nothing enabled resolves to an empty selection')
  check(empty.modelId === '', 'empty selection clears the active model')
}
