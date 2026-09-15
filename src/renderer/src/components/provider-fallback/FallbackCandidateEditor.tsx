import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ProviderIcon } from '@renderer/components/settings/provider-icons'
import { useProviderStore } from '@renderer/stores/provider-store'
import { cn } from '@renderer/lib/utils'
import type {
  AIProvider,
  AIModelConfig,
  ProviderFallbackCandidate
} from '../../../../shared/types/provider'

/** Rows are separated by hairlines — one border per row reads as a wall of boxes. */
export const FALLBACK_ROWS_CLASS = 'divide-y divide-border/60'

/**
 * One chain entry, laid out on two lines: provider on top, model underneath.
 *
 * The model gets its own line because it is the long value — squeezed next to the
 * provider name in a narrow panel it was the first thing to disappear. `actions` is
 * whatever the surface needs on the right (a model picker in Settings, a switch in the
 * session panel).
 */
export function FallbackRow({
  index,
  provider,
  modelId,
  actions
}: {
  /** Position in the chain, or null when the entry is not part of it. */
  index: number | null
  provider: AIProvider
  modelId: string
  actions: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const model = useMemo(() => findChatModel(provider, modelId), [provider, modelId])

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className="w-3.5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/70">
        {index === null ? '' : index + 1}
      </span>
      <ProviderIcon builtinId={provider.builtinId} size={14} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={cn('truncate text-xs', index === null ? 'text-muted-foreground' : 'font-medium')}>
          {provider.name}
        </span>
        <span
          className={cn(
            'truncate text-[10px]',
            model ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-500'
          )}
        >
          {model?.name ?? (modelId ? t('provider.fallback.modelGone') : t('provider.fallback.modelMissing'))}
        </span>
      </div>
      {model && model.supportsFunctionCall === false ? (
        // A warning, not a block: the handover still works, the continued turn just
        // cannot use tools.
        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
          {t('provider.fallback.modelNoTools')}
        </span>
      ) : null}
      {actions}
    </div>
  )
}

/** Chat models of one provider. Anything else cannot serve a failover turn. */
export function chatModelsOf(provider: AIProvider): AIModelConfig[] {
  return (provider.models ?? []).filter(
    (model) =>
      model.enabled !== false && (model.category === undefined || model.category === 'chat')
  )
}

export function findChatModel(provider: AIProvider, modelId: string): AIModelConfig | null {
  if (!modelId) return null
  return chatModelsOf(provider).find((model) => model.id === modelId) ?? null
}

/**
 * Editor for the **default** chain (Settings → 自动切换): `{ provider, model }` entries,
 * ordered, with the model chosen right here.
 *
 * The per-session panel deliberately does *not* use this — it only enables and reorders
 * the entries configured here, so its rows show the model as text. Keeping the picker in
 * one place is what stops a handover from landing on a model nobody chose.
 */
export function FallbackCandidateEditor({
  candidates,
  onChange,
  className
}: {
  candidates: ProviderFallbackCandidate[]
  onChange: (candidates: ProviderFallbackCandidate[]) => void
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((state) => state.providers)

  const providerById = useMemo(() => {
    const map = new Map<string, AIProvider>()
    for (const provider of providers) map.set(provider.id, provider)
    return map
  }, [providers])

  // Entries whose provider no longer exists are hidden from the working copy: every
  // change rewrites the list, so a deleted provider is pruned on the next edit.
  const ordered = useMemo(
    () => candidates.filter((candidate) => providerById.has(candidate.providerId)),
    [candidates, providerById]
  )

  // Only enabled providers can be added — an entry that is switched off can never serve
  // a handover, so offering it would just be noise. Entries already in the chain stay
  // listed even if their provider was disabled afterwards (they are marked instead),
  // so turning a provider off does not silently drop the user's configuration.
  const available = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled && !ordered.some((item) => item.providerId === provider.id)
      ),
    [providers, ordered]
  )

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const next = [...ordered]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  const isReady = (provider: AIProvider): boolean =>
    provider.enabled && (provider.requiresApiKey === false || Boolean(provider.apiKey))

  return (
    <div className={className}>
      {ordered.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          {t('provider.fallback.empty')}
        </p>
      ) : (
        <div className={FALLBACK_ROWS_CLASS}>
          {ordered.map((candidate, index) => {
            const provider = providerById.get(candidate.providerId)
            if (!provider) return null
            return (
              <FallbackRow
                key={candidate.providerId}
                index={index}
                provider={provider}
                modelId={candidate.modelId}
                actions={
                  <>
                    <CandidateModelSelect
                      provider={provider}
                      modelId={candidate.modelId}
                      onChange={(modelId) =>
                        onChange(
                          ordered.map((item, i) => (i === index ? { ...item, modelId } : item))
                        )
                      }
                    />
                    {!isReady(provider) ? (
                      <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
                        {t('provider.fallback.notReady')}
                      </span>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                      disabled={index === 0}
                      title={t('provider.fallback.moveUp')}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                      disabled={index === ordered.length - 1}
                      title={t('provider.fallback.moveDown')}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                      title={t('provider.fallback.remove')}
                      onClick={() =>
                        onChange(ordered.filter((item) => item.providerId !== candidate.providerId))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                }
              />
            )
          })}
        </div>
      )}

      {available.length > 0 ? (
        <div className={cn(FALLBACK_ROWS_CLASS, ordered.length > 0 && 'border-t border-border/60')}>
          {available.map((provider) => (
            <div key={provider.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-3.5 shrink-0" />
              <ProviderIcon builtinId={provider.builtinId} size={14} />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {provider.name}
              </span>
              {!isReady(provider) ? (
                <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
                  {t('provider.fallback.notReady')}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                title={t('provider.fallback.add')}
                // Added with an empty model, which the runtime skips until the user picks
                // one — guessing a model here is what this whole change removes.
                onClick={() => onChange([...ordered, { providerId: provider.id, modelId: '' }])}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CandidateModelSelect({
  provider,
  modelId,
  onChange
}: {
  provider: AIProvider
  modelId: string
  onChange: (modelId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const models = chatModelsOf(provider)

  return (
    <Select value={modelId || undefined} onValueChange={onChange}>
      <SelectTrigger className="h-6 w-40 shrink-0 text-[11px]">
        <SelectValue placeholder={t('provider.fallback.chooseModel')} />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
