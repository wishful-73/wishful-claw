import { useState, useEffect } from 'react'
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

  // -- Launch at Login --
  const [launchAtLoginChecked, setLaunchAtLoginChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.invoke<boolean>('app:get-login-item-settings', null).then((osEnabled) => {
      if (cancelled) return
      setLaunchAtLoginChecked(osEnabled)
      if (osEnabled !== settings.launchAtLogin) {
        settings.updateSettings({ launchAtLogin: osEnabled })
      }
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLaunchAtLoginChange = (checked: boolean): void => {
    setLaunchAtLoginChecked(checked)
    settings.updateSettings({ launchAtLogin: checked })
    void window.api.invoke<boolean>('app:set-login-item-settings', checked)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 pb-16 pt-10">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold">{t('runtimePage.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('runtimePage.subtitle')}
        </p>
      </div>

      {/* API Request Timeout */}
      <section id="sec-runtime-timeout" className="space-y-3">
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
      <section id="sec-runtime-retries" className="space-y-3">
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
      <section id="sec-runtime-compression" className="space-y-3">
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
      {/* Tool Execution */}
      <section id="sec-runtime-tools" className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('general.toolExecution.label')}</label>
          <p className="text-xs text-muted-foreground">{t('general.toolExecution.desc')}</p>
        </div>

        {/* Max Parallel Tools */}
        <div className="space-y-2">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <label className="text-xs font-medium">{t('general.toolExecution.maxParallel.label')}</label>
              <p className="text-xs text-muted-foreground">{t('general.toolExecution.maxParallel.desc')}</p>
            </div>
            <span className="text-xs text-muted-foreground">{settings.maxParallelToolCalls}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={settings.maxParallelToolCalls}
              onChange={(e) => settings.updateSettings({ maxParallelToolCalls: parseInt(e.target.value) })}
              className="flex-1 max-w-lg accent-primary"
            />
            <Input
              type="number"
              min={1}
              max={16}
              value={settings.maxParallelToolCalls}
              onChange={(e) => {
                const next = Math.min(16, Math.max(1, parseInt(e.target.value, 10) || 8))
                settings.updateSettings({ maxParallelToolCalls: next })
              }}
              className="max-w-24 text-xs"
            />
          </div>
        </div>

        {/* Max Tool Calls Per Turn */}
        <div className="space-y-2">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <label className="text-xs font-medium">{t('general.toolExecution.maxPerTurn.label')}</label>
              <p className="text-xs text-muted-foreground">{t('general.toolExecution.maxPerTurn.desc')}</p>
            </div>
            <span className="text-xs text-muted-foreground">{settings.maxToolCallsPerTurn}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={settings.maxToolCallsPerTurn}
              onChange={(e) => settings.updateSettings({ maxToolCallsPerTurn: parseInt(e.target.value) })}
              className="flex-1 max-w-lg accent-primary"
            />
            <Input
              type="number"
              min={1}
              max={100}
              value={settings.maxToolCallsPerTurn}
              onChange={(e) => {
                const next = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 20))
                settings.updateSettings({ maxToolCallsPerTurn: next })
              }}
              className="max-w-24 text-xs"
            />
          </div>
        </div>

        {/* Max Concurrent Sub-Agents */}
        <div className="space-y-2">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <label className="text-xs font-medium">{t('general.toolExecution.maxSubAgents.label')}</label>
              <p className="text-xs text-muted-foreground">{t('general.toolExecution.maxSubAgents.desc')}</p>
            </div>
            <span className="text-xs text-muted-foreground">{settings.maxConcurrentSubAgents}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={settings.maxConcurrentSubAgents}
              onChange={(e) => settings.updateSettings({ maxConcurrentSubAgents: parseInt(e.target.value) })}
              className="flex-1 max-w-lg accent-primary"
            />
            <Input
              type="number"
              min={1}
              max={8}
              value={settings.maxConcurrentSubAgents}
              onChange={(e) => {
                const next = Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 2))
                settings.updateSettings({ maxConcurrentSubAgents: next })
              }}
              className="max-w-24 text-xs"
            />
          </div>
        </div>
      </section>

      {/* Developer Mode */}
      <section id="sec-runtime-devmode" className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">{t('general.developerMode.label')}</div>
          <p className="text-xs text-muted-foreground">{t('general.developerMode.desc')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.devMode}
            onCheckedChange={(checked) => settings.updateSettings({ devMode: checked })}
          />
          <span className="text-xs text-muted-foreground">
            {settings.devMode ? t('general.developerMode.enabled') : t('general.developerMode.disabled')}
          </span>
        </div>
      </section>
      {/* Launch at Login */}
      <section id="sec-runtime-autostart" className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">{t('general.launchAtLogin.label', { defaultValue: 'Launch at Startup' })}</div>
          <p className="text-xs text-muted-foreground">{t('general.launchAtLogin.desc', { defaultValue: 'Automatically start WishfulClaw when you log in to your computer' })}</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={launchAtLoginChecked}
            onCheckedChange={handleLaunchAtLoginChange}
          />
          <span className="text-xs text-muted-foreground">
            {launchAtLoginChecked
              ? t('general.launchAtLogin.enabled', { defaultValue: 'Enabled' })
              : t('general.launchAtLogin.disabled', { defaultValue: 'Disabled' })}
          </span>
        </div>
      </section>
    </div>
  )
}

export { RuntimePanel }
