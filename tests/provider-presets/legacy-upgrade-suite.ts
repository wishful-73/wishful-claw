// R-9：完整升级路径 —— 新装、pre-R-9 遗留配置、reconcile 与恢复出厂默认。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移，仅整体缩进 +2。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import {
  createProviderFromPreset,
  isUnownedBuiltin,
  shouldPersist,
  reconcileProviders,
  resetProviderToPreset
} from '../../src/renderer/src/stores/provider-materialization'
import type { AIProvider } from '../../src/shared/types/provider'
import { check, checks } from './checks'

export function runLegacyUpgradeSuite(): void {
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
    // R-9.C.9: 内置 provider 的 homepage 在 UI 里是只读链接（不是输入框），用户根本改不了，
    // 所以物化记录也必须跟 preset 走 —— 否则官方换地址后老用户永远看不到新地址。
    const preset = builtinProviderPresets[0]
    const stale: AIProvider = {
      ...createProviderFromPreset(preset),
      id: 'nanoid-stale-homepage',
      apiKey: 'sk-stale',
      homepage: 'https://old.example.com/legacy'
    }
    delete stale.virtual

    const { providers } = reconcileProviders([stale])
    const refreshed = providers.find((p) => p.id === 'nanoid-stale-homepage')!
    check(
      refreshed.homepage === preset.homepage,
      'R-9.C.9 a materialized builtin refreshes its read-only homepage from the preset'
    )
    check(
      refreshed.apiKey === 'sk-stale',
      'R-9.C.9 refreshing the homepage leaves the rest of the record intact'
    )
  }

  {
    // S-229: 投影必须带协议字段。少了它们，内置 OAuth 服务商在「授权 AI 服务商」页里
    // 根本不出现（isServerPollProvider 恒假），登录抛「没有 OAuth 配置」，请求头也缺
    // userAgent —— 一条链全断。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'workbuddy')!
    const projected = createProviderFromPreset(preset)
    check(projected.authMode === 'oauth', 'S-229 a projection carries authMode, so the auth panel can list it')
    check(projected.oauthConfig?.flowType === 'server_poll', 'S-229 a projection carries oauthConfig')
    check(projected.userAgent === preset.userAgent, 'S-229 a projection carries userAgent')
    check(
      projected.requestOverrides?.headers?.['X-IDE-Type'] === 'WorkBuddy',
      'S-229 a projection carries requestOverrides headers'
    )
    check(projected.tagline === '国内版', 'S-229 a projection carries the display tagline')
    check(
      projected.useSystemProxy === preset.useSystemProxy && preset.useSystemProxy === true,
      'S-229 a projection carries useSystemProxy (WorkBuddy signs in and checks in through the system proxy)'
    )
  }

  {
    // S-229: 与 preset 不共享可变对象 —— 投影里改一个 header 不能污染下一个投影。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'workbuddy')!
    const first = createProviderFromPreset(preset)
    check(first.requestOverrides !== preset.requestOverrides, 'S-229 a projection owns its requestOverrides')
    check(
      first.requestOverrides?.headers !== preset.requestOverrides?.headers,
      'S-229 a projection owns its header map'
    )
    check(first.oauthConfig !== preset.oauthConfig, 'S-229 a projection owns its oauthConfig')
    check(
      first.oauthConfig?.stateRequestHeaders !== preset.oauthConfig?.stateRequestHeaders,
      'S-229 a projection owns its nested oauth header map'
    )
    first.requestOverrides!.headers!['X-IDE-Type'] = 'Tampered'
    first.oauthConfig!.stateRequestHeaders!['X-No-Authorization'] = 'Tampered'
    const second = createProviderFromPreset(preset)
    check(
      second.requestOverrides?.headers?.['X-IDE-Type'] === 'WorkBuddy',
      'S-229 mutating one projection leaves the next one clean'
    )
    check(
      second.oauthConfig?.stateRequestHeaders?.['X-No-Authorization'] === 'true',
      'S-229 mutating one projection leaves the preset oauth headers clean'
    )
  }

  {
    // S-229: `requestOverrides.omitBodyKeys` 是数组，浅拷贝会共享引用。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'codex-oauth')!
    const first = createProviderFromPreset(preset)
    const keys = first.requestOverrides?.omitBodyKeys
    if (keys) {
      check(keys !== preset.requestOverrides?.omitBodyKeys, 'S-229 a projection owns its omitBodyKeys array')
      keys.push('tampered-key')
      const second = createProviderFromPreset(preset)
      check(
        !second.requestOverrides?.omitBodyKeys?.includes('tampered-key'),
        'S-229 mutating one omitBodyKeys array leaves the next projection clean'
      )
    }
  }

  {
    // S-229: 已物化记录缺协议字段（投影落盘的产物）要补齐，但已存的 token 必须留着。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'workbuddy')!
    const broken: AIProvider = {
      ...createProviderFromPreset(preset),
      id: 'nanoid-broken-workbuddy',
      oauth: { accessToken: 'tok-keep' }
    }
    delete broken.virtual
    delete broken.authMode
    delete broken.oauthConfig
    delete broken.userAgent
    delete broken.useSystemProxy
    delete broken.requestOverrides
    delete broken.ui

    const { providers } = reconcileProviders([broken])
    const repaired = providers.find((p) => p.id === 'nanoid-broken-workbuddy')!
    check(repaired.authMode === 'oauth', 'S-229 reconciliation restores a missing authMode')
    check(repaired.oauthConfig?.flowType === 'server_poll', 'S-229 reconciliation restores a missing oauthConfig')
    check(repaired.userAgent === preset.userAgent, 'S-229 reconciliation restores a missing userAgent')
    check(repaired.useSystemProxy === true, 'S-229 reconciliation restores a missing useSystemProxy')
    check(repaired.ui?.hideOAuthSettings === true, 'S-229 reconciliation restores a missing ui config')
    check(repaired.oauth?.accessToken === 'tok-keep', 'S-229 repairing protocol fields keeps the stored token')
  }

  {
    // S-229: 只补缺失、不覆盖 —— 用户自己改过的值原样留着。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'workbuddy')!
    const customized: AIProvider = {
      ...createProviderFromPreset(preset),
      id: 'nanoid-custom-ua',
      userAgent: 'Mine/1.0',
      // 用户显式清空成空串：不能被当成「缺字段」重置回 preset 的值
      instructionsPrompt: '',
      oauthConfig: { ...preset.oauthConfig, stateUrl: 'https://relay.example/state' },
      requestOverrides: { headers: { 'X-IDE-Type': 'Mine' } }
    }
    delete customized.virtual

    const { providers } = reconcileProviders([customized])
    const kept = providers.find((p) => p.id === 'nanoid-custom-ua')!
    check(kept.userAgent === 'Mine/1.0', 'S-229 reconciliation never overwrites a present protocol field')
    check(kept.instructionsPrompt === '', 'S-229 an explicitly emptied field stays empty')
    check(
      kept.oauthConfig?.stateUrl === 'https://relay.example/state',
      'S-229 reconciliation never overwrites a user-owned oauthConfig'
    )
    check(
      kept.requestOverrides?.headers?.['X-IDE-Type'] === 'Mine',
      'S-229 reconciliation never overwrites a user-owned requestOverrides'
    )
  }

  {
    // S-229: 同一预设的「第二条」记录（官方 + 中转）也要补协议字段，否则那条照样进不了授权页。
    const preset = builtinProviderPresets.find((p) => p.builtinId === 'workbuddy')!
    const first: AIProvider = {
      ...createProviderFromPreset(preset),
      id: 'nanoid-official',
      enabled: true
    }
    const relay: AIProvider = {
      ...createProviderFromPreset(preset),
      id: 'nanoid-relay',
      name: 'WorkBuddy (relay)',
      baseUrl: 'https://relay.example/v2',
      enabled: true
    }
    for (const record of [first, relay]) {
      delete record.virtual
      delete record.authMode
      delete record.oauthConfig
    }

    const { providers } = reconcileProviders([first, relay])
    const relayRepaired = providers.find((p) => p.id === 'nanoid-relay')!
    check(relayRepaired.authMode === 'oauth', 'S-229 a second record of the same preset also gets authMode back')
    check(
      relayRepaired.oauthConfig?.flowType === 'server_poll',
      'S-229 a second record of the same preset also gets oauthConfig back'
    )
    check(
      relayRepaired.baseUrl === 'https://relay.example/v2',
      'S-229 repairing a second record leaves its user-owned baseUrl alone'
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
}
