import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePersonaStore } from '@renderer/stores/persona-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { Button } from '@renderer/components/ui/button'
import type { PersonaConfig } from '@renderer/lib/persona/persona-types'
import type { AIProvider } from '@shared/types/provider'

interface PersonaGeneratorDialogProps {
  open: boolean
  onClose: () => void
  workingFolder?: string
  /**
   * Handed the generated draft. The dialog does not save: the caller owns
   * preview, editing and persisting.
   */
  onGenerated: (draft: PersonaConfig) => void
}

/** Chat-capable models only — persona generation is a text completion. */
function chatModelsOf(provider: AIProvider): { id: string; name?: string }[] {
  return provider.models.filter(
    (model) => model.enabled && (!model.category || model.category === 'chat')
  )
}

export function PersonaGeneratorDialog({
  open,
  onClose,
  workingFolder,
  onGenerated
}: PersonaGeneratorDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const generatePersona = usePersonaStore((state) => state.generatePersona)
  const providers = useProviderStore((state) => state.providers)
  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled === true),
    [providers]
  )

  const [prompt, setPrompt] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the two selects once per open: prefer the "模型管理 → 新建角色辅助"
  // route, then the globally active provider/model, then the first usable pair.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const snapshot = useProviderStore.getState()
    const enabled = snapshot.providers.filter((provider) => provider.enabled === true)
    const activeProvider = snapshot.getActiveProvider()

    const applyDefaults = (configuredProviderId?: string | null, configuredModelId?: string | null): void => {
      const provider =
        enabled.find((item) => item.id === configuredProviderId) ??
        enabled.find((item) => item.id === activeProvider?.id) ??
        enabled[0] ??
        null
      if (!provider) {
        setProviderId('')
        setModelId('')
        return
      }
      const models = chatModelsOf(provider)
      setProviderId(provider.id)
      setModelId(
        models.find((model) => model.id === configuredModelId)?.id ??
          models.find((model) => model.id === snapshot.activeModelId)?.id ??
          models.find((model) => model.id === provider.defaultModel)?.id ??
          models[0]?.id ??
          ''
      )
    }

    void window.api
      .workerRequest<{ personaProviderId?: string | null; personaModelId?: string | null }>(
        'provider/completion-config-read',
        {}
      )
      .then((value) => {
        if (!cancelled) applyDefaults(value?.personaProviderId, value?.personaModelId)
      })
      .catch(() => {
        // Unreadable config is not fatal — fall back to the global active model.
        if (!cancelled) applyDefaults(null, null)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const modelOptions = useMemo(
    () => enabledProviders.find((provider) => provider.id === providerId) ? chatModelsOf(enabledProviders.find((provider) => provider.id === providerId)!) : [],
    [enabledProviders, providerId]
  )

  const handleProviderChange = useCallback(
    (nextProviderId: string): void => {
      setProviderId(nextProviderId)
      const provider = enabledProviders.find((item) => item.id === nextProviderId)
      setModelId(provider ? (chatModelsOf(provider)[0]?.id ?? '') : '')
      setError(null)
    },
    [enabledProviders]
  )

  const handleClose = useCallback((): void => {
    setPrompt('')
    setReferenceId('')
    setError(null)
    onClose()
  }, [onClose])

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (!prompt.trim()) return
    const provider = enabledProviders.find((item) => item.id === providerId)
    if (!provider) {
      setError(t('persona.noProvider'))
      return
    }
    if (!modelId) {
      setError(t('persona.noModel'))
      return
    }

    setGenerating(true)
    setError(null)
    try {
      const result = await generatePersona(
        prompt,
        {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: modelId
        },
        referenceId || undefined,
        workingFolder
      )
      if (result.success && result.draft) {
        const draft = result.draft
        onGenerated({
          id: '',
          name: draft.name ?? '',
          tagline: draft.tagline ?? '',
          description: draft.description ?? '',
          isBuiltin: false,
          identityMarkdown: draft.identityMarkdown ?? '',
          soulMarkdown: draft.soulMarkdown ?? '',
          ontologyMarkdown: draft.ontologyMarkdown ?? '',
          agentsMarkdown: draft.agentsMarkdown ?? ''
        })
        handleClose()
      } else {
        setError(result.error ?? t('persona.generateFailed'))
      }
    } finally {
      setGenerating(false)
    }
  }, [prompt, referenceId, providerId, modelId, enabledProviders, workingFolder, generatePersona, onGenerated, handleClose, t])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="flex w-[560px] flex-col rounded-lg border bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">{t('persona.aiCreate')}</h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('persona.dismiss')}
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-muted-foreground">{t('persona.aiCreateDesc')}</p>

          <textarea
            className="h-24 w-full resize-none rounded-md border bg-background p-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            placeholder={t('persona.promptPlaceholder')}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={generating}
          />

          <input
            className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            placeholder={t('persona.referencePlaceholder')}
            value={referenceId}
            onChange={(event) => setReferenceId(event.target.value)}
            disabled={generating}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t('persona.selectProvider')}
              </label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                value={providerId}
                onChange={(event) => handleProviderChange(event.target.value)}
                disabled={generating}
              >
                {enabledProviders.length === 0 && <option value="">{t('persona.noProvider')}</option>}
                {enabledProviders.map((provider) => (
                  <option value={provider.id} key={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t('persona.selectModel')}
              </label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                disabled={generating || !providerId}
              >
                {modelOptions.length === 0 && <option value="">{t('persona.noModel')}</option>}
                {modelOptions.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.name || model.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={generating}>
              {t('action.cancel', { ns: 'common' })}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleGenerate()}
              disabled={generating || !prompt.trim() || !providerId || !modelId}
            >
              {generating ? t('persona.generating') : t('persona.generate')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
