/**
 * Channel / Plugin configuration panel.
 *
 * Layout (Reasonix-inspired):
 *   Top: horizontal channel tabs + detail panel (side by side)
 *   Bottom: global channel settings (reply, features, permissions)
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@renderer/components/ui/spinner'
import { useChannelStore } from '@renderer/stores/channel-store'
import { cn } from '@renderer/lib/utils'
import { ChannelDetailPanel } from './plugin-panel-detail'
import { ChannelGlobalSettingsPanel } from './plugin-panel-global'

function PluginPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { channels, providers, loading, loadChannels, loadProviders, selectedChannelId, setSelectedChannel, channelStatuses } = useChannelStore()
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!initialized) {
      void Promise.all([loadChannels(), loadProviders()]).then(() => setInitialized(true))
    }
  }, [initialized, loadChannels, loadProviders])

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Channel manager: tabs + detail ── */}
      <div className="flex min-h-0 flex-1 border-b">
        {/* Left: vertical channel tab list */}
        <div className="flex w-[200px] shrink-0 flex-col border-r">
          <div className="shrink-0 px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('channel.list.title', { defaultValue: '渠道' })}
            </h2>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {loading && !initialized ? (
              <div className="flex justify-center py-8">
                <Spinner className="size-5" />
              </div>
            ) : (
              channels.map((channel) => {
                const desc = providers.find((p) => p.type === channel.type)
                const isActive = (selectedChannelId ?? channels[0]?.id) === channel.id
                const status = channelStatuses[channel.id] ?? 'stopped'
                const isRunning = status === 'running'
                return (
                  <button
                    key={channel.id}
                    onClick={() => setSelectedChannel(channel.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                      isActive
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-[11px] font-semibold">
                      {desc?.displayName?.charAt(0) ?? channel.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        isRunning ? 'bg-green-500' : 'bg-muted-foreground/30'
                      )}
                    />
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="min-h-0 min-w-0 flex-1">
          {selectedChannel ? (
            <ChannelDetailPanel key={selectedChannel.id} channel={selectedChannel} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('channel.empty', { defaultValue: '选择左侧渠道进行配置' })}
            </div>
          )}
        </div>
      </div>

      {/* ── Global channel settings ── */}
      <div className="max-h-[45%] shrink-0">
        <ChannelGlobalSettingsPanel />
      </div>
    </div>
  )
}

export { PluginPanel }

export function ChannelPanel(_props: { projectId?: string }): React.JSX.Element | null {
  return null
}
