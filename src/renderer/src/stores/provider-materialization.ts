import type { AIProvider, BuiltinProviderPreset } from '../../../shared/types/provider'
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
 * They are what makes an account-based provider work at all: `authMode` + `oauthConfig`
 * decide whether the provider shows up in「授权 AI 服务商」and whether sign-in / token
 * refresh can run, while `userAgent` and `requestOverrides` carry the headers the
 * endpoint rejects requests without (WorkBuddy answers 10085). Records written before
 * R-9 kept them because they were persisted whole; projections only started dropping
 * them when R-9 replaced the whole record with this function's return value.
 *
 * 这份清单是**唯一来源**：投影与「已物化记录补缺」都读它，免得两处手抄字段名漂移。
 */
function protocolFieldsOf(preset: BuiltinProviderPreset): Partial<AIProvider> {
  return {
    ...(preset.authMode !== undefined ? { authMode: preset.authMode } : {}),
    ...(preset.oauthConfig ? { oauthConfig: clonePlain(preset.oauthConfig) } : {}),
    ...(preset.channelConfig ? { channelConfig: clonePlain(preset.channelConfig) } : {}),
    ...(preset.userAgent !== undefined ? { userAgent: preset.userAgent } : {}),
    ...(preset.useSystemProxy !== undefined ? { useSystemProxy: preset.useSystemProxy } : {}),
    ...(preset.requestOverrides ? { requestOverrides: clonePlain(preset.requestOverrides) } : {}),
    ...(preset.instructionsPrompt !== undefined ? { instructionsPrompt: preset.instructionsPrompt } : {}),
    ...(preset.ui ? { ui: clonePlain(preset.ui) } : {}),
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
 * Only ever adds what is `undefined` — a value the user owns, or an `accessToken` /
 * `oauthAccounts` already stored on the record, is never overwritten (those live on
 * `oauth`, not on `oauthConfig`; the latter only carries endpoints). This is what
 * repairs the records that were materialized from a projection and then written to
 * disk: WorkBuddy only appeared on 2026-10-25, so anyone who signed in before this fix
 * has a record with `authMode` / `oauthConfig` / `userAgent` / `useSystemProxy` missing.
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
 * (codex-oauth / copilot-oauth / lmstudio / ollama / moonshot-coding).
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
 * R-9.6: project a builtin back to its factory defaults.
 *
 * The id is deliberately preserved — sessions, plugins, cron tasks and OAuth bindings
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
export function reconcileProviders(persisted: AIProvider[]): ProviderReconciliation {
  const persistedByBuiltinId = new Map<string, AIProvider>()
  const customProviders: AIProvider[] = []
  // R-9.C.7: a user may legitimately own several records for one preset (official +
  // relay). Only the first maps to the preset slot; the rest are kept verbatim so
  // nothing the user created is silently collapsed away.
  const extraBuiltinRecords: AIProvider[] = []
  for (const p of persisted) {
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
    // pet-agent-store, channel-store, settings-store org/translation models, cron
    // agentId, OAuth bindings — and none of those can be remapped from here.
    // Re-keying would dangle all of them. Stable builtinId applies to records created
    // from R-9 on; legacy records keep the id they already have.
    // `homepage` 与 `tagline` 只读展示字段：内置 provider 在 UI 里不可编辑（是链接不是输入框），
    // 所以跟 preset 走、每次重投影都刷新，其余字段原样保留。
    // S-229：协议字段（authMode / oauthConfig / userAgent / requestOverrides / ui）只补缺失、
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
