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
 * Scope note: this keeps `type` as the *provider* type, exactly as the chat path
 * always has. The rest of the app treats a model-level `type` as the request type
 * (`model.type ?? provider.type` — AssistantMessage, ModelSettingsPopover,
 * memory-automation-utils, cron-runtime), which means chat and cron can disagree
 * for presets that override it (e.g. copilot-oauth declares `openai-chat` at the
 * provider but `openai-responses` on some models). Switching that here would
 * change which endpoint a request goes to, so it is deliberately left alone.
 *
 * `sessionId` is *not* set here: the chat store stamps it on the way out, since
 * it is the only door to `agent/run` and knows the session. `serviceTier` is also
 * absent — nothing in the renderer feeds it yet, and it is documented as effective
 * only under fast mode.
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
    type: provider.type,
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
