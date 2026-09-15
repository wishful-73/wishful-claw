import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import {
  FALLBACK_ROWS_CLASS,
  FallbackRow
} from '@renderer/components/provider-fallback/FallbackCandidateEditor'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeProviderFallback } from '@renderer/stores/settings-store-types'
import type { AIProvider, ProviderFallbackCandidate } from '../../../../../shared/types/provider'

/**
 * The failover chain of the current session, in the model switcher's **right-hand panel**
 * — the same place a provider opens its model list, so "Auto" reads as one more entry in
 * the column.
 *
 * Scope: this panel **enables and reorders** the entries configured in
 * Settings → 自动切换. The model itself is shown, not chosen here — the chain is one
 * piece of configuration, and letting a second surface pick models is how two of them
 * end up disagreeing about where a handover lands.
 *
 * The selection lives for the current run (in memory, like the rest of the per-session
 * runtime state), so "reset" always puts the default back.
 */
export function AutoFallbackChain({ sessionId }: { sessionId: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const providers = useProviderStore((state) => state.providers)
  const fallback = useSettingsStore((state) => state.providerFallback)
  const override = useUIStore((state) => state.fallbackCandidatesBySession[sessionId] ?? null)
  const setSessionFallbackCandidates = useUIStore((state) => state.setSessionFallbackCandidates)

  const providerById = useMemo(() => {
    const map = new Map<string, AIProvider>()
    for (const provider of providers) map.set(provider.id, provider)
    return map
  }, [providers])

  const defaults = useMemo(
    () =>
      normalizeProviderFallback(fallback).candidates.filter((candidate) =>
        providerById.has(candidate.providerId)
      ),
    [fallback, providerById]
  )

  const enabled = Boolean(fallback?.enabled)
  // `null` (never touched) means the default chain applies as-is. An override, including
  // an empty one, is the session's own answer — empty means "do not hand over here".
  const usingOverride = override !== null
  const active = usingOverride ? override : defaults
  const activeIds = useMemo(() => new Set(active.map((item) => item.providerId)), [active])

  // Rows in use first (in their adjusted order), then whatever the default chain offers
  // but this session has switched off — kept visible so it can be switched back on.
  const switchedOff = defaults.filter((candidate) => !activeIds.has(candidate.providerId))

  const commit = (candidates: ProviderFallbackCandidate[]): void => {
    setSessionFallbackCandidates(sessionId, candidates)
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= active.length) return
    const next = [...active]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commit(next)
  }

  const toggle = (providerId: string, on: boolean): void => {
    if (on) {
      const source =
        defaults.find((candidate) => candidate.providerId === providerId) ??
        ({ providerId, modelId: '' } as ProviderFallbackCandidate)
      commit([...active, source])
      return
    }
    commit(active.filter((candidate) => candidate.providerId !== providerId))
  }

  const renderRow = (
    candidate: ProviderFallbackCandidate,
    index: number | null
  ): React.JSX.Element | null => {
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
            {!provider.enabled || (provider.requiresApiKey !== false && !provider.apiKey) ? (
              <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-500">
                {t('topbar.autoFallbackNotReady', { defaultValue: '未就绪' })}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              disabled={index === null || index === 0}
              title={t('topbar.autoFallbackMoveUp', { defaultValue: '上移' })}
              onClick={() => index !== null && move(index, -1)}
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              disabled={index === null || index >= active.length - 1}
              title={t('topbar.autoFallbackMoveDown', { defaultValue: '下移' })}
              onClick={() => index !== null && move(index, 1)}
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Switch
              checked={index !== null}
              onCheckedChange={(checked) => toggle(candidate.providerId, checked)}
              aria-label={t('topbar.autoFallbackToggle', { defaultValue: '本会话启用' })}
            />
          </>
        }
      />
    )
  }

  return (
    <div className="flex max-h-[344px] flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover/95 px-2 py-1.5 backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('topbar.autoFallbackChain')}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {usingOverride
            ? t('topbar.autoFallbackChainOverridden')
            : t('topbar.autoFallbackChainDefault')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!enabled ? (
          <p className="px-3 py-3 text-[11px] text-amber-600 dark:text-amber-500">
            {t('topbar.autoFallbackDisabled')}
          </p>
        ) : defaults.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted-foreground">
            {t('topbar.autoFallbackEmpty', { defaultValue: '还没有候选，去设置里添加' })}
          </p>
        ) : (
          <div className={FALLBACK_ROWS_CLASS}>
            {active.map((candidate, index) => renderRow(candidate, index))}
            {switchedOff.map((candidate) => renderRow(candidate, null))}
          </div>
        )}
      </div>

      {usingOverride ? (
        <div className="border-t px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-full justify-start px-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setSessionFallbackCandidates(sessionId, null)}
          >
            {t('topbar.autoFallbackReset')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
