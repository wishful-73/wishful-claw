import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  useSettingsStore,
  clampApiRequestTimeoutSeconds,
  DEFAULT_API_REQUEST_TIMEOUT_SECONDS,
  clampRequestMaxRetries,
  MIN_API_REQUEST_TIMEOUT_SECONDS,
  MAX_API_REQUEST_TIMEOUT_SECONDS
} from '@renderer/stores/settings-store'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'

function RuntimePanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 pb-16 pt-10">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold">{t('runtime.title', { defaultValue: 'Runtime & Performance' })}</h2>
        <p className="text-sm text-muted-foreground">
          {t('runtime.subtitle', {
            defaultValue: 'API request timeout, retry policy and context compression.'
          })}
        </p>
      </div>

      {/* API Request Timeout */}
      <section className="space-y-3">
        <div className="max-w-lg">
          <label className="text-sm font-medium text-foreground">
            {t('general.apiRequestTimeout', { defaultValue: 'API Request Timeout' })}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('general.apiRequestTimeoutDesc', {
              defaultValue:
                'Maximum seconds to wait for response headers. Set 0 to wait indefinitely; an active stream is not cut off.'
            })}
          </p>
        </div>
        <div className="flex max-w-lg items-center gap-3">
          <Input
            type="number"
            min={MIN_API_REQUEST_TIMEOUT_SECONDS}
            max={MAX_API_REQUEST_TIMEOUT_SECONDS}
            step={10}
            value={settings.apiRequestTimeoutSeconds}
            onChange={(event) =>
              settings.updateSettings({
                apiRequestTimeoutSeconds: clampApiRequestTimeoutSeconds(Number(event.target.value))
              })
            }
            className="w-28 text-xs"
          />
          <span className="text-xs text-muted-foreground">
            {settings.apiRequestTimeoutSeconds === 0
              ? t('general.apiRequestTimeoutNoLimit', { defaultValue: 'No limit' })
              : t('general.apiRequestTimeoutSeconds', {
                  defaultValue: '{{count}} seconds',
                  count: settings.apiRequestTimeoutSeconds
                })}
          </span>
        </div>
        <div className="flex max-w-lg flex-wrap gap-1.5">
          {[0, 30, DEFAULT_API_REQUEST_TIMEOUT_SECONDS, 300, 1800].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => settings.updateSettings({ apiRequestTimeoutSeconds: value })}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                settings.apiRequestTimeoutSeconds === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {value === 0
                ? t('general.apiRequestTimeoutNoLimit', { defaultValue: 'No limit' })
                : `${value}s`}
            </button>
          ))}
        </div>
        <p className="max-w-lg text-xs text-muted-foreground/70">
          {t('general.apiRequestTimeoutHint', {
            defaultValue: 'Default: {{default}} seconds. Applies to all providers.',
            default: DEFAULT_API_REQUEST_TIMEOUT_SECONDS
          })}
        </p>
      </section>

      {/* Provider Max Retries */}
      <section className="space-y-3">
        <div className="max-w-lg">
          <label className="text-sm font-medium text-foreground">
            {t('general.requestMaxRetries', { defaultValue: 'Provider Max Retries' })}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('general.requestMaxRetriesDesc', {
              defaultValue:
                'Retries on rate limits (429) and server errors (5xx). Set 0 to retry indefinitely; retries beyond 10 wait 1 minute each.'
            })}
          </p>
        </div>
        <div className="flex max-w-lg items-center gap-3">
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={settings.requestMaxRetries}
            onChange={(event) =>
              settings.updateSettings({
                requestMaxRetries: clampRequestMaxRetries(Number(event.target.value))
              })
            }
            className="w-28 text-xs"
          />
          <span className="text-xs text-muted-foreground">
            {settings.requestMaxRetries === 0
              ? t('general.requestMaxRetriesNoLimit', { defaultValue: 'Unlimited' })
              : t('general.requestMaxRetriesCount', {
                  defaultValue: '{{count}} attempts',
                  count: settings.requestMaxRetries
                })}
          </span>
        </div>
        <div className="flex max-w-lg flex-wrap gap-1.5">
          {[0, 10, 20, 50].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => settings.updateSettings({ requestMaxRetries: value })}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                settings.requestMaxRetries === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {value === 0
                ? t('general.requestMaxRetriesNoLimit', { defaultValue: 'Unlimited' })
                : `${value}`}
            </button>
          ))}
        </div>
        <p className="max-w-lg text-xs text-muted-foreground/70">
          {t('general.requestMaxRetriesHint', {
            defaultValue: 'Default: 10 attempts. Applies to all providers.',
            default: 10
          })}
        </p>
      </section>

      {/* Context Compression */}
      <section className="space-y-3">
        <div className="flex items-center justify-between max-w-lg">
          <div>
            <div className="text-sm font-medium text-foreground">{t('general.contextCompression.label')}</div>
            <p className="text-xs text-muted-foreground">{t('general.contextCompression.desc')}</p>
          </div>
          <Switch
            checked={settings.contextCompressionEnabled}
            onCheckedChange={(checked) =>
              settings.updateSettings({ contextCompressionEnabled: checked })
            }
          />
        </div>
        {settings.contextCompressionEnabled && (
          <div className="max-w-lg space-y-2">
            <p className="text-xs text-muted-foreground/70">
              {t('general.contextCompression.enabled')}
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium">
                    {t('general.contextCompression.threshold.label')}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t('general.contextCompression.threshold.desc')}
                  </p>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {Math.round(settings.contextCompressionThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={90}
                step={1}
                value={Math.round(settings.contextCompressionThreshold * 100)}
                onChange={(e) => {
                  const ratio = Math.min(0.9, Math.max(0.3, parseInt(e.target.value) / 100))
                  settings.updateSettings({ contextCompressionThreshold: ratio })
                }}
                className="flex-1 max-w-lg accent-primary"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export { RuntimePanel }
