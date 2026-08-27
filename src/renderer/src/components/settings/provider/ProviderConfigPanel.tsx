import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Search,
  Eye,
  EyeOff,
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
import { Separator } from '@renderer/components/ui/separator'
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
import { useProviderStore } from '@renderer/stores/provider-store'
import type {
  AIProvider,
  AIModelConfig,
  ProviderType
} from '../../../../../shared/types/provider'
import { cn } from '@renderer/lib/utils'
import {
  PROVIDER_TYPE_OPTIONS_EDIT,
  toRoundedTokenThousands
} from './constants'
import { ModelFormDialog } from './ModelFormDialog'
import { ThinkingConfigDialog } from './ThinkingConfigDialog'
import { ProviderIcon, ModelIcon } from '../provider-icons'
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

export function ProviderConfigPanel({ provider }: { provider: AIProvider }): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  
  const updateProvider = useProviderStore((s) => s.updateProvider)
  const deleteProvider = useProviderStore((s) => s.deleteProvider)
  const addModel = useProviderStore((s) => s.addModel)
  const updateModel = useProviderStore((s) => s.updateModel)
  const deleteModel = useProviderStore((s) => s.deleteModel)
  const setModels = useProviderStore((s) => s.setModels)
  const testConnection = useProviderStore((s) => s.testConnection)
  const fetchModels = useProviderStore((s) => s.fetchModels)

  const [showKey, setShowKey] = useState(false)
  const [testingModelId, setTestingModelId] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModelConfig | null>(null)
  const [editingThinkingModel, setEditingThinkingModel] = useState<AIModelConfig | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [showDeleteProvider, setShowDeleteProvider] = useState(false)
  const [deleteModelTarget, setDeleteModelTarget] = useState<AIModelConfig | null>(null)

  const enabledModelCount = provider.models.filter((m) => m.enabled).length
  const hasEnabledModels = enabledModelCount > 0
  const hasDisabledModels = enabledModelCount < provider.models.length
  const authReady = provider.requiresApiKey === false || Boolean(provider.apiKey)

  const filteredModels = useMemo(() => {
    if (!modelSearch) return provider.models
    const q = modelSearch.toLowerCase()
    return provider.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    )
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
            <ProviderIcon builtinId={provider.builtinId} size={20} />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{provider.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {ts(`provider.providerTypes.${provider.type}`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!provider.builtinId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setShowDeleteProvider(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Switch
            checked={provider.enabled}
            onCheckedChange={(checked) => updateProvider(provider.id, { enabled: checked })}
          />
        </div>
      </div>

      {/* Config body: upper sections keep natural height; the models section is
          the last element and stretches to fill all remaining vertical space,
          so only the model list itself scrolls. */}
      <div className="flex flex-1 min-h-0 flex-col overflow-x-hidden px-5 pt-4 pb-4">
        {/* API Key */}
        <section className="shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{ts('provider.config.apiKey')}</label>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={provider.requiresApiKey === false ? ts('provider.config.apiKeyNotRequired') : ts('provider.config.apiKeyPlaceholder')}
                value={provider.apiKey}
                onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                disabled={provider.requiresApiKey === false}
                className="pr-9 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
        </section>

        {/* Base URL */}
        <section className="mt-4 shrink-0 space-y-2">
          <label className="text-sm font-medium">{ts('provider.config.baseUrl')}</label>
          <Input
            placeholder="https://api.openai.com/v1"
            value={provider.baseUrl}
            onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
            className="text-xs"
          />
        </section>

        {/* Protocol type (for custom providers) */}
        {!provider.builtinId && (
          <section className="mt-5 shrink-0 space-y-2">
            <label className="text-sm font-medium">{ts('provider.config.protocolType')}</label>
            <Select
              value={provider.type}
              onValueChange={(v) => updateProvider(provider.id, { type: v as ProviderType })}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPE_OPTIONS_EDIT.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {ts(`provider.providerTypes.${t}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
        )}

        {/* Anthropic cache TTL (provider-level) */}
        {provider.type === 'anthropic' && (
          <section className="mt-5 shrink-0 space-y-2">
            <label className="text-sm font-medium">{ts('provider.config.cacheTtl')}</label>
            <Select
              value={provider.cacheTtl ?? '5m'}
              onValueChange={(v) => updateProvider(provider.id, { cacheTtl: v as '5m' | '1h' })}
            >
              <SelectTrigger className="w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{ts('provider.config.cacheTtlHint')}</p>
          </section>
        )}

        <Separator className="my-5 shrink-0" />

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
                  disabled={fetchingModels}
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
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                {provider.models.length === 0 ? ts('provider.config.models.noModels') : ts('provider.config.models.noResults')}
              </div>
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
      </div>

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

      {/* Delete provider confirmation */}
      <AlertDialog open={showDeleteProvider} onOpenChange={setShowDeleteProvider}>
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
                deleteProvider(provider.id)
                toast.success(ts('provider.list.providerDeleted'))
                setShowDeleteProvider(false)
              }}
            >
              {tc('confirmDelete.deleteProvider.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
  )
}
