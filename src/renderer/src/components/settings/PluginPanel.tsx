/**
 * Channel / Plugin configuration panel.
 *
 * Layout (Reasonix-inspired):
 *   Top: horizontal channel tabs + detail panel (side by side)
 *   Bottom: global channel settings (persona, provider/model, auto-reply)
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, User, Bot, MessageSquare } from 'lucide-react'
import { Spinner } from '@renderer/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { useChannelStore } from '@renderer/stores/channel-store'
import { usePersonaStore } from '@renderer/stores/persona-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'

import { cn } from '@renderer/lib/utils'
import { ChannelDetailPanel } from './plugin-panel-detail'

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
      <div className="shrink-0">
        <GlobalChannelSettings />
      </div>
    </div>
  )
}

// ── Global Channel Settings (bottom section) ──

function GlobalChannelSettings(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { personas, listPersonas } = usePersonaStore()
  const providerStore = useProviderStore()
  const settings = useSettingsStore()
  
  useEffect(() => {
    void listPersonas()
  }, [listPersonas])

  return (
    <div className="shrink-0 border-t">
      <details open>
        <summary className="flex cursor-pointer items-center justify-between px-6 py-2.5 select-none">
          <span className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('channel.global.title', { defaultValue: '全局渠道设置' })}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </summary>

        <div className="space-y-4 px-6 py-4">
          {/* Persona selection */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('channel.global.persona', { defaultValue: '回复人格' })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('channel.global.personaDesc', { defaultValue: '所有渠道自动回复使用的人格' })}
                </p>
              </div>
            </div>
            <Select
              value={settings.defaultPersonaId || '__none__'}
              onValueChange={(val) => void settings.updateSettings({ defaultPersonaId: val === '__none__' ? '' : val })}
            >
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder={t('channel.global.noPersona', { defaultValue: '默认（无人格）' })} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t('channel.global.noPersona', { defaultValue: '默认（无人格）' })}
                </SelectItem>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Provider & Model */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('channel.global.model', { defaultValue: '回复模型' })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('channel.global.modelDesc', { defaultValue: '所有渠道自动回复使用的 AI 模型' })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={providerStore.activeProviderId || '__none__'}
                onValueChange={(val) => {
                  if (val !== '__none__') void providerStore.setActiveProvider(val)
                }}
              >
                <SelectTrigger className="w-[140px] h-8 text-sm">
                  <SelectValue placeholder={t('channel.global.provider', { defaultValue: 'Provider' })} />
                </SelectTrigger>
                <SelectContent>
                  {providerStore.providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={providerStore.activeModelId || '__none__'}
                onValueChange={(val) => {
                  if (val !== '__none__') void providerStore.setActiveModel(val)
                }}
              >
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue placeholder={t('channel.global.modelPlaceholder', { defaultValue: '选择模型' })} />
                </SelectTrigger>
                <SelectContent>
                  {providerStore.getActiveProvider()?.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.id}
                    </SelectItem>
                  )) ?? []}
                </SelectContent>
              </Select>
            </div>
          </div>


        </div>
      </details>
    </div>
  )
}

export { PluginPanel }

export function ChannelPanel(_props: { projectId?: string }): React.JSX.Element | null {
  return null
}
