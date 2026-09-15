import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@renderer/components/ui/switch'
import { SettingHint, SettingsSection } from '../settings-primitives'
import { FallbackCandidateEditor } from '@renderer/components/provider-fallback/FallbackCandidateEditor'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { normalizeProviderFallback } from '@renderer/stores/settings-store-types'
import type { ProviderFallbackCandidate } from '../../../../../shared/types/provider'

/**
 * Provider fallback settings (iter-29 / S-21).
 *
 * This is the **default** chain: an ordered list of `{ provider, model }`. A session
 * can override it for itself from the model switcher; this pane stays the baseline.
 *
 * The model is part of each entry on purpose — providers bill their models from one
 * shared quota, so a handover needs to know which provider *and* which model on it.
 * Inferring the model (from the current one, or from the provider default) would
 * silently send the request somewhere the user did not choose.
 */
export function ProviderFallbackPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((state) => state.providers)
  const fallback = useSettingsStore((state) => state.providerFallback)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const config = useMemo(() => normalizeProviderFallback(fallback), [fallback])

  const providerIds = useMemo(() => new Set(providers.map((provider) => provider.id)), [providers])

  // Entries whose provider is gone are dropped from the working copy: every change
  // rewrites the list, so a deleted provider is pruned on the next edit.
  const ordered = useMemo(
    () => config.candidates.filter((candidate) => providerIds.has(candidate.providerId)),
    [config.candidates, providerIds]
  )

  const commit = (candidates: ProviderFallbackCandidate[]): void => {
    updateSettings({ providerFallback: { enabled: config.enabled, candidates } })
  }

  const toggleEnabled = (checked: boolean): void => {
    updateSettings({ providerFallback: { enabled: checked, candidates: ordered } })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('provider.fallback.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('provider.fallback.subtitle')}</p>
      </div>

      <SettingsSection
        id="sec-provider-fallback-enable"
        title={t('provider.fallback.enableTitle')}
        description={t('provider.fallback.enableDesc')}
        actions={<Switch checked={config.enabled} onCheckedChange={toggleEnabled} />}
      >
        <SettingHint>{t('provider.fallback.hint')}</SettingHint>
        {config.enabled && ordered.length < 2 ? (
          <SettingHint className="text-amber-600 dark:text-amber-500">
            {t('provider.fallback.needsTwo')}
          </SettingHint>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="sec-provider-fallback-order"
        title={t('provider.fallback.orderTitle')}
        description={t('provider.fallback.orderDesc')}
      >
        <FallbackCandidateEditor candidates={ordered} onChange={commit} />
      </SettingsSection>
    </div>
  )
}
