import { useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Plus, Search, Server, Trash2 } from 'lucide-react'
import { ProviderIcon } from '@renderer/components/settings/provider-icons'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { useProviderStore } from '@renderer/stores/provider-store'
import { pruneUnownedBuiltinProviders } from '@renderer/stores/provider-store-helpers'
import type { AIProvider } from '../../../../shared/types/provider'
import { cn } from '@renderer/lib/utils'
import { AddProviderDialog } from './provider/AddProviderDialog'
import { ProviderConfigPanel } from './provider/ProviderConfigPanel'
import { ModelManagementPanel } from './model-management/ModelManagementPanel'
import { getProviderSourceKey, ALL_PROVIDER_FILTER } from './model-management/provider-source-index'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

type ProviderPanelTab = 'configuration' | 'models'

const PROVIDER_PANEL_TABS: ProviderPanelTab[] = ['configuration', 'models']

function ProviderPanelTabs({
  activeTab,
  onChange
}: {
  activeTab: ProviderPanelTab
  onChange: (tab: ProviderPanelTab) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const labels: Record<ProviderPanelTab, string> = {
    configuration: t('provider.tabs.configuration'),
    models: t('provider.tabs.models')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const nextIndex = event.key === 'ArrowRight'
      ? (index + 1) % PROVIDER_PANEL_TABS.length
      : (index - 1 + PROVIDER_PANEL_TABS.length) % PROVIDER_PANEL_TABS.length
    const nextTab = PROVIDER_PANEL_TABS[nextIndex]
    onChange(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={t('provider.tabs.label')}
      className="flex shrink-0 items-center gap-1 rounded-lg border bg-muted/50 p-1"
    >
      {PROVIDER_PANEL_TABS.map((tab, index) => (
        <button
          key={tab}
          ref={(element) => { tabRefs.current[index] = element }}
          type="button"
          role="tab"
          id={`provider-panel-tab-${tab}`}
          aria-controls={`provider-panel-tabpanel-${tab}`}
          aria-selected={activeTab === tab}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            activeTab === tab
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
          )}
        >
          {tab === 'configuration' ? <Server className="size-3.5" /> : <Layers className="size-3.5" />}
          {labels[tab]}
        </button>
      ))}
    </div>
  )
}

