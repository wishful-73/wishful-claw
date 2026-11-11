import type { AIProvider, AIModelConfig, BuiltinProviderPreset } from '../../../shared/types/provider'
import { builtinProviderPresets } from './providers'

/**
 * S-229: deep-copy a plain-data subtree so a projected record never shares a mutable
 * object with the shared preset module. `structuredClone` is deliberately avoided —
 * presets are imported by plain-node tests and may carry non-cloneable values.
 */
function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = clonePlain(item)
    return out as T
  }
  return value
}

/**
 * S-229: protocol fields the projection used to drop.
 *
 * `userAgent` and `requestOverrides` carry the headers an endpoint rejects requests
 * without; `channelConfig` decides whether channel auth can run. Records written
 * before R-9 kept them because they were persisted whole; projections only started
 * dropping them when R-9 replaced the whole record with this function's return value.
 *
 * 这份清单是**唯一来源**：投影与「已物化记录补缺」都读它，免得两处手抄字段名漂移。
 */
function protocolFieldsOf(preset: BuiltinProviderPreset): Partial<AIProvider> {
  return {
    ...(preset.authMode !== undefined ? { authMode: preset.authMode } : {}),
    ...(preset.channelConfig ? { channelConfig: clonePlain(preset.channelConfig) } : {}),
    ...(preset.userAgent !== undefined ? { userAgent: preset.userAgent } : {}),
    ...(preset.useSystemProxy !== undefined ? { useSystemProxy: preset.useSystemProxy } : {}),
    ...(preset.requestOverrides ? { requestOverrides: clonePlain(preset.requestOverrides) } : {}),
    ...(preset.instructionsPrompt !== undefined ? { instructionsPrompt: preset.instructionsPrompt } : {}),
    ...(preset.websocketUrl !== undefined ? { websocketUrl: preset.websocketUrl } : {}),
    ...(preset.websocketMode !== undefined ? { websocketMode: preset.websocketMode } : {})
  }
}

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
    // S-229: 展示用副标题（国内版 / 国际版），与 homepage 同契约 —— 预设拥有、UI 只读
    ...(preset.tagline ? { tagline: preset.tagline } : {}),
    ...protocolFieldsOf(preset),
    // R-9: synthesized at runtime, therefore never persisted. The flag is dropped
    // the moment the user changes anything (see `materializeRecord`).
    virtual: true
  }
}

/**
 * S-229: fill protocol fields a persisted builtin record is missing.
 *
 * Only ever adds what is `undefined` — anything the user owns is never overwritten.
 * This is what repairs the records that were materialized from a projection and then
 * written to disk: they can be missing `userAgent` / `useSystemProxy` /
 * `requestOverrides` that the preset still carries.
 *
 * 字段清单来自 `protocolFieldsOf`，与投影共用同一份来源。
 */
