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

/**
 * Editor for one quota-failover chain: `{ provider, model }` entries, ordered.
 *
 * Shared by the settings pane (the default chain) and the model switcher (a
 * per-session override) so the two cannot drift apart — the previous design had the
 * candidate list written out per surface, which is how it ended up disagreeing about
 * what a candidate even is.
 *
 * The caller owns persistence: it passes the current list and receives the next one.
 */
export function FallbackCandidateEditor({
  candidates,
  onChange,
  activeProviderId,
  className
}: {
  candidates: ProviderFallbackCandidate[]
  onChange: (candidates: ProviderFallbackCandidate[]) => void
  /** Marks the row the session is currently on, when known. */
  activeProviderId?: string | null
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

  const available = useMemo(
    () => providers.filter((provider) => !ordered.some((item) => item.providerId === provider.id)),
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

  const setModel = (index: number, modelId: string): void => {
    onChange(ordered.map((item, i) => (i === index ? { ...item, modelId } : item)))
  }

  const isReady = (provider: AIProvider): boolean =>
    provider.enabled && (provider.requiresApiKey === false || Boolean(provider.apiKey))

  return (
    <div className={cn('space-y-1.5', className)}>
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
          {t('provider.fallback.empty')}
        </p>
      ) : (
        ordered.map((candidate, index) => {
          const provider = providerById.get(candidate.providerId)
          if (!provider) return null
          return (
            <div
              key={candidate.providerId}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2 py-1.5"
            >
              <span className="w-3.5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/70">
                {index + 1}
              </span>
              <ProviderIcon builtinId={provider.builtinId} size={14} />
              <span className="w-24 min-w-0 shrink-0 truncate text-xs font-medium">
                {provider.name}
              </span>
              <CandidateModelSelect
                provider={provider}
                modelId={candidate.modelId}
                onChange={(modelId) => setModel(index, modelId)}
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
            </div>
          )
        })
      )}

      {available.length > 0 ? (
        <div className="space-y-1 pt-1">
          {available.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5',
                isReady(provider) ? 'bg-background' : 'bg-muted/30'
              )}
            >
              <ProviderIcon builtinId={provider.builtinId} size={14} />
              <span className="min-w-0 flex-1 truncate text-xs">{provider.name}</span>
              {provider.id === activeProviderId ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {t('provider.fallback.current')}
                </span>
              ) : null}
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

/** Chat models of one provider. Anything else cannot serve a failover turn. */
function chatModelsOf(provider: AIProvider): AIModelConfig[] {
  return (provider.models ?? []).filter(
    (model) =>
      model.enabled !== false && (model.category === undefined || model.category === 'chat')
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
  const selected = models.find((model) => model.id === modelId)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Select value={modelId || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
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
      {!modelId ? (
        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
          {t('provider.fallback.modelMissing')}
        </span>
      ) : selected && selected.supportsFunctionCall === false ? (
        // A warning, not a block: the handover still works, the continued turn just
        // cannot use tools. Refusing the pick would be worse than saying so.
        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
          {t('provider.fallback.modelNoTools')}
        </span>
      ) : null}
    </div>
  )
}
