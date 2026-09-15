/**
 * 全局渠道设置（渠道页顶部区域；迭代28 需求 R-2 立案，迭代29 需求 28 去掉选项卡）。
 *
 * 四个设置平铺，不再分页签：回复人格 / 回复模型 / 启动时自动连接 / Shell 命令需授权。
 * 曾经的三选项卡（回复设置 / 功能开关 / 安全权限）里只有这四项有真实消费方；被删掉的
 * `autoReply` / `streamingReply` 与四个 `allow*` 都只存了值、没有任何读取点，留着只会
 * 让人以为它们管着什么。
 *
 * 功能与权限的值存在 Worker ConfigStore（key `channelSettings`），默认值也只有那一份——
 * 渲染端经由 channel-store 读写，本地不再兜任何默认。回复人格/模型仍走 settings store。
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, User } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { Spinner } from '@renderer/components/ui/spinner'
import { useChannelStore, type GlobalChannelSettings } from '@renderer/stores/channel-store'
import { usePersonaStore } from '@renderer/stores/persona-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'

/** `GlobalChannelSettings` 现在只剩两个布尔；改字段时这里跟着改，编译器不会放过。 */
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

/**
 * 回复人格 + 回复模型。
 *
 * 这两项不走 Worker 的 `channelSettings`：人格存 settings store，模型存 provider store，
 * 与下方两个开关的读写通道不同，所以独立成块。
 */
function ReplyTargetRows(): React.JSX.Element {
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

export function ChannelGlobalSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { globalSettings, globalSettingsError, ensureGlobalSettings, loadGlobalSettings, updateGlobalSettings } =
    useChannelStore()

  useEffect(() => {
    void ensureGlobalSettings()
  }, [ensureGlobalSettings])

  const patch = (key: ToggleSettingKey, value: boolean): void => {
    void updateGlobalSettings({ [key]: value } as Partial<GlobalChannelSettings>)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 pb-4 pt-3">
      <h2 className="text-sm font-semibold text-foreground">
        {t('channel.global.title', { defaultValue: '全局渠道设置' })}
      </h2>

      <div className="pt-3">
        <ReplyTargetRows />
      </div>

      <Separator className="my-3" />

      {globalSettings ? (
        <div>
          <ToggleRow
            label={t('channel.global.autoStart', { defaultValue: '启动时自动连接' })}
            description={t('channel.global.autoStartDesc', {
              defaultValue: '应用启动时自动连接已启用的渠道'
            })}
            checked={globalSettings.autoStart}
            onChange={(value) => patch('autoStart', value)}
          />
          <ToggleRow
            label={t('channel.permissions.shellRequiresApproval', {
              defaultValue: 'Shell 命令需授权'
            })}
            description={t('channel.permissions.shellRequiresApprovalDesc', {
              defaultValue: '开启后渠道对话每次执行 shell 命令前需你确认；关闭则直接执行'
            })}
            checked={globalSettings.shellRequiresApproval}
            onChange={(value) => patch('shellRequiresApproval', value)}
          />
          {globalSettingsError && (
            <p className="mt-2 text-xs text-destructive">
              {t('channel.global.saveFailed', { defaultValue: '保存失败' })}：{globalSettingsError}
            </p>
          )}
        </div>
      ) : globalSettingsError ? (
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
      )}
    </div>
  )
}
