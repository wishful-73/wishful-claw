import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Target, Loader2, Play, X } from 'lucide-react'
import { useGoalStore } from '@renderer/stores/goal-store'
import { resolveGoalConfirm, cancelGoalConfirm, type GoalConfirmModelConfig } from '@renderer/lib/tools/goal-native-ui'
import { isProviderAvailableForModelSelection, useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

interface GoalConfirmCardProps {
  sessionId?: string | null
  className?: string
}

export function GoalConfirmCard({ sessionId, className }: GoalConfirmCardProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const progress = useGoalStore((s) => (sessionId ? s.goalProgressBySession[sessionId] : undefined))
  const [confirming, setConfirming] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [selectedProviderId, setSelectedProviderId] = React.useState('')
  const [selectedModelId, setSelectedModelId] = React.useState('')

  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const activeModelId = useProviderStore((state) => state.activeModelId)
  const mainModelSelectionMode = useSettingsStore((state) => state.mainModelSelectionMode)
  const session = useChatStore((state) =>
    sessionId ? state.sessions.find((item) => item.id === sessionId) : undefined
  )
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const selectedModel = selectedProvider?.models.find((model) => model.id === selectedModelId)
  const selectableProviders = React.useMemo(
    () => providers.filter((provider) => isProviderAvailableForModelSelection(provider) && provider.models.length > 0),
    [providers]
  )

  React.useEffect(() => {
    if (!sessionId || open) return
    const selection = resolveSessionModelSelection({
      session,
      providers,
      activeProviderId,
      activeModelId,
      globalMode: mainModelSelectionMode
    })
    const providerId = selection.providerId && selectableProviders.some((provider) => provider.id === selection.providerId)
      ? selection.providerId
      : selectableProviders[0]?.id ?? ''
    const provider = providers.find((item) => item.id === providerId)
    const modelId = selection.modelId && provider?.models.some((model) => model.enabled && model.id === selection.modelId)
      ? selection.modelId
      : provider?.defaultModel && provider.models.some((model) => model.enabled && model.id === provider.defaultModel)
        ? provider.defaultModel
        : provider?.models.find((model) => model.enabled)?.id ?? ''
    setSelectedProviderId(providerId)
    setSelectedModelId(modelId)
  }, [activeModelId, activeProviderId, mainModelSelectionMode, open, providers, selectableProviders, session, sessionId])

  const modelConfig = React.useMemo<GoalConfirmModelConfig | undefined>(() => {
    if (!selectedProvider || !selectedModel) return undefined
    const settings = useSettingsStore.getState()
    return {
      providerId: selectedProvider.id,
      providerType: selectedProvider.type,
      model: selectedModel.id,
      baseUrl: selectedProvider.baseUrl,
      temperature: settings.temperature ?? undefined,
      maxTokens: settings.maxTokens ?? undefined,
      thinkingEnabled: settings.thinkingEnabled,
      thinkingConfig: selectedModel.thinkingConfig as Record<string, unknown> | undefined,
      reasoningEffort: settings.reasoningEffort ?? undefined,
      requestTimeoutSeconds: settings.apiRequestTimeoutSeconds ?? 100,
      requestMaxRetries: settings.requestMaxRetries ?? 10
    }
  }, [selectedModel, selectedProvider])

  if (!sessionId || !progress || progress.status !== 'pending') return null

  const goalId = progress.goalId
  const objective = progress.objective ?? ''

  const handleConfirm = async (): Promise<void> => {
    if (!modelConfig) return
    setConfirming(true)
    setOpen(false)
    resolveGoalConfirm(goalId, true, sessionId, modelConfig)
  }

  const handleDiscard = async (): Promise<void> => {
    setCancelling(true)
    cancelGoalConfirm(goalId, sessionId)
  }

  return (
    <div className={cn('rounded-2xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 shadow-sm backdrop-blur', className)}>
      <div className="flex items-start gap-2">
        <Target className="mt-0.5 size-4 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground/90">
            {t('goal.pendingConfirmTitle', { defaultValue: 'Confirm this goal before execution' })}
          </div>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
            {objective}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-destructive"
            disabled={cancelling}
            onClick={handleDiscard}
          >
            {cancelling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )}
            {t('goal.discard', { defaultValue: 'Cancel goal' })}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-sky-600 text-white hover:bg-sky-700"
            disabled={confirming || !modelConfig}
            onClick={() => setOpen(true)}
          >
            {confirming ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {t('goal.confirmRun', { defaultValue: 'Confirm & start' })}
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={(nextOpen) => !confirming && setOpen(nextOpen)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('goal.modelConfirmTitle', { defaultValue: 'Choose the Goal model' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">
                {t('goal.objectiveLabel', { defaultValue: 'Goal' })}
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm">{objective}</div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('goal.providerLabel', { defaultValue: 'API provider' })}
              </span>
              <Select
                value={selectedProviderId}
                onValueChange={(providerId) => {
                  setSelectedProviderId(providerId)
                  const provider = providers.find((item) => item.id === providerId)
                  setSelectedModelId(
                    provider?.defaultModel && provider.models.some((model) => model.enabled && model.id === provider.defaultModel)
                      ? provider.defaultModel
                      : provider?.models.find((model) => model.enabled)?.id ?? ''
                  )
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('goal.providerPlaceholder', { defaultValue: 'Select a provider' })} />
                </SelectTrigger>
                <SelectContent>
                  {selectableProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('goal.modelLabel', { defaultValue: 'Model' })}
              </span>
              <Select value={selectedModelId} onValueChange={setSelectedModelId} disabled={!selectedProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('goal.modelPlaceholder', { defaultValue: 'Select a model' })} />
                </SelectTrigger>
                <SelectContent>
                  {selectedProvider?.models.filter((model) => model.enabled).map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.name || model.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={confirming}>
              {t('common:action.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={handleConfirm} disabled={confirming || !modelConfig}>
              {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t('goal.confirmRun', { defaultValue: 'Confirm & start' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}