import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { ModelFormDialog } from '../provider/ModelFormDialog'
import { ThinkingConfigDialog } from '../provider/ThinkingConfigDialog'
import { useProviderStore } from '@renderer/stores/provider-store'
import type { AIModelConfig } from '../../../../../shared/types/provider'
import type { ManagedModelConfig } from '@renderer/stores/managed-models'
import { normalizeModelKey, toManagedModelBase } from '@renderer/stores/managed-models'
import {
  ALL_PROVIDER_FILTER,
  buildManagedModelProviderSourceIndex,
  sortManagedModelProviderSourcesForList,
  type ManagedModelProviderSource
} from './provider-source-index'
import { ModelManagementHeader } from './model-management-header'
import { ModelManagementRow } from './model-management-row'

interface ModelManagementPanelProps {
  providerFilter: string
  onProviderFilterChange: (filter: string) => void
}

export function ModelManagementPanel({
  providerFilter,
  onProviderFilterChange
}: ModelManagementPanelProps): React.JSX.Element {
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
      for (const source of sources) optionsByKey.set(source.key, source)
    }
    return sortManagedModelProviderSourcesForList(Array.from(optionsByKey.values()))
  }, [managedModels, providerSourceIndex])

  const resolvedProviderFilter =
    providerFilter === ALL_PROVIDER_FILTER ||
    providerFilterOptions.some((option) => option.key === providerFilter)
      ? providerFilter
      : ALL_PROVIDER_FILTER

  const enabledModelCount = managedModels.filter((model) => model.enabled).length
  const configuredProviderSourceCount = providerFilterOptions.filter((source) => source.configured).length
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
    if (currentKey) updateManagedModel(model.id, model)
    else addManagedModel(model)
    return true
  }

  const handleRestoreDefaults = (): void => {
    resetModelConfigurationToDefaults()
    setModelSearch('')
    onProviderFilterChange(ALL_PROVIDER_FILTER)
    setEditingModel(null)
    setEditingThinkingModel(null)
    toast.success(t('provider.modelManagementRestoreDefaultsDone'))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
      <ModelManagementHeader
        totalModels={managedModels.length}
        enabledModelCount={enabledModelCount}
        filteredModelCount={filteredModels.length}
        providerFilterOptions={providerFilterOptions}
        configuredProviderSourceCount={configuredProviderSourceCount}
        presetProviderSourceCount={presetProviderSourceCount}
        providerFilter={resolvedProviderFilter}
        modelSearch={modelSearch}
        onProviderFilterChange={onProviderFilterChange}
        onModelSearchChange={setModelSearch}
        onRestoreDefaults={handleRestoreDefaults}
        onAddModel={() => setAddModelOpen(true)}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b bg-background/95 px-5 py-2">
          <div className="truncate text-xs font-medium">{t('provider.modelManagementList')}</div>
          <div className="shrink-0 text-[11px] text-muted-foreground">
            {t('provider.modelManagementShowing', { shown: filteredModels.length, total: managedModels.length })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredModels.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {managedModels.length === 0 ? t('provider.noManagedModels') : t('provider.noMatchResults')}
            </div>
          ) : (
            filteredModels.map((model) => (
              <ModelManagementRow
                key={model.normalizedKey}
                model={model}
                providerSources={providerSourceIndex.get(model.normalizedKey) ?? []}
                onEdit={setEditingModel}
                onEditThinking={setEditingThinkingModel}
                onDelete={setDeleteTarget}
                onToggle={(item) =>
                  updateManagedModel(item.id, { ...toManagedModelBase(item), enabled: !item.enabled })
                }
              />
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 border-t px-5 py-2 text-[11px] text-muted-foreground/60">
        {t('provider.modelManagementHint')}
      </div>

      <ModelFormDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        providerType={null}
        onSave={(model) => handleSaveManagedModel(model)}
      />
      {editingModel && (
        <ModelFormDialog
          open
          onOpenChange={(value) => { if (!value) setEditingModel(null) }}
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
      {editingThinkingModel && (
        <ThinkingConfigDialog
          model={editingThinkingModel}
          open
          onOpenChange={(value) => { if (!value) setEditingThinkingModel(null) }}
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(value) => { if (!value) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('provider.modelManagementDeleteConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('provider.modelManagementHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) removeManagedModel(deleteTarget.id)
                setDeleteTarget(null)
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
