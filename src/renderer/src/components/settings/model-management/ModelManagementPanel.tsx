/**
 * Model Management Panel — global model library.
 *
 * Displays all managed models (builtin + custom) with their provider sources.
 * Users can add, edit, delete, and toggle models, as well as configure
 * thinking settings. Provider copies inherit defaults from here.
 *
 * Migrated from OpenCowork's ProviderPanel.tsx ModelManagementPanel.
 */

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  Brain,
  Layers,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
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
import { useProviderStore } from '@renderer/stores/provider-store'
import type { AIModelConfig } from '../../../../../shared/types/provider'
import type { ManagedModelConfig } from '@renderer/stores/managed-models'
import { normalizeModelKey, toManagedModelBase } from '@renderer/stores/managed-models'
import { cn } from '@renderer/lib/utils'
import { ProviderIcon, ModelIcon } from '../provider-icons'
import { ModelFormDialog } from '../provider/ModelFormDialog'
import { ThinkingConfigDialog } from '../provider/ThinkingConfigDialog'
import { toRoundedTokenThousands } from '../provider/constants'
import {
  buildManagedModelProviderSourceIndex,
  sortManagedModelProviderSourcesForList,
  ALL_PROVIDER_FILTER,
  type ManagedModelProviderSource
} from './provider-source-index'
import { getCapabilityIndicators } from './model-capability-helpers'

