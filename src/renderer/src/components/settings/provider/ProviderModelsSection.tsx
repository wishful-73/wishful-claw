import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Search,
  Eye,
  Loader2,
  Trash2,
  RefreshCw,
  Pencil,
  Brain,
  Code2,
  Image as ImageIcon,
  Mic,
  Video,
  Shapes,
  MonitorSmartphone,
  Sparkles,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
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
import { isProviderAuthReady, useProviderStore } from '@renderer/stores/provider-store'
import type { AIProvider, AIModelConfig } from '../../../../../shared/types/provider'
import { cn } from '@renderer/lib/utils'
import { toRoundedTokenThousands } from './constants'
import { ModelFormDialog } from './ModelFormDialog'
import { ThinkingConfigDialog } from './ThinkingConfigDialog'
import { ModelIcon } from '../provider-icons'

/**
 * The provider's model list: header counts, search, bulk actions, rows and the
 * three dialogs those rows open.
 *
 * Split out of `ProviderConfigPanel.tsx`, which had grown past the 500-line
 * limit. Everything the section needs lives here — the store actions come from
 * `useProviderStore` directly and the seven pieces of state moved with their
 * markup, so the parent's only prop is the provider itself.
 */

function getCapabilityIndicators(model: AIModelConfig): Array<{
  key: string
  icon: React.ComponentType<{ className?: string }>
  labelKey: string
}> {
  const indicators: Array<{ key: string; icon: React.ComponentType<{ className?: string }>; labelKey: string }> = []
  if (model.category === 'image') {
    indicators.push({ key: 'category-image', icon: ImageIcon, labelKey: 'capabilities.image' })
  } else if (model.category === 'speech') {
    indicators.push({ key: 'category-speech', icon: Mic, labelKey: 'capabilities.speech' })
  } else if (model.category === 'embedding') {
    indicators.push({ key: 'category-embedding', icon: Shapes, labelKey: 'capabilities.embedding' })
  } else if (model.category === 'video') {
    indicators.push({ key: 'category-video', icon: Video, labelKey: 'capabilities.video' })
  }
  if (model.supportsVision) {
    indicators.push({ key: 'vision', icon: Eye, labelKey: 'capabilities.vision' })
  }
  if (model.supportsFunctionCall !== false) {
    indicators.push({ key: 'function', icon: Code2, labelKey: 'capabilities.functionCall' })
  }
  if (model.supportsComputerUse) {
    indicators.push({
      key: 'computer-use',
      icon: MonitorSmartphone,
      labelKey: model.enableComputerUse ? 'capabilities.computerUseEnabled' : 'capabilities.computerUse'
    })
  }
  if (model.supportsThinking) {
    indicators.push({ key: 'thinking', icon: Sparkles, labelKey: 'capabilities.thinking' })
  }
  return indicators
}

