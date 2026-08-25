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
import { Slider } from '@renderer/components/ui/slider'
import { SettingsSection, SettingRow, SettingHint } from './settings-primitives'

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
    <div className="mx-auto max-w-4xl space-y-4 px-8 pb-16 pt-10">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold">{t('runtimePage.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('runtimePage.subtitle')}
        </p>
      </div>

      {/* Launch at Login */}
      <SettingsSection
        id="sec-runtime-autostart"
        title={t('general.launchAtLogin.label')}
        description={t('general.launchAtLogin.desc')}
        actions={
          <Switch
            checked={launchAtLoginChecked}
            onCheckedChange={handleLaunchAtLoginChange}
          />
        }
      >
        <SettingHint>
          {launchAtLoginChecked
            ? t('general.launchAtLogin.enabled')
            : t('general.launchAtLogin.disabled')}
        </SettingHint>
      </SettingsSection>

      {/* Developer Mode */}
      <SettingsSection
        id="sec-runtime-devmode"
        title={t('general.developerMode.label')}
        description={t('general.developerMode.desc')}
        actions={
          <Switch
            checked={settings.devMode}
            onCheckedChange={(checked) => settings.updateSettings({ devMode: checked })}
          />
        }
      >
        <SettingHint>
          {settings.devMode ? t('general.developerMode.enabled') : t('general.developerMode.disabled')}
        </SettingHint>
      </SettingsSection>

      {/* API Request Timeout */}
      <SettingsSection
        id="sec-runtime-timeout"
        title={t('general.apiRequestTimeout')}
        description={t('general.apiRequestTimeoutDesc')}
      >
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
              ? t('general.apiRequestTimeoutNoLimit')
              : t('general.apiRequestTimeoutSeconds', {
                  count: settings.apiRequestTimeoutSeconds
                })}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
              {value === 0 ? t('general.apiRequestTimeoutNoLimit') : `${value}s`}
            </button>
          ))}
        </div>
        <SettingHint>
          {t('general.apiRequestTimeoutHint', { default: DEFAULT_API_REQUEST_TIMEOUT_SECONDS })}
        </SettingHint>
      </SettingsSection>

      {/* Provider Max Retries */}
      <SettingsSection
        id="sec-runtime-retries"
        title={t('general.requestMaxRetries')}
        description={t('general.requestMaxRetriesDesc')}
      >
        <div className="flex items-center gap-3">
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
              ? t('general.requestMaxRetriesNoLimit')
              : t('general.requestMaxRetriesCount', { count: settings.requestMaxRetries })}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
              {value === 0 ? t('general.requestMaxRetriesNoLimit') : `${value}`}
            </button>
          ))}
        </div>
        <SettingHint>{t('general.requestMaxRetriesHint')}</SettingHint>
      </SettingsSection>

      {/* Context Compression */}
      <SettingsSection
        id="sec-runtime-compression"
        title={t('general.contextCompression.label')}
        description={t('general.contextCompression.desc')}
        actions={
          <Switch
            checked={settings.contextCompressionEnabled}
            onCheckedChange={(checked) =>
              settings.updateSettings({ contextCompressionEnabled: checked })
            }
          />
        }
      >
        {settings.contextCompressionEnabled && (
          <>
            <SettingHint>{t('general.contextCompression.enabled')}</SettingHint>
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
              <Slider
                min={30}
                max={90}
                step={1}
                value={[Math.round(settings.contextCompressionThreshold * 100)]}
                onValueChange={([v]) => {
                  const ratio = Math.min(0.9, Math.max(0.3, v / 100))
                  settings.updateSettings({ contextCompressionThreshold: ratio })
                }}
              />
            </div>
          </>
        )}
      </SettingsSection>

      {/* Tool Execution */}
      <SettingsSection
        id="sec-runtime-tools"
        title={t('general.toolExecution.label')}
        description={t('general.toolExecution.desc')}
      >
        {/* Max Parallel Tools */}
        <SettingRow
          label={t('general.toolExecution.maxParallel.label')}
          description={t('general.toolExecution.maxParallel.desc')}
          control={
            <Input
              type="number"
              min={1}
              max={16}
              value={settings.maxParallelToolCalls}
              onChange={(e) => {
                const next = Math.min(16, Math.max(1, parseInt(e.target.value, 10) || 8))
                settings.updateSettings({ maxParallelToolCalls: next })
              }}
              className="w-20 text-xs"
            />
          }
        >
          <Slider
            min={1}
            max={16}
            step={1}
            value={[settings.maxParallelToolCalls]}
            onValueChange={([v]) => settings.updateSettings({ maxParallelToolCalls: v })}
          />
        </SettingRow>

        {/* Max Tool Calls Per Turn */}
        <SettingRow
          label={t('general.toolExecution.maxPerTurn.label')}
          description={t('general.toolExecution.maxPerTurn.desc')}
          control={
            <Input
              type="number"
              min={1}
              max={100}
              value={settings.maxToolCallsPerTurn}
              onChange={(e) => {
                const next = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 20))
                settings.updateSettings({ maxToolCallsPerTurn: next })
              }}
              className="w-20 text-xs"
            />
          }
        >
          <Slider
            min={1}
            max={100}
            step={1}
            value={[settings.maxToolCallsPerTurn]}
            onValueChange={([v]) => settings.updateSettings({ maxToolCallsPerTurn: v })}
          />
        </SettingRow>

        {/* Max Concurrent Sub-Agents */}
        <SettingRow
          label={t('general.toolExecution.maxSubAgents.label')}
          description={t('general.toolExecution.maxSubAgents.desc')}
          control={
            <Input
              type="number"
              min={1}
              max={8}
              value={settings.maxConcurrentSubAgents}
              onChange={(e) => {
                const next = Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 2))
                settings.updateSettings({ maxConcurrentSubAgents: next })
              }}
              className="w-20 text-xs"
            />
          }
        >
          <Slider
            min={1}
            max={8}
            step={1}
            value={[settings.maxConcurrentSubAgents]}
            onValueChange={([v]) => settings.updateSettings({ maxConcurrentSubAgents: v })}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )
}

export { RuntimePanel }
