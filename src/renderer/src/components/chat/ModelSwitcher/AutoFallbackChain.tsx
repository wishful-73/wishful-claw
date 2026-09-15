import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { FallbackCandidateEditor } from '@renderer/components/provider-fallback/FallbackCandidateEditor'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeProviderFallback } from '@renderer/stores/settings-store-types'
import type { ProviderFallbackCandidate } from '../../../../../shared/types/provider'

/**
 * The failover chain of the current session, shown in the model switcher's **right-hand
 * panel** — the same place a provider opens its model list, so "Auto" reads as one more
 * entry in the column rather than a section wedged underneath it.
 *
 * What it edits is the per-session override of the chain configured in
 * Settings → 自动切换. It starts from that default and lives for the current run
 * (in memory, like the rest of the per-session runtime state), so "reset" always puts
 * the default back.
 *
 * Only rendered for sessions in `auto` mode: that mode is what permits a handover at
 * all. A session with an explicitly chosen model just reports the quota error.
 */
export function AutoFallbackChain({ sessionId }: { sessionId: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const fallback = useSettingsStore((state) => state.providerFallback)
  const override = useUIStore((state) => state.fallbackCandidatesBySession[sessionId] ?? null)
  const setSessionFallbackCandidates = useUIStore((state) => state.setSessionFallbackCandidates)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)

  const defaultCandidates = useMemo(() => normalizeProviderFallback(fallback).candidates, [fallback])
  const enabled = Boolean(fallback?.enabled)
  const usingOverride = Boolean(override && override.length > 0)
  const effective = usingOverride ? (override as ProviderFallbackCandidate[]) : defaultCandidates

  const commit = (candidates: ProviderFallbackCandidate[]): void => {
    setSessionFallbackCandidates(sessionId, candidates)
  }

  return (
    <div className="flex max-h-[344px] flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover/95 px-2 py-1.5 backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('topbar.autoFallbackChain', { defaultValue: '自动切换链' })}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {usingOverride
            ? t('topbar.autoFallbackChainOverridden', { defaultValue: '本会话已调整' })
            : t('topbar.autoFallbackChainDefault', { defaultValue: '默认' })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!enabled ? (
          <p className="px-2 py-3 text-[11px] text-amber-600 dark:text-amber-500">
            {t('topbar.autoFallbackDisabled', {
              defaultValue: '自动切换未启用，去设置 → 服务商 → 自动切换 打开'
            })}
          </p>
        ) : (
          <FallbackCandidateEditor
            candidates={effective}
            onChange={commit}
            activeProviderId={activeProviderId}
          />
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
            {t('topbar.autoFallbackReset', { defaultValue: '恢复默认' })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
