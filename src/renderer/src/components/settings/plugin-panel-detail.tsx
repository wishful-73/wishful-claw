/**
 * Channel / Plugin configuration panel.
 *
 * Tabbed configuration for messaging channel providers:
 *   Tab 1: QR Code binding (scan to connect)
 *   Tab 2: API credentials (descriptor-driven form)
 *
 * Features and permissions used to live here per channel; they are global now
 * (see plugin-panel-global.tsx).
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QrCode, KeyRound, Play, Square, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { Badge } from '@renderer/components/ui/badge'
import {
  useChannelStore,
  type PluginInstance,
  type ChannelProviderDescriptor
} from '@renderer/stores/channel-store'
import { cn } from '@renderer/lib/utils'
import { channelAccountLabel } from './channel-account'
import { QrLoginPanel } from './plugin-panel-qr'
export function CredentialsPanel({
  channel,
  descriptor
}: {
  channel: PluginInstance
  descriptor: ChannelProviderDescriptor | undefined
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { updateChannel } = useChannelStore()
  const [localConfig, setLocalConfig] = useState(channel.config)
  const [saving, setSaving] = useState(false)

  // Sync local config when channel changes
  useEffect(() => {
    setLocalConfig(channel.config)
  }, [channel.id, channel.config])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await updateChannel(channel.id, { config: localConfig })
      toast.success(t('channel.credentials.saved', { defaultValue: '配置已保存' }))
    } catch {
      toast.error(t('channel.credentials.saveFailed', { defaultValue: '保存失败' }))
    } finally {
      setSaving(false)
    }
  }

  if (!descriptor) {
    return <div className="p-4 text-sm text-muted-foreground">Unknown provider type</div>
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t('channel.credentials.title', { defaultValue: 'API 凭据' })}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{descriptor.description}</p>
      </div>

      <Separator />

      <div className="space-y-3">
        {descriptor.configSchema.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={`field-${field.key}`} className="text-xs font-medium text-foreground">
              {field.label.startsWith('channel.') ? t(field.label, { defaultValue: field.key }) : field.label}
              {field.required && <span className="ml-1 text-red-500">*</span>}
            </label>
            <Input
              id={`field-${field.key}`}
              type={field.type === 'secret' ? 'password' : 'text'}
              value={localConfig[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => {
                setLocalConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
              }}
              className="h-8 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
          {t('channel.credentials.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </div>
  )
}

// ── Channel block (collapsible) ──

type ConfigTab = 'qr' | 'credentials'

/**
 * One channel as a collapsible block.
 *
 * The summary row is the point of the redesign: name, bound account and run state are what
 * you want at a glance. Everything that used to sit permanently on screen — description,
 * start/stop, the binding tabs — moved into the expanded body, so a channel configured
 * months ago costs a single line.
 */
export function ChannelCollapsible({
  channel,
  status,
  expanded,
  onToggle
}: {
  channel: PluginInstance
  status: 'running' | 'stopped' | 'error'
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { providers, startChannel, stopChannel } = useChannelStore()
  const [activeTab, setActiveTab] = useState<ConfigTab>('qr')

  const descriptor = providers.find((p) => p.type === channel.type)
  const supportsQr = channel.type === 'weixin-official' || channel.type === 'feishu-bot'

  const tabs: { id: ConfigTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    {
      id: 'qr',
      label: t('channel.tabs.qr', { defaultValue: '扫码绑定' }),
      icon: <QrCode className="size-3.5" />,
      show: supportsQr
    },
    {
      id: 'credentials',
      label: t('channel.tabs.credentials', { defaultValue: 'API 凭据' }),
      icon: <KeyRound className="size-3.5" />,
      show: true
    }
  ]

  const visibleTabs = tabs.filter((tab) => tab.show)

  // Auto-switch to first visible tab if current tab is hidden
  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0]?.id ?? 'credentials')
    }
  }, [visibleTabs, activeTab])

  const isRunning = status === 'running'

  // Check if channel has been configured with required credentials
  const isConfigured = (() => {
    const cfg = channel.config as Record<string, string>
    switch (channel.type) {
      case 'feishu-bot':
        return !!(cfg.appId && cfg.appSecret)
      case 'dingtalk-bot':
        return !!(cfg.appKey && cfg.appSecret)
      case 'wecom-bot':
        return !!(cfg.corpId && cfg.secret && cfg.agentId)
      case 'qq-bot':
        return !!(cfg.appId && cfg.clientSecret)
      case 'weixin-official':
        return !!cfg.token
      case 'telegram-bot':
        return !!cfg.botToken
      case 'discord-bot':
        return !!cfg.botToken
      case 'whatsapp-bot':
        return !!(cfg.phoneNumberId && cfg.accessToken)
      default:
        return false
    }
  })()
  const isUnconfigured = !isConfigured

  const statusLabel = isRunning
    ? t('channel.status.running', { defaultValue: '运行中' })
    : isUnconfigured
      ? t('channel.status.unconfigured', { defaultValue: '未配置' })
      : t('channel.status.stopped', { defaultValue: '已停止' })
  const accountLabel = channelAccountLabel(channel)

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {/* Summary row — the whole point: account and run state at a glance, no click. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-[11px] font-semibold">
          {descriptor?.displayName?.charAt(0) ?? channel.name.charAt(0)}
        </span>
        <span className="shrink-0 text-sm font-medium text-foreground">{channel.name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {accountLabel ?? t('channel.status.unconfigured', { defaultValue: '未配置' })}
        </span>
        <Badge
          variant={isRunning ? 'default' : isUnconfigured ? 'outline' : 'secondary'}
          className="h-5 shrink-0 text-[10px]"
        >
          {statusLabel}
        </Badge>
      </button>

      {expanded ? (
        <div className="border-t border-border/60">
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              {descriptor?.description ?? channel.type}
            </p>
            <Button
              variant={isRunning ? 'outline' : 'default'}
              size="sm"
              disabled={isUnconfigured}
              onClick={() => void (isRunning ? stopChannel(channel.id) : startChannel(channel.id))}
            >
              {isRunning ? (
                <>
                  <Square className="mr-1.5 size-3" />
                  {t('channel.actions.stop', { defaultValue: '停止' })}
                </>
              ) : (
                <>
                  <Play className="mr-1.5 size-3" />
                  {t('channel.actions.start', { defaultValue: '启动' })}
                </>
              )}
            </Button>
          </div>

          {visibleTabs.length > 0 ? (
            <div className="flex gap-1 px-4 pt-3">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === 'qr' && supportsQr && <QrLoginPanel channel={channel} />}
          {activeTab === 'credentials' && (
            <CredentialsPanel channel={channel} descriptor={descriptor} />
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Main PluginPanel ──

