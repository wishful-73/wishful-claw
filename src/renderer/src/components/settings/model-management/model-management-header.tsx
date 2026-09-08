import { Layers, Plus, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ProviderIcon } from '../provider-icons'
import type { ManagedModelProviderSource } from './provider-source-index'
import { ALL_PROVIDER_FILTER } from './provider-source-index'

interface ModelManagementHeaderProps {
  totalModels: number
  enabledModelCount: number
  filteredModelCount: number
  providerFilterOptions: ManagedModelProviderSource[]
  configuredProviderSourceCount: number
  presetProviderSourceCount: number
  providerFilter: string
  modelSearch: string
  onProviderFilterChange: (filter: string) => void
  onModelSearchChange: (search: string) => void
  onRestoreDefaults: () => void
  onAddModel: () => void
}

export function ModelManagementHeader({
  totalModels,
  enabledModelCount,
  filteredModelCount,
  providerFilterOptions,
  configuredProviderSourceCount,
  presetProviderSourceCount,
  providerFilter,
  modelSearch,
  onProviderFilterChange,
  onModelSearchChange,
  onRestoreDefaults,
  onAddModel
}: ModelManagementHeaderProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="shrink-0 border-b bg-muted/10 px-5 py-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary shadow-xs">
              <Layers className="size-4" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{t('provider.modelManagement')}</h3>
              <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">
                {t('provider.modelManagementDesc')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-3 text-xs text-muted-foreground"
              onClick={onRestoreDefaults}
            >
              <RefreshCw className="size-3.5" />
              {t('provider.modelManagementRestoreDefaults')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-3 text-xs"
              onClick={onAddModel}
            >
              <Plus className="size-3.5" />
              {t('provider.addModel')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { label: t('provider.modelManagementStatTotal'), value: totalModels.toLocaleString() },
            { label: t('provider.modelManagementStatEnabled'), value: enabledModelCount.toLocaleString() },
            { label: t('provider.modelManagementStatProviders'), value: providerFilterOptions.length.toLocaleString() },
            { label: t('provider.modelManagementStatMatches'), value: filteredModelCount.toLocaleString() }
          ].map((item) => (
            <div key={item.label} className="rounded-xl border bg-background px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{item.label}</div>
              <div className="mt-1 text-lg font-semibold leading-none">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 text-xs text-muted-foreground">
            {t('provider.modelManagementCount', { total: totalModels, enabled: enabledModelCount })}
            <span className="mx-2 text-muted-foreground/40">/</span>
            {t('provider.modelManagementSourceSummary', {
              configured: configuredProviderSourceCount,
              preset: presetProviderSourceCount
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <Select value={providerFilter} onValueChange={onProviderFilterChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-52">
                <SelectValue placeholder={t('provider.allModelProviders')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROVIDER_FILTER} className="text-xs">
                  <span className="flex items-center gap-2">
                    <Layers className="size-3.5" />
                    {t('provider.allModelProviders')}
                  </span>
                </SelectItem>
                {providerFilterOptions.map((source) => (
                  <SelectItem key={source.key} value={source.key} className="text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon builtinId={source.builtinId} size={14} />
                      <span className="truncate">{source.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                placeholder={t('provider.searchManagedModels')}
                value={modelSearch}
                onChange={(event) => onModelSearchChange(event.target.value)}
                className="h-8 w-full bg-background pl-8 text-xs sm:w-64"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
