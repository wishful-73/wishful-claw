/*
 * 发送轮次的模型解析 —— 唯一入口。
 *
 * 为什么单独成一个文件：这个函数原先长在 `hooks/use-chat-actions.ts` 里，而那个模块
 * 在顶层反向 import 了 `hooks/use-channel-auto-reply`（registerExternalChannelReply），
 * 于是「渠道自动回复」这条路径想复用统一解析就会形成模块环，只能自己再手写一遍兜底序。
 * S-167 的模型串台就是这么来的：投递轮跑全局模型，UI 显示的是会话绑定的模型，用户在
 * 项目会话下手切也切不回来（切回会话模型后，投递轮仍按全局模型 + 全局模型的思考档位
 * 发请求，个别上游直接报错）。
 *
 * 放到 lib 下之后，所有发送方（UI 发送 / cron / 外部投递 / 后台子 agent 唤醒 / 渠道
 * 自动回复）都能无环地走同一条解析。新增发送路径请复用这里，不要再自己拼兜底序。
 */

import { useProviderStore } from '@renderer/stores/provider-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'

// Shared provider type used by the send paths (buildProviderPayload's input).
export type SendProvider = NonNullable<
  ReturnType<ReturnType<typeof useProviderStore.getState>['getActiveProvider']>
>

// Resolve the provider/model a send will actually use, mirroring exactly what
// the UI displays (ModelSwitcher / InputArea via resolveSessionModelSelection).
// Session-bound model switches used to update only the UI while sends kept
// reading the global provider store, so requests went out with the stale
// global model. Returns null when no usable provider/model exists.
export function resolveSendModel(sessionId: string): { provider: SendProvider; modelId: string } | null {
  const providerStore = useProviderStore.getState()
  const chatStore = useChatStore.getState()
  const settings = useSettingsStore.getState()
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  const channel = session?.pluginId
    ? (useChannelStore.getState().channels.find((c) => c.id === session.pluginId) ?? null)
    : null
  const selection = resolveSessionModelSelection({
    session,
    providers: providerStore.providers,
    activeProviderId: providerStore.activeProviderId,
    activeModelId: providerStore.activeModelId,
    globalMode: settings.mainModelSelectionMode,
    channelProviderId: channel?.providerId,
    channelModelId: channel?.model
  })
  const resolvedProviderId = selection.providerId
  let resolvedModelId: string | null = selection.modelId
  let provider = resolvedProviderId
    ? (providerStore.providers.find((p) => p.id === resolvedProviderId) ?? null)
    : null
  if (!provider) {
    provider = providerStore.getActiveProvider() ?? null
    // Fell back to the global provider — realign the model with it too
    resolvedModelId = null
  }
  if (!provider) return null
  const modelId = resolvedModelId
    || providerStore.activeModelId
    || provider.defaultModel
    || provider.models.find((m: any) => m.enabled)?.id
  if (!modelId) return null
  return { provider, modelId }
}
