/*
 * The single builder for the `provider` element sent to `agent/run`.
 *
 * Why this file exists: the payload used to be written out as an inline object
 * literal at every send site (chat, channel auto-reply, project dispatch, the
 * quota-failover prompt), so every field the Worker reads had to be remembered
 * at each one — and it was not. Custom request headers (`requestOverrides`), the
 * per-provider `User-Agent`, `organization` / `project` and the session id behind
 * the `{{sessionId}}` header template only ever reached the sidecar path, so
 * configuring them in Settings changed nothing for a normal chat. Building the
 * payload in one place is what stops that from recurring.
 *
 * 状态说明：模型级 `type` 优先于服务商级 —— `AIModelConfig.type` 的注释就是
 * "Optional protocol override for this model; falls back to provider.type when
 * omitted"，全仓其它消费方也都这么读（AssistantMessage / ModelSettingsPopover /
 * MemorySettingsPanel / memory-automation-utils / cron-runtime）。只有聊天链路曾
 * 固定发服务商级类型，于是同一个模型在 chat 与 cron 走了两个协议。
 *
 * `sessionId` 是例外：它由 chat store 盖章（见下），不在这里构造。`serviceTier`
 * 也不在这里 —— 类型注释写着"Effective when fast mode is enabled"，而
 * `fastModeEnabled` 目前没有任何消费方，也就是 fast mode 这个功能整体还没接；
 * 顺手带上它会悄悄把请求切到 priority 计费档，所以留给独立议题。
 */

import type { AIModelConfig, AIProvider } from '../../../../shared/types/provider'
import { resolveProviderUserAgent } from '@renderer/lib/api/api-user-agent'
import { resolveReasoningEffortForModel } from '@renderer/stores/settings-store-types'
import type { useSettingsStore } from '@renderer/stores/settings-store'

/** Only the settings fields the payload actually reads. */
export type ProviderPayloadSettings = ReturnType<typeof useSettingsStore.getState>

export function buildProviderPayload(
  provider: AIProvider,
  modelId: string,
  settings: ProviderPayloadSettings,
  options?: {
    /**
     * Force the thinking flag instead of deriving it from settings. The project
     * dispatch path has always sent `false`; keep it that way until someone
     * decides otherwise.
     */
    thinkingEnabled?: boolean
  }
): Record<string, unknown> {
  const modelConfig: AIModelConfig | undefined = provider.models.find((model) => model.id === modelId)
  const thinkingConfig = modelConfig?.thinkingConfig
  const thinkingEnabled = options?.thinkingEnabled ?? (settings.thinkingEnabled && !!thinkingConfig)
  const reasoningEffort = thinkingConfig
    ? resolveReasoningEffortForModel({
        reasoningEffort: settings.reasoningEffort,
        reasoningEffortByModel: settings.reasoningEffortByModel,
        providerId: provider.id,
        modelId,
        thinkingConfig
      })
    : undefined

  return {
    id: provider.id,
    name: provider.name,
    // Model-level protocol override wins; a model that sets none follows its
    // provider. See the header note.
    type: modelConfig?.type ?? provider.type,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: provider.id,
    providerBuiltinId: provider.builtinId ?? undefined,
    model: modelId,
    contextLength: modelConfig?.contextLength ?? undefined,
    temperature: settings.temperature ?? undefined,
    maxTokens: settings.maxTokens ?? undefined,
    thinkingEnabled,
    thinkingConfig: thinkingConfig ?? undefined,
    reasoningEffort,
    requestTimeoutSeconds: settings.apiRequestTimeoutSeconds ?? undefined,
    requestMaxRetries: settings.requestMaxRetries ?? undefined,

    // ── Fields the Worker reads straight off `parameters.provider` that used to
    //    be dropped on this path. Keys are the ones read under
    //    src/runtime/WishfulClaw.Agent (grep `provider, "`).
    userAgent: resolveProviderUserAgent(provider.userAgent),
    requestOverrides: modelConfig?.requestOverrides ?? provider.requestOverrides,
    cacheTtl: modelConfig?.cacheTtl ?? provider.cacheTtl,
    responseSummary: modelConfig?.responseSummary
  }
}
