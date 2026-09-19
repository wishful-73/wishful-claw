// 当前会话实际生效的模型。
//
// 上下文环（context-ring）的用量、压缩触发线、上限滑杆都要它 ——
// 抽出来一处解析，免得两边各写一遍 resolveSessionModelSelection 然后慢慢跑偏。

import { useChannelStore } from '@renderer/stores/channel-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import type { AIModelConfig } from '@renderer/lib/api/types'
import type { Session } from '@renderer/stores/chat-store/types'

export function useActiveModelConfig(
  activeSession: Session | null
): AIModelConfig | null {
  const mainModelSelectionMode = useSettingsStore((s) => s.mainModelSelectionMode)
  const channels = useChannelStore((s) => s.channels)

  return useProviderStore((s) => {
    const activeChannel = activeSession?.pluginId
      ? (channels.find((item) => item.id === activeSession.pluginId) ?? null)
      : null
    const selection = resolveSessionModelSelection({
      session: activeSession,
      providers: s.providers,
      activeProviderId: s.activeProviderId,
      activeModelId: s.activeModelId,
      globalMode: mainModelSelectionMode,
      channelProviderId: activeChannel?.providerId,
      channelModelId: activeChannel?.model
    })
    const { providerId, modelId } = selection
    if (!providerId || !modelId) return null
    const provider = s.providers.find((p) => p.id === providerId)
    return provider?.models.find((m) => m.id === modelId) ?? null
  }) as AIModelConfig | null
}
