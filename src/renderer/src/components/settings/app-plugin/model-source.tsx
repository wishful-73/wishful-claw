import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ProviderIcon, ModelIcon } from '../provider-icons'
import type { AppPluginInstance } from '@renderer/lib/app-plugin/types'
import type { AIProvider, AIModelConfig } from '../../../../../shared/types/provider'
import { resolveDefaultImageModelId } from './meta'

export interface ImageProviderGroup {
  provider: AIProvider
  models: AIModelConfig[]
}

interface ModelSourceSectionProps {
  selectedPlugin: AppPluginInstance
  imageProviderGroups: ImageProviderGroup[]
  activeImageProviderId: string | null
  activeImageModelId: string | null
  updatePlugin: (id: AppPluginInstance['id'], patch: Partial<AppPluginInstance>) => void
}

export function ModelSourceSection({
  selectedPlugin,
  imageProviderGroups,
  activeImageProviderId,
  activeImageModelId,
  updatePlugin
}: ModelSourceSectionProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const overrideProvider = imageProviderGroups.find(
    (entry) => entry.provider.id === selectedPlugin?.providerId
  )
  const globalImageProvider = imageProviderGroups.find(
    (entry) => entry.provider.id === activeImageProviderId
  )

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{t('plugin.modelSource')}</p>
        <p className="text-xs text-muted-foreground">{t('plugin.modelSourceDesc')}</p>
      </div>
      <Select
        value={selectedPlugin.useGlobalModel ? 'global' : 'override'}
        onValueChange={(value) => {
          if (value === 'global') {
            updatePlugin(selectedPlugin.id, { useGlobalModel: true })
            return
          }

          const fallbackProviderId =
            selectedPlugin.providerId ??
            activeImageProviderId ??
            imageProviderGroups[0]?.provider.id ??
            null
          const fallbackModelId = fallbackProviderId
            ? (selectedPlugin.modelId ??
              (fallbackProviderId === activeImageProviderId ? activeImageModelId : null) ??
              resolveDefaultImageModelId(fallbackProviderId))
            : null

          updatePlugin(selectedPlugin.id, {
            useGlobalModel: false,
            providerId: fallbackProviderId,
            modelId: fallbackModelId
          })
        }}
      >
        <SelectTrigger className="w-80 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="global" className="text-xs">
            {t('plugin.useGlobalModel')}
          </SelectItem>
          <SelectItem value="override" className="text-xs">
            {t('plugin.overrideModel')}
          </SelectItem>
        </SelectContent>
      </Select>

      {selectedPlugin.useGlobalModel ? (
        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          {globalImageProvider && activeImageModelId ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground">
                <ProviderIcon builtinId={globalImageProvider.provider.builtinId} size={14} />
                <span>{globalImageProvider.provider.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <ModelIcon
                  icon={
                    globalImageProvider.models.find((model) => model.id === activeImageModelId)?.icon
                  }
                  modelId={activeImageModelId}
                  providerBuiltinId={globalImageProvider.provider.builtinId}
                  size={14}
                />
                <span>
                  {globalImageProvider.models.find((model) => model.id === activeImageModelId)
                    ?.name ?? activeImageModelId}
                </span>
              </div>
            </div>
          ) : (
            <span>{t('plugin.globalModelMissing')}</span>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">{t('plugin.provider')}</label>
            <Select
              value={selectedPlugin.providerId ?? ''}
              onValueChange={(value) => {
                updatePlugin(selectedPlugin.id, {
                  providerId: value,
                  modelId: resolveDefaultImageModelId(value)
                })
              }}
            >
              <SelectTrigger className="mt-1 w-80 text-xs">
                <SelectValue placeholder={t('plugin.selectProvider')} />
              </SelectTrigger>
              <SelectContent>
                {imageProviderGroups.map(({ provider }) => (
                  <SelectItem key={provider.id} value={provider.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      <ProviderIcon builtinId={provider.builtinId} size={14} />
                      {provider.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium">{t('plugin.model')}</label>
            <Select
              value={selectedPlugin.modelId ?? ''}
              onValueChange={(value) => updatePlugin(selectedPlugin.id, { modelId: value })}
            >
              <SelectTrigger className="mt-1 w-80 text-xs">
                <SelectValue placeholder={t('plugin.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {(overrideProvider?.models ?? []).map((model) => (
                  <SelectItem key={model.id} value={model.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      <ModelIcon
                        icon={model.icon}
                        modelId={model.id}
                        providerBuiltinId={overrideProvider?.provider.builtinId}
                        size={14}
                      />
                      {model.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </section>
  )
}
