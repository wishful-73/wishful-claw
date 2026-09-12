import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '@renderer/stores/provider-store'
import { Button } from '@renderer/components/ui/button'
import { SettingsSection, SettingHint } from './settings-primitives'

interface ProviderCompletionSettings {
  fallbackProviderId: string | null
  fallbackModelId: string | null
  promptOptimizerProviderId: string | null
  promptOptimizerModelId: string | null
  personaProviderId: string | null
  personaModelId: string | null
}

type RouteName = 'fallback' | 'promptOptimizer' | 'persona'

const EMPTY: ProviderCompletionSettings = {
  fallbackProviderId: null,
  fallbackModelId: null,
  promptOptimizerProviderId: null,
  promptOptimizerModelId: null,
  personaProviderId: null,
  personaModelId: null
}

function ProviderCompletionSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((state) => state.providers)
  const [settings, setSettings] = useState<ProviderCompletionSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.workerRequest<ProviderCompletionSettings>('provider/completion-config-read', {}).then((value) => {
      if (!cancelled) {
        setSettings({ ...EMPTY, ...value })
        setLoading(false)
      }
    }).catch((error: unknown) => {
      if (cancelled) return
      // Every route reads as "未配置" while the store is unreadable, and saving in that
      // state would write those nulls back over the real configuration.
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const updateRoute = (route: RouteName, providerId: string): void => {
    const provider = providers.find((item) => item.id === providerId)
    const modelId = provider?.models.find((model) => model.enabled)?.id ?? provider?.models[0]?.id ?? null
    setSettings((current) => ({
      ...current,
      [`${route}ProviderId`]: providerId || null,
      [`${route}ModelId`]: providerId ? modelId : null
    }))
    setMessage(null)
  }

  const modelOptions = useMemo(() => (providerId: string | null) => {
    return providers.find((provider) => provider.id === providerId)?.models ?? []
  }, [providers])

  const save = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      const result = await window.api.workerRequest<{ success?: boolean; error?: string }>(
        'provider/completion-config-write',
        settings
      )
      if (result?.success === false) {
        throw new Error(result.error || t('runtimePage.auxiliaryModels.saveFailed'))
      }
      setLoadError(null)
      setMessage(t('runtimePage.auxiliaryModels.saved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('runtimePage.auxiliaryModels.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const route = (name: RouteName): React.JSX.Element => {
    const providerKey = `${name}ProviderId` as const
    const modelKey = `${name}ModelId` as const
    const providerId = settings[providerKey]
    const options = modelOptions(providerId)
    return (
      <div className="space-y-2 rounded-md border p-3" key={name}>
        <div>
          <div className="text-sm font-medium">{t(`runtimePage.auxiliaryModels.${name}.label`)}</div>
          <div className="text-xs text-muted-foreground">{t(`runtimePage.auxiliaryModels.${name}.desc`)}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-xs"
            value={providerId ?? ''}
            onChange={(event) => updateRoute(name, event.target.value)}
            disabled={loading}
          >
            <option value="">{t('runtimePage.auxiliaryModels.unconfigured')}</option>
            {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-2 text-xs"
            value={settings[modelKey] ?? ''}
            onChange={(event) => setSettings((current) => ({ ...current, [modelKey]: event.target.value || null }))}
            disabled={!providerId || loading}
          >
            <option value="">{t('runtimePage.auxiliaryModels.selectModel')}</option>
            {options.map((model) => <option value={model.id} key={model.id}>{model.name || model.id}</option>)}
          </select>
        </div>
      </div>
    )
  }

  return (
    <SettingsSection
      id="sec-runtime-auxiliary-models"
      title={t('runtimePage.auxiliaryModels.title')}
      description={t('runtimePage.auxiliaryModels.desc')}
      actions={<Button size="sm" onClick={() => void save()} disabled={saving || loading || Boolean(loadError)}>{saving ? t('runtimePage.auxiliaryModels.saving') : t('runtimePage.auxiliaryModels.save')}</Button>}
    >
      <div className="space-y-3">
        {route('promptOptimizer')}
        {route('persona')}
        {route('fallback')}
        <SettingHint>
          {message ??
            (loadError
              ? `${t('runtimePage.auxiliaryModels.loadFailed')}: ${loadError}`
              : t('runtimePage.auxiliaryModels.hint'))}
        </SettingHint>
      </div>
    </SettingsSection>
  )
}

export { ProviderCompletionSettingsPanel }
