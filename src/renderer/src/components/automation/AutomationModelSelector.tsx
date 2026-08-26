import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  isProviderAvailableForModelSelection,
  useProviderStore
} from '@renderer/stores/provider-store'

interface AutomationModelSelectorProps {
  providerId: string
  modelId: string
  onChange: (providerId: string, modelId: string) => void
}

export function AutomationModelSelector({
  providerId,
  modelId,
  onChange
}: AutomationModelSelectorProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const activeModelId = useProviderStore((state) => state.activeModelId)
  const selectableProviders = useMemo(
    () => providers.filter((provider) =>
      isProviderAvailableForModelSelection(provider) && provider.models.some((model) => model.enabled)
    ),
    [providers]
  )
  const selectedProvider = selectableProviders.find((provider) => provider.id === providerId)

  useEffect(() => {
    if (providerId && modelId) return
    const provider = selectableProviders.find((candidate) => candidate.id === activeProviderId)
      ?? selectableProviders[0]
    if (!provider) return
    const nextModelId = provider.id === activeProviderId
      && provider.models.some((model) => model.enabled && model.id === activeModelId)
      ? activeModelId
      : provider.defaultModel && provider.models.some((model) => model.enabled && model.id === provider.defaultModel)
        ? provider.defaultModel
        : provider.models.find((model) => model.enabled)?.id ?? ''
    onChange(provider.id, nextModelId)
  }, [activeModelId, activeProviderId, modelId, onChange, providerId, selectableProviders])

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('automation.form.provider')}</span>
        <Select
          value={providerId}
          onValueChange={(nextProviderId) => {
            const provider = selectableProviders.find((candidate) => candidate.id === nextProviderId)
            const nextModelId = provider?.defaultModel
              && provider.models.some((model) => model.enabled && model.id === provider.defaultModel)
              ? provider.defaultModel
              : provider?.models.find((model) => model.enabled)?.id ?? ''
            onChange(nextProviderId, nextModelId)
          }}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t('automation.form.providerPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {selectableProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('automation.form.model')}</span>
        <Select
          value={modelId}
          onValueChange={(nextModelId) => onChange(providerId, nextModelId)}
          disabled={!selectedProvider}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t('automation.form.modelPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {selectedProvider?.models.filter((model) => model.enabled).map((model) => (
              <SelectItem key={model.id} value={model.id}>{model.name || model.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  )
}
