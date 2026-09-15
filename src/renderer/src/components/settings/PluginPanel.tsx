/**
 * Channel / Plugin configuration panel.
 *
 * Layout: **global settings first**, then one collapsible block per channel.
 *
 * The channel blocks collapse to a single summary row by default, and that is the point.
 * A channel is set up once; what brings you back to this page afterwards is the global
 * policy — reply persona, model, launch auto-connect, shell approval. The previous layout
 * spent the top of
 * the screen on a channel list plus a detail pane that had nothing new to say after the
 * first visit, and squeezed the global settings into the bottom 45%.
 *
 * The summary row therefore carries what used to require opening the detail pane: which
 * account the channel is bound to, and whether it is running.
 *
 * Accordion (one open at a time) keeps the page short — and channels are configured one
 * at a time anyway.
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@renderer/components/ui/spinner'
import { useChannelStore } from '@renderer/stores/channel-store'
import { ChannelCollapsible } from './plugin-panel-detail'
import { ChannelGlobalSettingsPanel } from './plugin-panel-global'

function PluginPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { channels, loadChannels, loadProviders, channelStatuses } = useChannelStore()
  const [initialized, setInitialized] = useState(false)
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null)

  useEffect(() => {
    if (!initialized) {
      void Promise.all([loadChannels(), loadProviders()]).then(() => setInitialized(true))
    }
  }, [initialized, loadChannels, loadProviders])

  const loading = !initialized

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Global settings first — the reason to come back here. */}
        <ChannelGlobalSettingsPanel />

        {/* Channels: configured once, then collapsed to a summary row. */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : channels.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
              {t('channel.list.empty')}
            </p>
          ) : (
            channels.map((channel) => (
              <ChannelCollapsible
                key={channel.id}
                channel={channel}
                status={channelStatuses[channel.id] ?? 'stopped'}
                expanded={expandedChannelId === channel.id}
                onToggle={() =>
                  setExpandedChannelId((current) => (current === channel.id ? null : channel.id))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export { PluginPanel }

export function ChannelPanel(_props: { projectId?: string }): React.JSX.Element | null {
  return null
}
