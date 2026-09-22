import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  useSettingsStore,
  clampApiRequestTimeoutSeconds,
  DEFAULT_API_REQUEST_TIMEOUT_SECONDS,
  clampRequestMaxRetries,
  MIN_API_REQUEST_TIMEOUT_SECONDS,
  MAX_API_REQUEST_TIMEOUT_SECONDS,
  clampMaxResidentTurns,
  MIN_MAX_RESIDENT_TURNS,
  MAX_MAX_RESIDENT_TURNS,
  clampGlobalContextCapTokens,
  MIN_GLOBAL_CONTEXT_CAP_TOKENS,
  MAX_GLOBAL_CONTEXT_CAP_TOKENS,
  GLOBAL_CONTEXT_CAP_STEP_TOKENS
} from '@renderer/stores/settings-store'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Slider } from '@renderer/components/ui/slider'
import { SettingsSection, SettingRow, SettingHint } from './settings-primitives'
import { ProjectsParentDirectorySection } from './ProjectsParentDirectorySection'

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

  const handleLaunchAtLoginChange = async (checked: boolean): Promise<void> => {
    setLaunchAtLoginChecked(checked)
    try {
      // The handler returns the actual OS state after applying the change —
      // the switch must mirror that, not the optimistic value.
      const osEnabled = await window.api.invoke<boolean>('app:set-login-item-settings', checked)
      if (osEnabled !== checked) {
        setLaunchAtLoginChecked(osEnabled)
        settings.updateSettings({ launchAtLogin: osEnabled })
      } else {
        settings.updateSettings({ launchAtLogin: checked })
      }
    } catch {
      // Apply failed — revert to the last known OS state.
      setLaunchAtLoginChecked(!checked)
      settings.updateSettings({ launchAtLogin: !checked })
    }
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

      {/* Sandbox（iter-32 S-79） */}
      <SettingsSection
        id="sec-runtime-sandbox"
        title={t('general.sandbox.label')}
        description={t('general.sandbox.desc')}
        actions={
          <Switch
            checked={settings.sandboxEnabled}
            onCheckedChange={(checked) => settings.updateSettings({ sandboxEnabled: checked })}
          />
        }
      >
        <SettingHint>{t('general.sandbox.hint')}</SettingHint>
      </SettingsSection>

      {/* Projects parent directory（iter-33 S-103） */}
      <ProjectsParentDirectorySection />

      {/* Session Defaults */}
      <SettingsSection
        id="sec-runtime-session-defaults"
        title={t('runtimePage.sessionDefaults.title')}
        description={t('runtimePage.sessionDefaults.desc')}
      >
        <SettingRow
          label={t('runtimePage.sessionDefaults.collaboration.label')}
          description={t('runtimePage.sessionDefaults.collaboration.desc')}
          control={
            <div className="flex gap-1.5">
              {(['chat', 'cowork'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => settings.updateSettings({ projectSessionDefaultCollaborationMode: value })}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                    settings.projectSessionDefaultCollaborationMode === value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {t(`runtimePage.sessionDefaults.collaboration.${value}`)}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          label={t('runtimePage.sessionDefaults.permission.label')}
          description={t('runtimePage.sessionDefaults.permission.desc')}
          control={
            <div className="flex gap-1.5">
              {(['default', 'fullAccess'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => settings.updateSettings({ coworkDefaultPermissionMode: value })}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                    settings.coworkDefaultPermissionMode === value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {t(`runtimePage.sessionDefaults.permission.${value}`)}
                </button>
              ))}
            </div>
          }
        />
        <SettingHint>{t('runtimePage.sessionDefaults.hint')}</SettingHint>
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

            {/* S-107：全局「请求上下文上限」。存的是绝对 token 数，0 = 不限制。
                量纲就必须是 token，不能换算成比例 —— 上限是按模型窗口来设的，
                换算成百分比会随模型漂移。会话级覆盖见 context-ring 面板。 */}
            <div className="space-y-2 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-medium">
                    {t('general.contextCompression.contextCap.label')}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t('general.contextCompression.contextCap.desc')}
                  </p>
                </div>
                <Input
                  type="number"
                  min={MIN_GLOBAL_CONTEXT_CAP_TOKENS}
                  max={MAX_GLOBAL_CONTEXT_CAP_TOKENS}
                  step={GLOBAL_CONTEXT_CAP_STEP_TOKENS}
                  value={settings.contextCapTokens}
                  onChange={(event) =>
                    settings.updateSettings({
                      contextCapTokens: clampGlobalContextCapTokens(Number(event.target.value))
                    })
                  }
                  className="w-28 text-xs"
                />
              </div>
              <SettingHint>
                {t('general.contextCompression.contextCap.hint')}
              </SettingHint>
            </div>
          </>
        )}
      </SettingsSection>

      {/* T-3: Chat window in-memory turn window */}
      <SettingsSection
        id="sec-runtime-resident-turns"
        title={t('runtimePage.residentTurns.title')}
        description={t('runtimePage.residentTurns.desc')}
      >
        <SettingRow
          label={t('runtimePage.residentTurns.label')}
          description={t('runtimePage.residentTurns.hint')}
          control={
            <Input
              type="number"
              min={MIN_MAX_RESIDENT_TURNS}
              max={MAX_MAX_RESIDENT_TURNS}
              step={1}
              value={settings.maxResidentTurns}
              onChange={(event) =>
                settings.updateSettings({
                  maxResidentTurns: clampMaxResidentTurns(Number(event.target.value))
                })
              }
              className="w-20 text-xs"
            />
          }
        >
          <Slider
            min={MIN_MAX_RESIDENT_TURNS}
            max={MAX_MAX_RESIDENT_TURNS}
            step={1}
            value={[settings.maxResidentTurns]}
            onValueChange={([v]) => settings.updateSettings({ maxResidentTurns: v })}
          />
        </SettingRow>
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
