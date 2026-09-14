import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { SettingHint, SettingsSection } from '../settings-primitives'
import { ProviderIcon } from '../provider-icons'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { normalizeProviderFallback } from '@renderer/stores/settings-store-types'
import { cn } from '@renderer/lib/utils'
import type { AIProvider } from '../../../../../shared/types/provider'

/**
 * Provider fallback settings (iter-29 / S-21).
 *
 * Only the *configuration* lives here: a global switch plus an ordered list of
 * provider ids. The runtime reads the list when the provider in use exhausts its
 * retries after a quota / rate-limit failure and walks the candidates that come
 * after it — see `ProviderFallbackConfig` for the full contract.
 *
 * A provider is "ready" when it is enabled and either needs no key or has one.
 * Non-ready rows can still be added (the user may fill a key later); the runtime
 * skips whatever cannot actually serve a request.
 */
export function ProviderFallbackPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const fallback = useSettingsStore((state) => state.providerFallback)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const config = useMemo(() => normalizeProviderFallback(fallback), [fallback])

  const providerById = useMemo(() => {
    const map = new Map<string, AIProvider>()
    for (const provider of providers) map.set(provider.id, provider)
    return map
  }, [providers])

  // Ids that still resolve to a provider. Stale ids are intentionally dropped from
  // the working copy: every commit rewrites the list, so a deleted provider is
  // pruned the next time the user changes anything.
  const orderedIds = useMemo(
    () => config.priority.filter((id) => providerById.has(id)),
    [config.priority, providerById]
  )

  const availableProviders = useMemo(
    () => providers.filter((provider) => !orderedIds.includes(provider.id)),
    [providers, orderedIds]
  )

  const commit = (priority: string[]): void => {
    updateSettings({ providerFallback: { enabled: config.enabled, priority } })
  }

  const toggleEnabled = (checked: boolean): void => {
    updateSettings({ providerFallback: { enabled: checked, priority: orderedIds } })
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= orderedIds.length) return
    const next = [...orderedIds]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commit(next)
  }

  const isReady = (provider: AIProvider): boolean =>
    provider.enabled && (provider.requiresApiKey === false || Boolean(provider.apiKey))

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
        {config.enabled && orderedIds.length < 2 ? (
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
        {orderedIds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            {t('provider.fallback.empty')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {orderedIds.map((id, index) => {
              const provider = providerById.get(id)
              if (!provider) return null
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-2"
                >
                  <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/70">
                    {index + 1}
                  </span>
                  <ProviderIcon builtinId={provider.builtinId} size={16} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {provider.name}
                  </span>
                  {id === activeProviderId ? (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                      {t('provider.fallback.current')}
                    </Badge>
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
                    disabled={index === orderedIds.length - 1}
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
                    onClick={() => commit(orderedIds.filter((item) => item !== id))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="sec-provider-fallback-available"
        title={t('provider.fallback.availableTitle')}
        description={t('provider.fallback.availableDesc')}
      >
        {availableProviders.length === 0 ? (
          <SettingHint>{t('provider.fallback.noAvailable')}</SettingHint>
        ) : (
          <div className="space-y-1.5">
            {availableProviders.map((provider) => (
              <div
                key={provider.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2',
                  isReady(provider) ? 'bg-background' : 'bg-muted/30'
                )}
              >
                <ProviderIcon builtinId={provider.builtinId} size={16} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
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
                  onClick={() => commit([...orderedIds, provider.id])}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
