import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  isProviderAvailableForModelSelection,
  useProviderStore
} from '@renderer/stores/provider-store'
import type { ReasoningEffortLevel } from '@shared/types/provider'
import type { MemoryOrganizationThinkingMode } from '@renderer/stores/settings-store-types'
import {
  readOrganizationReports,
  type MemoryOrganizationReport
} from '@renderer/lib/agent/memory-organization'
import { SettingsSection, SettingRow, SettingHint } from './settings-primitives'
import MemoryExecutionLogSection from './MemoryExecutionLogSection'
import MemoryEntriesTab from './MemoryEntriesTab'
import MemoryHotTab from './MemoryHotTab'
import { MemoryTiersSection, MemoryRecallSection } from './MemoryTierSettingsSections'

function isTextModel(
  model: { id: string; enabled: boolean; category?: string; type?: string },
  providerType?: string
): boolean {
  const requestType = model.type ?? providerType
  return model.enabled && (!model.category || model.category === 'chat') &&
    requestType !== 'openai-images' && requestType !== 'seedance-video' && requestType !== 'xai-video'
}

function getFirstEnabledModelId(provider: {
  defaultModel?: string
  type?: string
  models: Array<{ id: string; enabled: boolean; category?: string; type?: string }>
}): string {
  if (provider.defaultModel && provider.models.some((model) => isTextModel(model, provider.type) && model.id === provider.defaultModel)) {
    return provider.defaultModel
  }
  return provider.models.find((model) => isTextModel(model, provider.type))?.id ?? ''
}

const MEMORY_PAGE_TABS = ['settings', 'hot', 'entries', 'log'] as const

type MemoryPageTab = (typeof MEMORY_PAGE_TABS)[number]

/**
 * Inner tab bar for the memory page (iter-33 S-90). Mirrors ProviderPanelTabs rather than sharing
 * one: components/ui has no tab primitive, and the two differ in icon usage, so copying the shape
 * keeps each panel readable.
 */
