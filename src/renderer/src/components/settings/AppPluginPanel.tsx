import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@renderer/components/ui/switch'
import { Separator } from '@renderer/components/ui/separator'
import {
  isProviderAvailableForModelSelection,
  useProviderStore
} from '@renderer/stores/provider-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { resolvePluginsForProject, useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import {
  APP_PLUGIN_DESCRIPTORS,
  BROWSER_PLUGIN_ID,
  CODEGRAPH_PLUGIN_ID,
  IMAGE_PLUGIN_ID,
  type AppPluginId
} from '@renderer/lib/app-plugin/types'
import { createFallbackPlugin, getPluginIcon, getPluginState } from './app-plugin/meta'
import type { BrowserEmulationStatus, CgAssetStatus } from './app-plugin/types'
import { PluginList } from './app-plugin/plugin-list'
import { ModelSourceSection } from './app-plugin/model-source'
import { CodegraphAssetSection } from './app-plugin/codegraph-asset-section'
import { BrowserPluginSection } from './app-plugin/browser-plugin-section'
import { ToolStatusSection } from './app-plugin/tool-status-section'

export function AppPluginPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [selectedPluginId, setSelectedPluginId] = useState<AppPluginId>(IMAGE_PLUGIN_ID)
  const [clearingCookies, setClearingCookies] = useState(false)
  const [importingCookies, setImportingCookies] = useState(false)
  const [codegraphAsset, setCodegraphAsset] = useState<CgAssetStatus | null>(null)
  const [browserEmulationStatus, setBrowserEmulationStatus] =
    useState<BrowserEmulationStatus | null>(null)
  const [pluginStoreHydrated, setPluginStoreHydrated] = useState(() =>
    useAppPluginStore.persist.hasHydrated()
  )
  const activeProjectId = useChatStore((state) => state.activeProjectId)
  const pluginsByProject = useAppPluginStore((state) => state.pluginsByProject)
  const updatePlugin = useAppPluginStore((state) => state.updatePlugin)
  const togglePluginEnabled = useAppPluginStore((state) => state.togglePluginEnabled)
  const browserUserDataReuseEnabled = useSettingsStore((state) => state.browserUserDataReuseEnabled)
  const browserUserDataSource = useSettingsStore((state) => state.browserUserDataSource)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const providers = useProviderStore((state) => state.providers)
  const activeImageProviderId = useProviderStore((state) => state.activeImageProviderId)
  const activeImageModelId = useProviderStore((state) => state.activeImageModelId)

  useEffect(() => {
    if (useAppPluginStore.persist.hasHydrated()) return
    return useAppPluginStore.persist.onFinishHydration(() => setPluginStoreHydrated(true))
  }, [])

  const imageProviderGroups = useMemo(
    () =>
      providers
        .filter((provider) => isProviderAvailableForModelSelection(provider))
        .map((provider) => ({
          provider,
          models: provider.models.filter((model) => model.enabled && model.category === 'image')
        }))
        .filter((entry) => entry.models.length > 0),
    [providers]
  )

  const projectPlugins = useMemo(
    () => resolvePluginsForProject(pluginsByProject, activeProjectId),
    [activeProjectId, pluginsByProject]
  )
  const visibleDescriptors = useMemo(() => APP_PLUGIN_DESCRIPTORS.filter((d) => !d.hidden), [])
  const selectedPlugin = useMemo(
    () =>
      projectPlugins.find((plugin) => plugin.id === selectedPluginId) ??
      createFallbackPlugin(selectedPluginId),
    [projectPlugins, selectedPluginId]
  )
  const selectedDescriptor =
    visibleDescriptors.find((descriptor) => descriptor.id === selectedPluginId) ??
    visibleDescriptors[0] ??
    null
  const resolvedProviderId = selectedPlugin?.useGlobalModel
    ? activeImageProviderId
    : (selectedPlugin?.providerId ?? null)
  const resolvedModelId = selectedPlugin?.useGlobalModel
    ? activeImageModelId
    : (selectedPlugin?.modelId ?? null)
  const resolvedProviderEntry = imageProviderGroups.find(
    (entry) => entry.provider.id === resolvedProviderId
  )
  const isResolvedImageModelReady = Boolean(
    resolvedProviderEntry?.models.some((model) => model.id === resolvedModelId)
  )
  const activeState = getPluginState({
    descriptor:
      selectedDescriptor ??
      visibleDescriptors.find((descriptor) => descriptor.id === IMAGE_PLUGIN_ID) ??
      visibleDescriptors[0],
    pluginEnabled: Boolean(selectedPlugin?.enabled),
    isResolvedImageModelReady,
    isCodeGraphReady: Boolean(codegraphAsset?.runtimeReady ?? codegraphAsset?.ready)
  })

  useEffect(() => {
    let cancelled = false

    async function loadBrowserEmulationStatus(): Promise<void> {
      try {
        const result = (await ipcClient.invoke(IPC.BROWSER_EMULATION_STATUS)) as
          | { success: true; status: BrowserEmulationStatus }
          | { success: false; error?: string }
        if (!cancelled && result.success) {
          setBrowserEmulationStatus(result.status)
        }
      } catch {
        if (!cancelled) setBrowserEmulationStatus(null)
      }
    }

    void loadBrowserEmulationStatus()
    return () => {
      cancelled = true
    }
  }, [browserUserDataReuseEnabled, browserUserDataSource])

  const handleClearBrowserCookies = async (): Promise<void> => {
    setClearingCookies(true)
    try {
      const result = (await ipcClient.invoke(IPC.BROWSER_CLEAR_COOKIES)) as
        | { success: true }
        | { success: false; error?: string }
      if (result.success) {
        toast.success(t('plugin.browser.cookiesCleared'))
      } else {
        toast.error(t('plugin.browser.cookiesClearFailed'), { description: result.error })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('plugin.browser.cookiesClearFailed'), { description: message })
    } finally {
      setClearingCookies(false)
    }
  }

  const handleImportBrowserCookies = async (): Promise<void> => {
    setImportingCookies(true)
    try {
      const result = (await ipcClient.invoke(IPC.BROWSER_IMPORT_COOKIES, {
        source: browserUserDataSource
      })) as
        | {
            success: true
            result: { browserName: string; imported: number; skipped: number; failed: number }
          }
        | { success: false; error?: string }
      if (result.success) {
        toast.success(
          t('plugin.browser.cookiesImported', {
            browserName: result.result.browserName,
            imported: result.result.imported,
            skipped: result.result.skipped
          })
        )
      } else {
        toast.error(t('plugin.browser.cookiesImportFailed'), { description: result.error })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('plugin.browser.cookiesImportFailed'), { description: message })
    } finally {
      setImportingCookies(false)
    }
  }

  const refreshCodegraphAsset = async (): Promise<void> => {
    try {
      const status = (await ipcClient.invoke(IPC.CODEGRAPH_ASSET_STATUS)) as CgAssetStatus
      setCodegraphAsset(status)
    } catch {
      setCodegraphAsset(null)
    }
  }

  useEffect(() => {
    if (selectedPluginId !== CODEGRAPH_PLUGIN_ID) return
    void refreshCodegraphAsset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPluginId])

  const handlePluginEnabledChange = (checked: boolean): void => {
    if (!pluginStoreHydrated || !selectedPlugin || checked === selectedPlugin.enabled) return
    togglePluginEnabled(selectedPlugin.id, activeProjectId)
  }

  return (
    <div className="flex h-full min-h-0 gap-6">
      <div className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/20 p-3">
        <div className="px-2 pb-3">
          <h2 className="text-lg font-semibold">{t('plugin.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('plugin.subtitle')}</p>
        </div>
        <PluginList
          visibleDescriptors={visibleDescriptors}
          projectPlugins={projectPlugins}
          selectedPluginId={selectedPluginId}
          onSelect={setSelectedPluginId}
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border bg-background p-6">
        {selectedPlugin && selectedDescriptor ? (
          <div className="space-y-6">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="rounded-lg border bg-muted/40 p-2 text-muted-foreground">
                  {getPluginIcon(selectedPlugin.id)}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">
                    {t(`plugin.items.${selectedPlugin.id}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`plugin.items.${selectedPlugin.id}.description`)}
                  </p>
                </div>
              </div>
            </div>

            <section className="rounded-xl border bg-muted/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t('plugin.enable')}</p>
                  <p className="text-xs text-muted-foreground">{t('plugin.enableDesc')}</p>
                </div>
                <Switch
                  checked={selectedPlugin.enabled}
                  disabled={!pluginStoreHydrated}
                  onCheckedChange={handlePluginEnabledChange}
                />
              </div>
            </section>

            {selectedDescriptor.requiresModelConfig ? (
              <ModelSourceSection
                selectedPlugin={selectedPlugin}
                imageProviderGroups={imageProviderGroups}
                activeImageProviderId={activeImageProviderId}
                activeImageModelId={activeImageModelId}
                updatePlugin={updatePlugin}
              />
            ) : null}

            {selectedDescriptor.id === CODEGRAPH_PLUGIN_ID ? (
              <CodegraphAssetSection codegraphAsset={codegraphAsset} />
            ) : null}

            {selectedPlugin.id === BROWSER_PLUGIN_ID ? (
              <BrowserPluginSection
                selectedPlugin={selectedPlugin}
                browserUserDataReuseEnabled={browserUserDataReuseEnabled}
                browserUserDataSource={browserUserDataSource}
                browserEmulationStatus={browserEmulationStatus}
                clearingCookies={clearingCookies}
                importingCookies={importingCookies}
                onClearCookies={() => void handleClearBrowserCookies()}
                onImportCookies={() => void handleImportBrowserCookies()}
                updateSettings={updateSettings}
                updatePlugin={updatePlugin}
              />
            ) : null}

            <ToolStatusSection
              selectedDescriptor={selectedDescriptor}
              selectedPluginId={selectedPluginId}
              activeState={activeState}
            />

            <Separator />

            <section className="space-y-2">
              <p className="text-sm font-medium">
                {t(`plugin.items.${selectedPlugin.id}.promptTitle`)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`plugin.items.${selectedPlugin.id}.promptDesc`)}
              </p>
            </section>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('plugin.selectPlugin')}
          </div>
        )}
      </div>
    </div>
  )
}
