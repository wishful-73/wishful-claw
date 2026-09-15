import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { FallbackCandidateEditor } from '@renderer/components/provider-fallback/FallbackCandidateEditor'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeProviderFallback } from '@renderer/stores/settings-store-types'
import type { ProviderFallbackCandidate } from '../../../../../shared/types/provider'

/**
 * Quota-failover chain for the current session, edited from the model switcher.
 *
 * This is the per-session override of the chain configured in Settings → 自动切换.
 * It starts from the default and lives for the current run (in memory, like the rest
 * of the per-session runtime state), so "reset" always puts the default back.
 *
 * Only rendered for sessions in `auto` mode — that mode is what permits a handover at
 * all; a session with an explicitly chosen model just reports the quota error.
 */
export function AutoFallbackChain({ sessionId }: { sessionId: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [expanded, setExpanded] = useState(false)
  const fallback = useSettingsStore((state) => state.providerFallback)
  const override = useUIStore((state) => state.fallbackCandidatesBySession[sessionId] ?? null)
  const setSessionFallbackCandidates = useUIStore((state) => state.setSessionFallbackCandidates)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)

  const defaultCandidates = useMemo(
    () => normalizeProviderFallback(fallback).candidates,
    [fallback]
  )
  const enabled = Boolean(fallback?.enabled)
  const effective = override && override.length > 0 ? override : defaultCandidates
  const usingOverride = Boolean(override && override.length > 0)

  const summary = useMemo(
    () =>
      effective
        .filter((candidate) => candidate.modelId)
        .map((candidate) => candidate.modelId)
        .join(' → '),
    [effective]
  )

  const commit = (candidates: ProviderFallbackCandidate[]): void => {
    setSessionFallbackCandidates(sessionId, candidates)
  }

  return (
    <div className="border-b">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs">
          {t('topbar.autoFallbackChain', { defaultValue: '自动切换链' })}
          {usingOverride ? (
            <span className="ml-1 text-[10px] text-muted-foreground">
              {t('topbar.autoFallbackChainOverridden', { defaultValue: '（本会话已调整）' })}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {effective.length}
        </span>
      </button>

      {expanded ? (
        <div className="space-y-2 px-3 pb-3">
          {!enabled ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              {t('topbar.autoFallbackDisabled', {
                defaultValue: '自动切换未启用，去设置 → 服务商 → 自动切换 打开'
              })}
            </p>
          ) : null}
          {effective.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t('topbar.autoFallbackEmpty', {
                defaultValue: '还没有候选，去设置 → 服务商 → 自动切换 添加'
              })}
            </p>
          ) : null}
          <FallbackCandidateEditor
            candidates={effective}
            onChange={commit}
            activeProviderId={activeProviderId}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              {summary}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              disabled={!usingOverride}
              onClick={() => setSessionFallbackCandidates(sessionId, null)}
            >
              {t('topbar.autoFallbackReset', { defaultValue: '恢复默认' })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
