import { useTranslation } from 'react-i18next'
import type { AppPluginDescriptor, AppPluginId, AppPluginInstance } from '@renderer/lib/app-plugin/types'
import { createFallbackPlugin, getPluginIcon, getPluginState } from './meta'

interface PluginListProps {
  visibleDescriptors: AppPluginDescriptor[]
  projectPlugins: AppPluginInstance[]
  selectedPluginId: AppPluginId
  onSelect: (id: AppPluginId) => void
  /** 资产就绪态 —— 列表徽章要能显示「待下载」，否则用户看不出还需要装东西。 */
  isCodeGraphReady: boolean | null
  isResolvedImageModelReady: boolean
}

export function PluginList({
  visibleDescriptors,
  projectPlugins,
  selectedPluginId,
  onSelect,
  isCodeGraphReady,
  isResolvedImageModelReady
}: PluginListProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-2">
      {visibleDescriptors.map((descriptor) => {
        const plugin =
          projectPlugins.find((item) => item.id === descriptor.id) ??
          createFallbackPlugin(descriptor.id)
        const selected = descriptor.id === selectedPluginId
        const state = getPluginState({
          descriptor,
          pluginEnabled: Boolean(plugin?.enabled),
          isResolvedImageModelReady,
          isCodeGraphReady
        })
        const badge =
          state === 'disabled'
            ? { label: t('plugin.disabled'), cls: 'bg-muted text-muted-foreground' }
            : state === 'checking'
              ? { label: t('plugin.checking'), cls: 'bg-muted text-muted-foreground' }
              : state === 'not_ready'
                ? { label: t('plugin.needsDownload'), cls: 'bg-amber-500/10 text-amber-600' }
                : { label: t('plugin.enabled'), cls: 'bg-emerald-500/10 text-emerald-600' }
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
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${badge.cls}`}>
                  {badge.label}
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
