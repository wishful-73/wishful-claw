import { useTranslation } from 'react-i18next'
import type { AppPluginDescriptor, AppPluginId, AppPluginInstance } from '@renderer/lib/app-plugin/types'
import { createFallbackPlugin, getPluginIcon } from './meta'

interface PluginListProps {
  visibleDescriptors: AppPluginDescriptor[]
  projectPlugins: AppPluginInstance[]
  selectedPluginId: AppPluginId
  onSelect: (id: AppPluginId) => void
}

export function PluginList({
  visibleDescriptors,
  projectPlugins,
  selectedPluginId,
  onSelect
}: PluginListProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-2">
      {visibleDescriptors.map((descriptor) => {
        const plugin =
          projectPlugins.find((item) => item.id === descriptor.id) ??
          createFallbackPlugin(descriptor.id)
        const selected = descriptor.id === selectedPluginId
        return (
          <button
            key={descriptor.id}
            onClick={() => onSelect(descriptor.id)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
              selected
                ? 'border-primary/30 bg-primary/5'
                : 'border-transparent bg-background hover:border-border'
            }`}
          >
            <span className="mt-0.5 rounded-md border bg-background p-2 text-muted-foreground">
              {getPluginIcon(descriptor.id)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {t(`plugin.items.${descriptor.id}.title`)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    plugin?.enabled
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {plugin?.enabled ? t('plugin.enabled') : t('plugin.disabled')}
                </span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(`plugin.items.${descriptor.id}.description`)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