export function ProviderModelsSection({ provider }: { provider: AIProvider }): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const addModel = useProviderStore((s) => s.addModel)
  const updateModel = useProviderStore((s) => s.updateModel)
  const deleteModel = useProviderStore((s) => s.deleteModel)
  const setModels = useProviderStore((s) => s.setModels)
  const testConnection = useProviderStore((s) => s.testConnection)
  const fetchModels = useProviderStore((s) => s.fetchModels)

  const [testingModelId, setTestingModelId] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModelConfig | null>(null)
  const [editingThinkingModel, setEditingThinkingModel] = useState<AIModelConfig | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [deleteModelTarget, setDeleteModelTarget] = useState<AIModelConfig | null>(null)

  const enabledModelCount = provider.models.filter((m) => m.enabled).length
  const hasEnabledModels = enabledModelCount > 0
  const hasDisabledModels = enabledModelCount < provider.models.length
  // The `requiresApiKey === false` clause is load-bearing: `isProviderAuthReady`
  // answers "can this provider serve a model right now" and reports OAuth-backed
  // providers (Codex / Copilot / Kimi) as not ready, since they carry no API key.
  const authReady = provider.requiresApiKey === false || isProviderAuthReady(provider)

  const filteredModels = useMemo(() => {
    const q = modelSearch.toLowerCase()
    const list = modelSearch
      ? provider.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        )
      : provider.models
    // Display order: enabled models first; within each group the store order
    // is preserved (Array.prototype.sort is stable).
    return [...list].sort((a, b) => Number(b.enabled) - Number(a.enabled))
  }, [provider.models, modelSearch])

  const handleSetAllModelsEnabled = (enabled: boolean): void => {
    setModels(
      provider.id,
      provider.models.map((m) => (m.enabled === enabled ? m : { ...m, enabled }))
    )
  }

  const handleTestModel = async (modelId: string): Promise<void> => {
    setTestingModelId(modelId)
    try {
      const result = await testConnection(provider, modelId)
      if (result.ok) {
        toast.success(ts('provider.config.testSuccess'))
      } else {
        toast.error(ts('provider.config.testFailed'), { description: result.error })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      toast.error(ts('provider.config.testFailed'), { description: error })
    } finally {
      setTestingModelId(null)
    }
  }

  const handleFetchModels = async (): Promise<void> => {
    // Guarded with the *same* predicate the buttons use: a stricter check here
    // would leave the button enabled and then silently do nothing on click.
    if (!authReady) return
    setFetchingModels(true)
    try {
      const models = await fetchModels(provider)
      if (models.length === 0) {
        toast.info(ts('provider.config.models.fetchEmpty'))
      } else {
        setModels(provider.id, models)
        toast.success(ts('provider.config.models.fetchSuccess', { count: models.length }))
      }
    } catch (err) {
      toast.error(ts('provider.config.models.fetchFailed'), {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSaveModel = (model: AIModelConfig): void => {
    if (editingModel) {
      updateModel(provider.id, editingModel.id, model)
      toast.success(ts('provider.modelForm.modelUpdated'))
    } else {
      addModel(provider.id, model)
      toast.success(ts('provider.modelForm.modelAdded'))
    }
    setEditingModel(null)
  }

  return (
    <>
      {/* Models section (fills the remaining height) */}
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Model header with count + search + actions */}
        <div className="shrink-0 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium">{ts('provider.config.models.label')}</label>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {ts('provider.config.models.count', { total: provider.models.length, enabled: enabledModelCount })}
              </p>
            </div>
            <div className="flex items-center gap-1.5 self-start rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{filteredModels.length}</span>
              <span>/</span>
              <span>{provider.models.length}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={ts("provider.config.models.searchPlaceholder")}
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                className="h-9 border-0 bg-background pl-8 text-xs shadow-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              {provider.models.length > 0 && (
                <>
                  <Button
                    variant="outline" size="sm"
                    className="h-8 rounded-full px-3 text-[11px]"
                    disabled={!hasDisabledModels}
                    onClick={() => handleSetAllModelsEnabled(true)}
                  >
                    {tc('actions.enableAll')}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="h-8 rounded-full px-3 text-[11px]"
                    disabled={!hasEnabledModels}
                    onClick={() => handleSetAllModelsEnabled(false)}
                  >
                    {tc('actions.disableAll')}
                  </Button>
                </>
              )}
              <Button
                variant="outline" size="sm"
                className="h-8 gap-1 text-[11px]"
                onClick={handleFetchModels}
                disabled={fetchingModels || !authReady}
              >
                {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                {ts('provider.config.models.fetchModels')}
              </Button>
              <Button
                variant="outline" size="sm"
                className="h-8 w-8 rounded-full p-0"
                onClick={() => { setEditingModel(null); setModelDialogOpen(true) }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Model list */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
          {filteredModels.length === 0 ? (
            provider.models.length === 0 ? (
              // Empty provider: both actions are directly triggerable here.
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-xs text-muted-foreground">
                  {authReady
                    ? ts('provider.config.models.noModels')
                    : ts('provider.config.models.noModelsNeedApiKey')}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-[11px]"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !authReady}
                  >
                    {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    {ts('provider.config.models.fetchModels')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-[11px]"
                    onClick={() => { setEditingModel(null); setModelDialogOpen(true) }}
                  >
                    <Plus className="size-3" />
                    {ts('provider.modelForm.addTitle')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                {ts('provider.config.models.noResults')}
              </div>
            )
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filteredModels.map((model) => {
                const capabilityIndicators = getCapabilityIndicators(model)
                return (
                  <div
                    key={model.id}
                    className="group flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/50 ring-1 ring-border/50">
                      <ModelIcon icon={model.icon} modelId={model.id} providerBuiltinId={provider.builtinId} size={18} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{model.name}</p>
                        <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {model.id}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground/70">
                        {model.contextLength && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            {toRoundedTokenThousands(model.contextLength)} ctx
                          </span>
                        )}
                        {model.maxOutputTokens && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            {toRoundedTokenThousands(model.maxOutputTokens)} out
                          </span>
                        )}
                        {(model.inputPrice != null || model.outputPrice != null) && (
                          <span className="rounded-full bg-muted/45 px-2 py-0.5">
                            ${model.inputPrice ?? '?'}/${model.outputPrice ?? '?'}
                          </span>
                        )}
                        {(model.cacheCreationPrice != null || model.cacheHitPrice != null) && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
                            {model.cacheCreationPrice != null && model.cacheHitPrice != null
                              ? `cache $${model.cacheCreationPrice}/${model.cacheHitPrice}`
                              : model.cacheCreationPrice != null
                                ? `cache write $${model.cacheCreationPrice}`
                                : `cache read $${model.cacheHitPrice}`}
                          </span>
                        )}
                        {(model.premiumRequestMultiplier != null || model.availablePlans?.length) && (
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-600 dark:text-sky-400">
                            {model.premiumRequestMultiplier != null
                              ? `${model.premiumRequestMultiplier}x`
                              : 'plans'}
                            {model.availablePlans?.length
                              ? ` · ${model.availablePlans.join('/')}`
                              : ''}
                          </span>
                        )}
                        {capabilityIndicators.length > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground/60">
                            {capabilityIndicators.map(({ key, icon: Icon, labelKey }) => (
                              <Tooltip key={`${model.id}-${key}`}>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                    <Icon className="size-3" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[11px]">
                                  {tc(labelKey)}
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 self-start pl-2">
                      {/* Check connection */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex size-7 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-all hover:border-border hover:bg-background hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-40 sm:opacity-0"
                            disabled={!authReady || testingModelId !== null}
                            onClick={() => handleTestModel(model.id)}
                          >
                            {testingModelId === model.id
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <Zap className="size-3.5" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px]">{ts('provider.config.models.checkConnection')}</TooltipContent>
                      </Tooltip>
                      {/* Edit model */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex size-7 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-all hover:border-border hover:bg-background hover:text-foreground group-hover:opacity-100 sm:opacity-0"
                            onClick={() => { setEditingModel(model); setModelDialogOpen(true) }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px]">{ts('provider.config.models.editModel')}</TooltipContent>
                      </Tooltip>
                      {/* Thinking config */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              'flex size-7 items-center justify-center rounded-full border border-transparent transition-all hover:border-border hover:bg-background group-hover:opacity-100 sm:opacity-0',
                              model.supportsThinking
                                ? 'text-violet-500 hover:text-violet-500'
                                : 'text-muted-foreground/40 hover:text-foreground'
                            )}
                            onClick={() => setEditingThinkingModel(model)}
                          >
                            <Brain className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px]">
                          {model.supportsThinking ? ts('provider.config.models.editThinking') : ts('provider.config.models.configureThinking')}
                        </TooltipContent>
                      </Tooltip>
                      {/* Delete model */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded-full p-0 text-muted-foreground/40 transition-all hover:bg-background hover:text-destructive group-hover:opacity-100 sm:opacity-0"
                        onClick={() => setDeleteModelTarget(model)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      {/* Enable switch */}
                      <div className="rounded-full border bg-background px-1.5 py-1">
                        <Switch
                          checked={model.enabled}
                          onCheckedChange={(checked) => updateModel(provider.id, model.id, { enabled: checked })}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Dialogs */}
      <ModelFormDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        providerType={provider.type}
        initial={editingModel ?? undefined}
        onSave={handleSaveModel}
      />
      {editingThinkingModel && (
        <ThinkingConfigDialog
          model={editingThinkingModel}
          open={!!editingThinkingModel}
          onOpenChange={(v) => { if (!v) setEditingThinkingModel(null) }}
          onSave={(supportsThinking, thinkingConfig) => {
            if (editingThinkingModel) {
              updateModel(provider.id, editingThinkingModel.id, {
                supportsThinking,
                thinkingConfig: supportsThinking ? thinkingConfig : undefined
              })
              toast.success(ts('provider.thinking.saved'))
            }
            setEditingThinkingModel(null)
          }}
        />
      )}

      {/* Delete model confirmation */}
      <AlertDialog open={!!deleteModelTarget} onOpenChange={(v) => { if (!v) setDeleteModelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc('confirmDelete.deleteModel.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tc('confirmDelete.deleteModel.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteModelTarget) {
                  deleteModel(provider.id, deleteModelTarget.id)
                  toast.success(ts('provider.config.models.modelDeleted'))
                }
                setDeleteModelTarget(null)
              }}
            >
              {tc('confirmDelete.deleteModel.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