function MemoryPageTabs({
  activeTab,
  onChange
}: {
  activeTab: MemoryPageTab
  onChange: (tab: MemoryPageTab) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const labels: Record<MemoryPageTab, string> = {
    settings: t('memoryPage.tabs.settings'),
    hot: t('memoryPage.tabs.hot'),
    entries: t('memoryPage.tabs.entries'),
    log: t('memoryPage.tabs.executionLog')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % MEMORY_PAGE_TABS.length
        : (index - 1 + MEMORY_PAGE_TABS.length) % MEMORY_PAGE_TABS.length
    onChange(MEMORY_PAGE_TABS[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={t('memoryPage.tabs.label')}
      className="flex w-fit shrink-0 items-center gap-1 rounded-lg border bg-muted/50 p-1"
    >
      {MEMORY_PAGE_TABS.map((tab, index) => (
        <button
          key={tab}
          ref={(element) => { tabRefs.current[index] = element }}
          type="button"
          role="tab"
          id={`memory-page-tab-${tab}`}
          aria-controls={`memory-page-tabpanel-${tab}`}
          aria-selected={activeTab === tab}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors',
            activeTab === tab
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
          )}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
  )
}

function MemorySettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()
  const providers = useProviderStore((state) => state.providers)
  const selectableProviders = useMemo(
    () => providers.filter(
      (provider) =>
        isProviderAvailableForModelSelection(provider) &&
        provider.models.some((model) => isTextModel(model, provider.type))
    ),
    [providers]
  )
  const selectedOrganizationProvider = selectableProviders.find(
    (provider) => provider.id === settings.memoryOrganizationModel?.providerId
  )
  const selectedOrganizationModel = selectedOrganizationProvider?.models.find(
    (model) => model.id === settings.memoryOrganizationModel?.modelId &&
      isTextModel(model, selectedOrganizationProvider?.type)
  )
  const organizationThinkingConfig = selectedOrganizationModel?.thinkingConfig
  const reasoningEffortLevels = organizationThinkingConfig?.reasoningEffortLevels?.filter(
    (level) => level !== 'none' && level !== 'ultra'
  ) ?? []

  const [activeTab, setActiveTab] = useState<MemoryPageTab>('settings')
  const [organizationReports, setOrganizationReports] = useState<MemoryOrganizationReport[]>([])
  useEffect(() => {
    let cancelled = false
    void readOrganizationReports().then((reports) => {
      if (!cancelled) setOrganizationReports(reports)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-8 pb-16 pt-10">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold">{t('memoryPage.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('memoryPage.subtitle')}</p>
      </div>

      <MemoryPageTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'settings' && (
        <div
          role="tabpanel"
          id="memory-page-tabpanel-settings"
          aria-labelledby="memory-page-tab-settings"
          className="space-y-4"
        >
        {/* Auto organization */}
        <SettingsSection
          id="sec-memory-organization"
          title={t('memoryPage.organization.title')}
          description={t('memoryPage.organization.desc')}
          actions={
            <Switch
              checked={settings.memoryOrganizationEnabled}
              onCheckedChange={(checked) => settings.updateSettings({ memoryOrganizationEnabled: checked })}
            />
          }
        >
          {!settings.memoryOrganizationEnabled ? (
            <SettingHint>{t('memoryPage.organization.disabledHint')}</SettingHint>
          ) : (
            <>
              <SettingRow
                label={t('memoryPage.organization.schedule.label')}
                description={t('memoryPage.organization.schedule.desc')}
              >
                <div className="flex flex-wrap gap-1.5">
                  {(['nightly', 'startup'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => settings.updateSettings({ memoryOrganizationSchedule: mode })}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                        settings.memoryOrganizationSchedule === mode
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      {t(`memoryPage.organization.schedule.${mode}`)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              {settings.memoryOrganizationSchedule === 'nightly' ? (
                <SettingRow
                  label={t('memoryPage.organization.time.label')}
                  description={t('memoryPage.organization.time.desc')}
                  control={
                    <Input
                      type="time"
                      value={settings.memoryOrganizationNightlyTime}
                      onChange={(event) => {
                        const next = event.target.value
                        if (/^\d{2}:\d{2}$/.test(next)) {
                          settings.updateSettings({ memoryOrganizationNightlyTime: next })
                        }
                      }}
                      className="w-28 text-xs"
                    />
                  }
                />
              ) : (
                <SettingHint>{t('memoryPage.organization.startupHint')}</SettingHint>
              )}
              <SettingRow
                label={t('memoryPage.organization.model.label')}
                description={t('memoryPage.organization.model.desc')}
              >
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    value={settings.memoryOrganizationModel?.providerId ?? ''}
                    onValueChange={(providerId) => {
                      const provider = selectableProviders.find((candidate) => candidate.id === providerId)
                      const modelId = provider ? getFirstEnabledModelId(provider) : ''
                      settings.updateSettings({
                        memoryOrganizationModel: provider && modelId ? { providerId, modelId } : null,
                        memoryOrganizationThinkingMode: 'default',
                        memoryOrganizationReasoningEffort: ''
                      })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('memoryPage.organization.model.providerPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={settings.memoryOrganizationModel?.modelId ?? ''}
                    onValueChange={(modelId) => {
                      const providerId = settings.memoryOrganizationModel?.providerId
                      if (!providerId) return
                      settings.updateSettings({
                        memoryOrganizationModel: { providerId, modelId },
                        memoryOrganizationThinkingMode: 'default',
                        memoryOrganizationReasoningEffort: ''
                      })
                    }}
                    disabled={!selectedOrganizationProvider}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('memoryPage.organization.model.modelPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedOrganizationProvider?.models.filter(
                        (model) => isTextModel(model, selectedOrganizationProvider.type)
                      ).map((model) => (
                        <SelectItem key={model.id} value={model.id}>{model.name || model.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </SettingRow>
              {organizationThinkingConfig ? (
                <SettingRow
                  label={t('memoryPage.organization.thinking.label')}
                  description={t('memoryPage.organization.thinking.desc')}
                  control={
                    <Select
                      value={settings.memoryOrganizationThinkingMode}
                      onValueChange={(selection) => settings.updateSettings({
                        memoryOrganizationThinkingMode: selection as MemoryOrganizationThinkingMode,
                        memoryOrganizationReasoningEffort: ''
                      })}
                    >
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t('memoryPage.organization.thinking.default')}</SelectItem>
                        <SelectItem value="disabled">{t('memoryPage.organization.thinking.disabled')}</SelectItem>
                        <SelectItem value="enabled">{t('memoryPage.organization.thinking.enabled')}</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
              ) : null}
              {organizationThinkingConfig &&
              settings.memoryOrganizationThinkingMode === 'enabled' &&
              reasoningEffortLevels.length > 0 ? (
                <SettingRow
                  label={t('memoryPage.organization.thinking.effortLabel')}
                  description={t('memoryPage.organization.thinking.effortDesc')}
                  control={
                    <Select
                      value={settings.memoryOrganizationReasoningEffort || 'default'}
                      onValueChange={(selection) => settings.updateSettings({
                        memoryOrganizationReasoningEffort: selection === 'default'
                          ? ''
                          : selection as ReasoningEffortLevel
                      })}
                    >
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t('memoryPage.organization.thinking.effortDefault')}</SelectItem>
                        {reasoningEffortLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            {t(`memoryPage.organization.thinking.effort.${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              ) : null}
            </>
          )}
        </SettingsSection>

        {/* Tier thresholds */}
        <MemoryTiersSection />

        {/* Recall */}
        <MemoryRecallSection />

        </div>
      )}

      {activeTab === 'hot' && (
        <div
          role="tabpanel"
          id="memory-page-tabpanel-hot"
          aria-labelledby="memory-page-tab-hot"
          className="space-y-4"
        >
          <MemoryHotTab />
        </div>
      )}

      {activeTab === 'entries' && (
        <div
          role="tabpanel"
          id="memory-page-tabpanel-entries"
          aria-labelledby="memory-page-tab-entries"
          className="space-y-4"
        >
          <MemoryEntriesTab />
        </div>
      )}

      {activeTab === 'log' && (
        <div
          role="tabpanel"
          id="memory-page-tabpanel-log"
          aria-labelledby="memory-page-tab-log"
          className="space-y-4"
        >
          <MemoryExecutionLogSection reports={organizationReports} />
        </div>
      )}
    </div>
  )
}

export { MemorySettingsPanel }