export function ModelManagementPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const managedModels = useProviderStore((s) => s.managedModels)
  const providers = useProviderStore((s) => s.providers)
  const addManagedModel = useProviderStore((s) => s.addManagedModel)
  const updateManagedModel = useProviderStore((s) => s.updateManagedModel)
  const removeManagedModel = useProviderStore((s) => s.removeManagedModel)
  const resetModelConfigurationToDefaults = useProviderStore(
    (s) => s.resetModelConfigurationToDefaults
  )

  const [modelSearch, setModelSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDER_FILTER)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ManagedModelConfig | null>(null)
  const [editingThinkingModel, setEditingThinkingModel] = useState<ManagedModelConfig | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedModelConfig | null>(null)

  const providerSourceIndex = useMemo(
    () => buildManagedModelProviderSourceIndex(providers),
    [providers]
  )

  const providerFilterOptions = useMemo(() => {
    const optionsByKey = new Map<string, ManagedModelProviderSource>()
    for (const model of managedModels) {
      const sources = providerSourceIndex.get(model.normalizedKey) ?? []
      for (const source of sources) {
        optionsByKey.set(source.key, source)
      }
    }
    return sortManagedModelProviderSourcesForList(Array.from(optionsByKey.values()))
  }, [managedModels, providerSourceIndex])

  const resolvedProviderFilter =
    providerFilter === ALL_PROVIDER_FILTER ||
    providerFilterOptions.some((option) => option.key === providerFilter)
      ? providerFilter
      : ALL_PROVIDER_FILTER

  const enabledModelCount = managedModels.filter((model) => model.enabled).length
  const configuredProviderSourceCount = providerFilterOptions.filter((s) => s.configured).length
  const presetProviderSourceCount = providerFilterOptions.length - configuredProviderSourceCount

  const filteredModels = useMemo(() => {
    const query = modelSearch.toLowerCase()
    return managedModels.filter((model) => {
      const sources = providerSourceIndex.get(model.normalizedKey) ?? []
      const matchesProvider =
        resolvedProviderFilter === ALL_PROVIDER_FILTER ||
        sources.some((source) => source.key === resolvedProviderFilter)
      if (!matchesProvider) return false
      if (!query) return true
      return (
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        sources.some(
          (source) =>
            source.name.toLowerCase().includes(query) ||
            source.type.toLowerCase().includes(query) ||
            source.builtinId?.toLowerCase().includes(query)
        )
      )
    })
  }, [managedModels, modelSearch, resolvedProviderFilter, providerSourceIndex])

  const handleSaveManagedModel = (model: AIModelConfig, currentKey?: string): boolean => {
    const nextKey = normalizeModelKey(model.id)
    const duplicate = managedModels.find(
      (item) => item.normalizedKey === nextKey && item.normalizedKey !== currentKey
    )
    if (duplicate) {
      toast.error(t('provider.modelManagementDuplicate', { id: duplicate.id }))
      return false
    }
    if (currentKey) {
      updateManagedModel(model.id, model)
    } else {
      addManagedModel(model)
    }
    return true
  }

  const handleRestoreDefaults = (): void => {
    resetModelConfigurationToDefaults()
    setModelSearch('')
    setProviderFilter(ALL_PROVIDER_FILTER)
    setEditingModel(null)
    setEditingThinkingModel(null)
    toast.success(t('provider.modelManagementRestoreDefaultsDone'))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
      {/* Header */}
      <div className="shrink-0 border-b bg-muted/10 px-5 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary shadow-xs">
                <Layers className="size-4" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold">
                  {t('provider.modelManagement')}
                </h3>
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
                onClick={handleRestoreDefaults}
              >
                <RefreshCw className="size-3.5" />
                {t('provider.modelManagementRestoreDefaults')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                onClick={() => setAddModelOpen(true)}
              >
                <Plus className="size-3.5" />
                {t('provider.addModel')}
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: t('provider.modelManagementStatTotal'), value: managedModels.length.toLocaleString() },
              { label: t('provider.modelManagementStatEnabled'), value: enabledModelCount.toLocaleString() },
              { label: t('provider.modelManagementStatProviders'), value: providerFilterOptions.length.toLocaleString() },
              { label: t('provider.modelManagementStatMatches'), value: filteredModels.length.toLocaleString() }
            ].map((item) => (
              <div key={item.label} className="rounded-xl border bg-background px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {item.label}
                </div>
                <div className="mt-1 text-lg font-semibold leading-none">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 text-xs text-muted-foreground">
              {t('provider.modelManagementCount', { total: managedModels.length, enabled: enabledModelCount })}
              <span className="mx-2 text-muted-foreground/40">/</span>
              {t('provider.modelManagementSourceSummary', {
                configured: configuredProviderSourceCount,
                preset: presetProviderSourceCount
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
              <Select value={resolvedProviderFilter} onValueChange={setProviderFilter}>
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
                  onChange={(e) => setModelSearch(e.target.value)}
                  className="h-8 w-full bg-background pl-8 text-xs sm:w-64"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b bg-background/95 px-5 py-2">
          <div className="truncate text-xs font-medium">{t('provider.modelManagementList')}</div>
          <div className="shrink-0 text-[11px] text-muted-foreground">
            {t('provider.modelManagementShowing', { shown: filteredModels.length, total: managedModels.length })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {filteredModels.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {managedModels.length === 0 ? t('provider.noManagedModels') : t('provider.noMatchResults')}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filteredModels.map((model) => {
                const capabilityIndicators = getCapabilityIndicators(model)
                const providerSources = providerSourceIndex.get(model.normalizedKey) ?? []
                const primarySource = providerSources[0]
                const visibleSources = providerSources.slice(0, 4)
                const hiddenCount = Math.max(0, providerSources.length - 4)

                return (
                  <div
                    key={model.normalizedKey}
                    className={cn(
                      'group flex items-center gap-3 border-b border-border/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-muted/25',
                      model.enabled ? '' : 'bg-muted/10 opacity-75'
                    )}
                  >
                    {/* Model icon + provider badge */}
                    <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/45 ring-1 ring-border/60">
                      <ModelIcon
                        icon={model.icon}
                        modelId={model.id}
                        providerBuiltinId={primarySource?.builtinId}
                        size={20}
                        className="shrink-0 opacity-80"
                      />
                      {primarySource && (
                        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-background bg-background shadow-sm">
                          <ProviderIcon builtinId={primarySource.builtinId} size={13} />
                        </span>
                      )}
                    </div>

                    {/* Model info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium">{model.name}</p>
                        {!model.enabled && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('provider.disabled')}
                          </span>
                        )}
                        <span className="truncate font-mono text-[10px] text-muted-foreground/50">
                          {model.id}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground/60">
                        {/* Provider sources */}
                        {providerSources.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/20 px-2 py-1 text-muted-foreground/80">
                                <span className="flex -space-x-1.5">
                                  {visibleSources.map((source) => (
                                    <span
                                      key={source.key}
                                      className="flex size-5 items-center justify-center rounded-full border border-background bg-background shadow-xs"
                                    >
                                      <ProviderIcon builtinId={source.builtinId} size={13} />
                                    </span>
                                  ))}
                                </span>
                                <span className="truncate">
                                  {t('provider.modelManagementSourceCount', { count: providerSources.length })}
                                </span>
                                {hiddenCount > 0 && <span className="shrink-0">+{hiddenCount}</span>}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-[11px]">
                              <div className="flex max-w-64 flex-col gap-1">
                                {providerSources.map((source) => (
                                  <div key={source.key} className="flex items-center gap-1.5">
                                    <ProviderIcon builtinId={source.builtinId} size={12} />
                                    <span className="min-w-0 flex-1 truncate">{source.name}</span>
                                    <span className="text-muted-foreground/70">
                                      {source.configured
                                        ? source.enabled
                                          ? t('provider.enabled')
                                          : t('provider.disabled')
                                        : t('provider.modelManagementPresetProvider')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/20 px-2 py-1 text-muted-foreground/80">
                            <ProviderIcon size={13} />
                            {t('provider.modelManagementNoSource')}
                          </span>
                        )}

                        {/* Specs */}
                        {model.contextLength && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            {toRoundedTokenThousands(model.contextLength)}K ctx
                          </span>
                        )}
                        {model.maxOutputTokens && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            {toRoundedTokenThousands(model.maxOutputTokens)}K out
                          </span>
                        )}
                        {(model.inputPrice != null || model.outputPrice != null) && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            ${model.inputPrice ?? '?'}/${model.outputPrice ?? '?'}
                          </span>
                        )}

                        {/* Capability icons */}
                        {capabilityIndicators.length > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground/60">
                            {capabilityIndicators.map(({ key, icon: Icon }) => (
                              <Tooltip key={`${model.normalizedKey}-${key}`}>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                    <Icon className="size-3" />
                                  </span>
                                </TooltipTrigger>
                              </Tooltip>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:bg-muted hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
                          onClick={() => setEditingModel(model)}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[11px]">
                        {t('provider.editModel')}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:opacity-0 lg:group-hover:opacity-100',
                            model.supportsThinking
                              ? 'text-violet-500'
                              : 'text-muted-foreground/45 hover:text-foreground'
                          )}
                          onClick={() => setEditingThinkingModel(model)}
                        >
                          <Brain className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[11px]">
                        {model.supportsThinking
                          ? t('provider.editThinkConfig')
                          : t('provider.configThinkSupport')}
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:text-destructive lg:opacity-0 lg:group-hover:opacity-100"
                      onClick={() => setDeleteTarget(model)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <div className="rounded-full border bg-background px-1 py-0.5">
                      <Switch
                        checked={model.enabled}
                        onCheckedChange={() => {
                          updateManagedModel(model.id, {
                            ...toManagedModelBase(model),
                            enabled: !model.enabled
                          })
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Hint */}
      <div className="shrink-0 border-t px-5 py-2 text-[11px] text-muted-foreground/60">
        {t('provider.modelManagementHint')}
      </div>

      {/* Add model dialog */}
      <ModelFormDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        providerType={null}
        onSave={(model) => handleSaveManagedModel(model)}
      />

      {/* Edit model dialog */}
      {editingModel && (
        <ModelFormDialog
          open={!!editingModel}
          onOpenChange={(value) => {
            if (!value) setEditingModel(null)
          }}
          providerType={null}
          initial={editingModel}
          allowIdEditing
          onSave={(model) => {
            const saved = handleSaveManagedModel(model, editingModel.normalizedKey)
            if (saved) setEditingModel(null)
            return saved
          }}
        />
      )}

      {/* Thinking config dialog */}
      {editingThinkingModel && (
        <ThinkingConfigDialog
          model={editingThinkingModel}
          open={!!editingThinkingModel}
          onOpenChange={(value) => {
            if (!value) setEditingThinkingModel(null)
          }}
          onSave={(supportsThinking, thinkingConfig) => {
            updateManagedModel(editingThinkingModel.id, {
              ...toManagedModelBase(editingThinkingModel),
              supportsThinking,
              thinkingConfig: supportsThinking ? thinkingConfig : undefined
            })
            setEditingThinkingModel(null)
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('provider.modelManagementDeleteConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('provider.modelManagementHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  removeManagedModel(deleteTarget.id)
                  setDeleteTarget(null)
                }
              }}
            >
              {t('common:action.delete', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