export function fillMissingProtocolFields(
  provider: AIProvider,
  preset: BuiltinProviderPreset
): AIProvider {
  const filled = { ...provider } as Record<string, unknown>
  for (const [key, value] of Object.entries(protocolFieldsOf(preset))) {
    if (filled[key] === undefined) filled[key] = value
  }
  return filled as unknown as AIProvider
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
 * (lmstudio / ollama).
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
 * S-359: a provider is **usable** only when the user has enabled it, it can
 * authenticate, **and** at least one of its models is enabled.
 *
 * `enabled` is a hard gate at both levels, never a tie-breaker:
 * - provider level: every builtin projects with `enabled: false` (see
 *   `createProviderFromPreset`), and `ollama` / `lmstudio` carry
 *   `requiresApiKey: false`, so a fresh install auto-selected a disabled Ollama.
 * - model level: a provider whose models are all switched off cannot answer either.
 *   Picking it lands the user on "selected a provider, no usable model" — the same
 *   symptom one layer down.
 *
 * Kept identical to `isProviderAuthReady` + `enabled` + any enabled model: the
 * composer banner (`use-input-area-selectors`) already used that pair, and the two
 * must never drift apart again.
 */
export function isProviderUsable(provider: AIProvider | null | undefined): boolean {
  if (!provider || provider.enabled !== true) return false
  const authMode = provider.authMode ?? 'apiKey'
  if (authMode !== 'apiKey') return false
  if (!(provider.requiresApiKey === false || (provider.apiKey ?? '').trim().length > 0)) return false
  return provider.models.some((m) => m.enabled)
}

/**
 * Pick a sensible default model for a provider.
 *
 * S-359: only enabled models qualify. `defaultModel` is a preset hint, not a user
 * choice — a user who switches that model off must not keep getting it back on every
 * start. There is deliberately no `models[0]` fallback: when nothing is enabled the
 * caller gets `undefined` and the selection is left empty instead of pointing at a
 * model the user disabled.
 */
export function pickDefaultModel(provider: AIProvider): AIModelConfig | undefined {
  return (
    provider.models.find((m) => m.id === provider.defaultModel && m.enabled) ??
    provider.models.find((m) => m.enabled && (!m.category || m.category === 'chat')) ??
    provider.models.find((m) => m.enabled)
  )
}

/** First enabled + auth-ready provider with an enabled model, or null. */
export function pickActiveProvider(providers: AIProvider[]): AIProvider | null {
  return providers.find((p) => isProviderUsable(p)) ?? null
}

export interface ActiveResolution {
  providerId: string | null
  /** Only meaningful when `changed`: the default model of the newly picked provider. */
  modelId?: string
  /** True when the current selection had to be replaced (dangling, disabled or unusable). */
  changed: boolean
}

/**
 * S-359: resolve the active provider for startup.
 *
 * The current selection is kept only while it is still usable — a provider that is
 * missing (S-318 removed a preset), disabled by the user, or has no credentials must
 * be replaced. Replacing with "the first provider in the list" is what pinned users
 * to a disabled Ollama, so the fallback is `pickActiveProvider` and may come back
 * empty: an empty selection is correct when nothing is enabled — the composer banner
 * then tells the user to configure one.
 */
export function resolveActiveProvider(
  providers: AIProvider[],
  currentActiveId: string | null | undefined
): ActiveResolution {
  const current = currentActiveId
    ? providers.find((p) => p.id === currentActiveId)
    : undefined
  if (current && isProviderUsable(current)) {
    return { providerId: current.id, changed: false }
  }
  const picked = pickActiveProvider(providers)
  if (!picked) return { providerId: null, modelId: '', changed: true }
  return { providerId: picked.id, modelId: pickDefaultModel(picked)?.id ?? '', changed: true }
}

/**
 * R-9.6: project a builtin back to its factory defaults.
 *
 * The id is deliberately preserved — sessions, plugins, cron tasks and channel bindings
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
 * - Builtin presets with a persisted record keep that record untouched, id included
 *   (R-9.2: 已物化的用户自己管理) — **except `homepage`**, which for builtins is a
 *   read-only display field (the UI renders it as a link, never an input), so it is
 *   refreshed from the preset. `upgradeProviderFromPreset` is dead code, so without
 *   this line an official-site link change would never reach users who had already
 *   configured the provider.
 * - Builtin presets without one become virtual projections, so preset data is current.
 * - Records written before R-9 have no `virtual` flag, therefore count as real and
 *   survive as-is — no migration, no user data rewritten.
 */
/**
 * S-318：公开面移除的 preset（订阅额度 OAuth 冒充）。
 *
 * 光靠「preset 不存在就不会被投影」清不干净 —— 同一 preset 的第二、三条记录（官方 +
 * 中转，见 R-9.C.7）在主循环里拿不到 preset，会走 :224 那条 `preset ? ... : p` 分支
 * **原样进列表**，变成「名字还在、能选中、token 过期即死」的僵尸服务商。所以按
 * `builtinId` 显式剔除，连 extraBuiltinRecords 一起丢。
 *
 * 悬空引用的兜底在 `ensureBuiltinPresets`（拨正 activeProviderId）与
 * `getActiveProvider`（运行时回落）里，两者配合才能保证会话照常发得出去。
 *
 * 分刀：刀 1 收 A 段两家，刀 2 收 B 段三家，此后这份清单即全部已下线的内置服务商。
 */
const REMOVED_BUILTIN_IDS = new Set([
  'workbuddy',
  'workbuddy-ai',
  'codex-oauth',
  'copilot-oauth',
  'moonshot-coding'
])

export function reconcileProviders(persisted: AIProvider[]): ProviderReconciliation {
  const persistedByBuiltinId = new Map<string, AIProvider>()
  const customProviders: AIProvider[] = []
  // R-9.C.7: a user may legitimately own several records for one preset (official +
  // relay). Only the first maps to the preset slot; the rest are kept verbatim so
  // nothing the user created is silently collapsed away.
  const extraBuiltinRecords: AIProvider[] = []
  for (const p of persisted) {
    // S-318：已移除的 preset，任何一条记录都不进列表（见 REMOVED_BUILTIN_IDS 注释）。
    if (p.builtinId && REMOVED_BUILTIN_IDS.has(p.builtinId)) continue
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
    // channel-store, settings-store org models, cron
    // agentId, channel bindings — and none of those can be remapped from here.
    // Re-keying would dangle all of them. Stable builtinId applies to records created
    // from R-9 on; legacy records keep the id they already have.
    // `homepage` 与 `tagline` 只读展示字段：内置 provider 在 UI 里不可编辑（是链接不是输入框），
    // 所以跟 preset 走、每次重投影都刷新，其余字段原样保留。
    // S-229：协议字段（authMode / userAgent / requestOverrides 等）只补缺失、
    // 不覆盖 —— 已物化记录里可能有用户自己的 token 或改动。
    providers.push(
      existing
        ? {
            ...fillMissingProtocolFields(existing, preset),
            homepage: preset.homepage,
            // 无条件写：preset 撤掉 tagline 时老记录的旧副标题也要跟着消失（`undefined` 会被
            // JSON.stringify 丢弃），与 homepage 保持同一契约。
            tagline: preset.tagline
          }
        : createProviderFromPreset(preset)
    )
  }
  // S-229：同一预设的第二条记录（官方 + 中转）同样可能是老投影落盘的产物，协议字段一并补缺；
  // homepage / tagline 保持原样 —— 用户可能正是拿它当中转条目在展示。
  for (const p of extraBuiltinRecords) {
    const preset = p.builtinId
      ? builtinProviderPresets.find((item) => item.builtinId === p.builtinId)
      : undefined
    providers.push(preset ? fillMissingProtocolFields(p, preset) : p)
  }
  for (const p of customProviders) providers.push(p)

  return { providers }
}
