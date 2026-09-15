/**
 * 全局渠道设置（渠道页底部区域，一次立案于迭代28 需求 R-2）。
 *
 * 原先「每个渠道各有一份功能设置」+「页面下方一个全局回复设置」的两处配置合并为这里的
 * 三个选项卡：回复设置 / 功能开关 / 安全权限，全局一份对所有渠道生效。
 * 功能与权限的值存在 Worker ConfigStore（key `channelSettings`），默认值也只有那一份——
 * 渲染端经由 channel-store 读写，本地不再兜任何默认。回复人格/模型仍走 settings store。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, MessageSquare, Settings2, ShieldCheck, User } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { Spinner } from '@renderer/components/ui/spinner'
import { useChannelStore, type GlobalChannelSettings } from '@renderer/stores/channel-store'
import { usePersonaStore } from '@renderer/stores/persona-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { cn } from '@renderer/lib/utils'

type GlobalTab = 'reply' | 'features' | 'permissions'

/** `readablePathPrefixes` 不是开关，不能进 Toggle 的按键集合。 */
type ToggleSettingKey = {
  [K in keyof GlobalChannelSettings]-?: GlobalChannelSettings[K] extends boolean ? K : never
}[keyof GlobalChannelSettings]

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function ReplySettingsTab(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { personas, listPersonas } = usePersonaStore()
  const providerStore = useProviderStore()
  const settings = useSettingsStore()
  const enabledProviders = providerStore.providers.filter((provider) => provider.enabled === true)
  const selectedProvider =
    enabledProviders.find((provider) => provider.id === providerStore.activeProviderId) ??
    enabledProviders[0] ??
    null
  const enabledChatModels =
    selectedProvider?.models.filter(
      (model) => model.enabled && (!model.category || model.category === 'chat')
    ) ?? []
  const selectedModel =
    enabledChatModels.find((model) => model.id === providerStore.activeModelId) ?? null

  useEffect(() => {
    if (selectedProvider && providerStore.activeProviderId !== selectedProvider.id) {
      providerStore.setActiveProvider(selectedProvider.id)
    }
    if (selectedModel && providerStore.activeModelId !== selectedModel.id) {
      providerStore.setActiveModel(selectedModel.id)
    } else if (!selectedModel && providerStore.activeModelId) {
      providerStore.setActiveModel('')
    }
  }, [providerStore, selectedModel, selectedProvider])

  useEffect(() => {
    void listPersonas()
  }, [listPersonas])

  return (
    <div className="space-y-4">
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
          onValueChange={(val) =>
            void settings.updateSettings({ defaultPersonaId: val === '__none__' ? '' : val })
          }
        >
          <SelectTrigger className="w-[200px] h-8 text-sm">
            <SelectValue
              placeholder={t('channel.global.noPersona', { defaultValue: '默认（无人格）' })}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t('channel.global.noPersona', { defaultValue: '默认（无人格）' })}
            </SelectItem>
            {personas.map((persona) => (
              <SelectItem key={persona.id} value={persona.id}>
                {persona.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

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
            value={selectedProvider?.id ?? '__none__'}
            onValueChange={(val) => {
              if (val === '__none__') return
              providerStore.setActiveProvider(val)
              const provider = enabledProviders.find((item) => item.id === val)
              const firstModel = provider?.models.find(
                (model) => model.enabled && (!model.category || model.category === 'chat')
              )
              providerStore.setActiveModel(firstModel?.id ?? '')
            }}
          >
            <SelectTrigger className="w-[140px] h-8 text-sm">
              <SelectValue
                placeholder={t('channel.global.provider', { defaultValue: 'Provider' })}
              />
            </SelectTrigger>
            <SelectContent>
              {enabledProviders.length > 0 ? (
                enabledProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__none__">
                  {t('channel.global.noProvider', { defaultValue: '无可用服务商' })}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select
            value={selectedModel?.id ?? '__none__'}
            onValueChange={(val) => {
              if (val !== '__none__') providerStore.setActiveModel(val)
            }}
          >
            <SelectTrigger className="w-[180px] h-8 text-sm">
              <SelectValue
                placeholder={t('channel.global.modelPlaceholder', { defaultValue: '选择模型' })}
              />
            </SelectTrigger>
            <SelectContent>
              {enabledChatModels.length > 0 ? (
                enabledChatModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name || model.id}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__none__">
                  {t('channel.global.noModel', { defaultValue: '无可用模型' })}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function FeatureSettingsTab({
  settings,
  patch
}: {
  settings: GlobalChannelSettings
  patch: (key: ToggleSettingKey, value: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-1">
      <ToggleRow
        label={t('channel.features.autoReply', { defaultValue: '自动回复' })}
        description={t('channel.features.autoReplyDesc', {
          defaultValue: '收到消息时自动使用 AI 回复'
        })}
        checked={settings.autoReply}
        onChange={(value) => patch('autoReply', value)}
      />
      <ToggleRow
        label={t('channel.features.streamingReply', { defaultValue: '流式回复' })}
        description={t('channel.features.streamingReplyDesc', {
          defaultValue: '实时流式输出回复内容（需要渠道支持）；当前仅记录设置，尚未接入强制执行'
        })}
        checked={settings.streamingReply}
        onChange={(value) => patch('streamingReply', value)}
      />
      <ToggleRow
        label={t('channel.features.autoStart', { defaultValue: '自动启动' })}
        description={t('channel.features.autoStartDesc', {
          defaultValue: '应用启动时自动连接已启用的渠道'
        })}
        checked={settings.autoStart}
        onChange={(value) => patch('autoStart', value)}
      />
    </div>
  )
}

function PermissionSettingsTab({
  settings,
  patch
}: {
  settings: GlobalChannelSettings
  patch: (key: ToggleSettingKey, value: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-1">
      <ToggleRow
        label={t('channel.permissions.shellRequiresApproval', {
          defaultValue: 'Shell 命令需授权'
        })}
        description={t('channel.permissions.shellRequiresApprovalDesc', {
          defaultValue: '开启后渠道对话每次执行 shell 命令前需你确认；关闭则直接执行'
        })}
        checked={settings.shellRequiresApproval}
        onChange={(value) => patch('shellRequiresApproval', value)}
      />
      <p className="pt-2 text-xs text-muted-foreground">
        {t('channel.permissions.notEnforcedHint', {
          defaultValue: '以下开关当前仅记录设置，尚未接入强制执行'
        })}
      </p>
      <ToggleRow
        label={t('channel.permissions.allowReadHome', { defaultValue: '读取主目录' })}
        description={t('channel.permissions.allowReadHomeDesc', {
          defaultValue: '允许读取工作目录之外的文件'
        })}
        checked={settings.allowReadHome}
        onChange={(value) => patch('allowReadHome', value)}
      />
      <ToggleRow
        label={t('channel.permissions.allowWriteOutside', { defaultValue: '外部写入' })}
        description={t('channel.permissions.allowWriteOutsideDesc', {
          defaultValue: '允许写入工作目录之外的文件'
        })}
        checked={settings.allowWriteOutside}
        onChange={(value) => patch('allowWriteOutside', value)}
      />
      <ToggleRow
        label={t('channel.permissions.allowSubAgents', { defaultValue: '子代理' })}
        description={t('channel.permissions.allowSubAgentsDesc', {
          defaultValue: '允许使用子代理工具'
        })}
        checked={settings.allowSubAgents}
        onChange={(value) => patch('allowSubAgents', value)}
      />
    </div>
  )
}

export function ChannelGlobalSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [activeTab, setActiveTab] = useState<GlobalTab>('reply')
  const { globalSettings, globalSettingsError, ensureGlobalSettings, loadGlobalSettings, updateGlobalSettings } =
    useChannelStore()

  useEffect(() => {
    void ensureGlobalSettings()
  }, [ensureGlobalSettings])

  const patch = (key: ToggleSettingKey, value: boolean): void => {
    void updateGlobalSettings({ [key]: value } as Partial<GlobalChannelSettings>)
  }

  const tabs: { id: GlobalTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'reply',
      label: t('channel.global.tabs.reply', { defaultValue: '回复设置' }),
      icon: <MessageSquare className="size-3.5" />
    },
    {
      id: 'features',
      label: t('channel.global.tabs.features', { defaultValue: '功能开关' }),
      icon: <Settings2 className="size-3.5" />
    },
    {
      id: 'permissions',
      label: t('channel.global.tabs.permissions', { defaultValue: '安全权限' }),
      icon: <ShieldCheck className="size-3.5" />
    }
  ]

  return (
    <div className="rounded-xl border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="shrink-0 text-sm font-semibold text-foreground">
          {t('channel.global.title', { defaultValue: '全局渠道设置' })}
        </h2>
        <div className="flex gap-1">
          {tabs.map((tab) => (
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
      </div>

      <div className="px-4 pb-4">
        <div className={cn(activeTab !== 'reply' && 'hidden')}>
          <ReplySettingsTab />
        </div>
        {globalSettings ? (
          <>
            <div className={cn(activeTab !== 'features' && 'hidden')}>
              <FeatureSettingsTab settings={globalSettings} patch={patch} />
            </div>
            <div className={cn(activeTab !== 'permissions' && 'hidden')}>
              <PermissionSettingsTab settings={globalSettings} patch={patch} />
            </div>
            {globalSettingsError && (
              <p className="mt-2 text-xs text-destructive">
                {t('channel.global.saveFailed', { defaultValue: '保存失败' })}：{globalSettingsError}
              </p>
            )}
          </>
        ) : (
          activeTab !== 'reply' &&
          (globalSettingsError ? (
            <div className="flex items-center gap-2 py-3 text-xs text-destructive">
              {t('channel.global.loadFailed', { defaultValue: '全局渠道设置读取失败' })}
              ：{globalSettingsError}
              <button
                onClick={() => void loadGlobalSettings()}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('channel.global.retry', { defaultValue: '重试' })}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('channel.global.loadingSettings', { defaultValue: '读取全局渠道设置…' })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
