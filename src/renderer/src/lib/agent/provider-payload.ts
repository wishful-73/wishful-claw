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
 * `sessionId` 是例外：它由 chat store 盖章（见下），不在这里构造。另注意（S-89）：
 * opencode-go 的 `x-opencode-session` 头**不读** `provider.sessionId`，也不是靠
 * `{{sessionId}}` 模板 —— 它由 C# provider 读 run request 的**顶层 `sessionId`**
 * （`OpenAIChatHeaders.cs` + `OpenAIChatProvider.cs`）。上面那句「the session id behind the
 * `{{sessionId}}` header template」只描述自定义 header 模板机制，别据此以为补
 * `provider.sessionId` 能修 opencode-go。`serviceTier`
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

  // contextLength 缺失不能静默：Worker 读不到 `provider.contextLength` 就兜底
  // DefaultContextCompressionLimit（200K），前端看着一切正常，只在「阈值远没用满就开始
  // 压缩」时才露馅（S-108）。两种情况分开报，一眼能看出是模型不在 provider 的列表里，
  // 还是模型档案压根没填 contextLength。走 console.warn 是因为 error-logger 会把它落盘。
  const contextLength = modelConfig?.contextLength
  if (contextLength === undefined) {
    const knownIds = provider.models.map((model) => model.id).join(', ')
    console.warn(
      '[provider-payload] contextLength 缺失，Worker 将兜底 200K 压缩窗口' +
        `（provider=${provider.id}, model=${modelId}）：` +
        (modelConfig === undefined
          ? `模型不在该 provider 的 models 列表里（已知：${knownIds || '空'}）`
          : '模型档案没有填 contextLength')
    )
  }

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
    contextLength,
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