function ProviderPanel(): React.JSX.Element {
  // R-9.5: drop builtin records that carry no user intent. Deliberately done here
  // and not during hydration — startup already has enough to do.
  useEffect(() => {
    pruneUnownedBuiltinProviders()
  }, [])

  const { t } = useTranslation(['settings', 'common'])
  const { t: tc } = useTranslation('common')
  const providers = useProviderStore((s) => s.providers)
  const deleteProvider = useProviderStore((s) => s.deleteProvider)

  const activeProviderId = useProviderStore((s) => s.activeProviderId)
  // userSelectedId tracks manual user clicks; default selection derives from store state
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProviderPanelTab>('configuration')
  const [modelProviderFilter, setModelProviderFilter] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AIProvider | null>(null)

  const selectedId = userSelectedId ?? activeProviderId ?? providers.find((p: any) => p.enabled)?.id ?? providers[0]?.id ?? null
  const resolvedSelectedId =
    selectedId && providers.some((p: any) => p.id === selectedId)
      ? selectedId
      : (activeProviderId ?? providers.find((p: any) => p.enabled)?.id ?? providers[0]?.id ?? null)

  const selectedProvider = resolvedSelectedId
    ? (providers.find((p: any) => p.id === resolvedSelectedId) ?? null)
    : null

  const selectProvider = (providerId: string): void => {
    setUserSelectedId(providerId)
    if (modelProviderFilter !== ALL_PROVIDER_FILTER) {
      const provider = providers.find((item) => item.id === providerId)
      setModelProviderFilter(provider ? getProviderSourceKey(provider) : null)
    }
  }

  const resolvedModelProviderFilter =
    modelProviderFilter ?? (selectedProvider ? getProviderSourceKey(selectedProvider) : ALL_PROVIDER_FILTER)

  const enabledProviders = useMemo(
    () =>
      providers.filter(
        (p: any) => p.enabled && (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [providers, searchQuery]
  )

  const disabledProviders = useMemo(
    () =>
      providers.filter(
        (p: any) => !p.enabled && (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [providers, searchQuery]
  )

  const renderProviderListItem = (provider: AIProvider, muted: boolean): React.JSX.Element => {
    const enabledModelCount = provider.models.filter((m) => m.enabled).length
    const authReady = provider.requiresApiKey === false || Boolean(provider.apiKey)

    return (
      <ContextMenu key={provider.id}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => selectProvider(provider.id)}
            className={cn(
              'group/provider relative mt-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
              resolvedSelectedId === provider.id
                ? 'bg-primary/10 text-foreground ring-1 ring-primary/15'
                : muted
                  ? 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  : 'text-foreground/85 hover:bg-muted/60'
            )}
          >
            <span
              className={cn(
                'absolute bottom-2 left-0 top-2 w-0.5 rounded-full',
                resolvedSelectedId === provider.id ? 'bg-primary' : 'bg-transparent'
              )}
            />
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
              <ProviderIcon builtinId={provider.builtinId} size={16} className={cn(muted && 'opacity-50')} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{provider.name}</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">
                {enabledModelCount}/{provider.models.length} {t('provider.list.models')}
              </span>
            </span>
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                provider.enabled && authReady
                  ? 'bg-emerald-500'
                  : provider.enabled
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/30'
              )}
            />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem
            className="gap-2 text-xs text-destructive focus:text-destructive"
            disabled={Boolean(provider.builtinId)}
            onSelect={() => {
              setDeleteTarget(provider)
            }}
          >
            <Trash2 className="size-3.5" />
            {t('provider.list.deleteProvider')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background/60 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{t('provider.title')}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {activeTab === 'configuration' ? t('provider.subtitle') : t('provider.modelManagementDesc')}
          </p>
        </div>
        <ProviderPanelTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>
      {activeTab === 'configuration' ? (
      <div
        id="provider-panel-tabpanel-configuration"
        role="tabpanel"
        aria-labelledby="provider-panel-tab-configuration"
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        {/* Left: Provider list */}
        <div className="flex w-60 shrink-0 flex-col border-r bg-muted/10">
          <div className="flex items-center gap-1.5 border-b p-2.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <Input
                placeholder={t('provider.list.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 bg-background pl-7 text-xs shadow-none"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 rounded-lg p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDialogOpen(true)}
              title={t('provider.list.addTooltip')}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            <div className="pb-20">
              {enabledProviders.length > 0 && (
                <div className="px-2 pb-1 pt-1">
                  <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55">
                    {t('provider.list.enabled')}
                  </p>
                  {enabledProviders.map((p: any) => renderProviderListItem(p, false))}
                </div>
              )}
              {disabledProviders.length > 0 && (
                <div className="px-2 pb-1 pt-3">
                  <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55">
                    {t('provider.list.disabled')}
                  </p>
                  {disabledProviders.map((p: any) => renderProviderListItem(p, true))}
                </div>
              )}
              {enabledProviders.length === 0 && disabledProviders.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t('provider.list.noProviders')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Config panel */}
        <div className="flex-1 min-w-0">
          {selectedProvider ? (
            <ProviderConfigPanel provider={selectedProvider} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('provider.list.selectProvider')}
            </div>
          )}
        </div>
      </div>
      ) : (
        <div
          id="provider-panel-tabpanel-models"
          role="tabpanel"
          aria-labelledby="provider-panel-tab-models"
          className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4"
        >
          <ModelManagementPanel
            providerFilter={resolvedModelProviderFilter}
            onProviderFilterChange={setModelProviderFilter}
          />
        </div>
      )}

      <AddProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc('confirmDelete.deleteProvider.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tc('confirmDelete.deleteProvider.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  const wasSelected = resolvedSelectedId === deleteTarget.id
                  const remainingProviders = providers.filter((provider) => provider.id !== deleteTarget.id)
                  deleteProvider(deleteTarget.id)
                  if (wasSelected) {
                    const nextProvider = remainingProviders.find((provider) => provider.enabled) ?? remainingProviders[0]
                    setUserSelectedId(nextProvider?.id ?? null)
                    if (modelProviderFilter !== ALL_PROVIDER_FILTER) {
                      setModelProviderFilter(nextProvider ? getProviderSourceKey(nextProvider) : null)
                    }
                  }
                  toast.success(t('provider.list.providerDeleted'))
                }
                setDeleteTarget(null)
              }}
            >
              {tc('confirmDelete.deleteProvider.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ProviderPanel }
