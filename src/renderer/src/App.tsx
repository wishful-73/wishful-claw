import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Toaster } from '@renderer/components/ui/sonner'
import { ThemeProvider } from '@renderer/components/theme-provider'
import { ThemeRuntimeSync } from '@renderer/components/ThemeRuntimeSync'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ConfirmDialogProvider } from '@renderer/components/ui/confirm-dialog'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { initProviderStore } from '@renderer/stores/provider-store'
import { initializeI18n, changeI18nLanguage } from '@renderer/locales'
import { SplashPage } from '@renderer/components/SplashPage'
import { MainLayout } from '@renderer/components/layout/MainLayout'
import { SettingsPage } from '@renderer/components/settings/SettingsPage'
import { attachRendererToolBridge } from '@renderer/lib/ipc/renderer-tool-bridge'
import { registerAllTools, refreshDynamicToolCatalog } from '@renderer/lib/tools'
import { initAppPluginStore, useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { updateAppPluginToolRegistration } from '@renderer/lib/app-plugin'
import { initExtensionStore } from '@renderer/stores/extension-store'
import { refreshExtensionTools } from '@renderer/lib/extensions/extension-tools'
import { fetchToolDefinitions } from '@renderer/lib/tools/tool-cache'
import { useMcpStore } from '@renderer/stores/mcp-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { registerAllViewers } from '@renderer/lib/preview/register-viewers'
import { useChannelAutoReply } from '@renderer/hooks/use-channel-auto-reply'
import { useBackgroundSubAgentWakeup } from '@renderer/hooks/use-background-subagent-wakeup'
import { useAppUpdater } from '@renderer/hooks/use-app-updater'
import { UpdateDialog } from '@renderer/components/updater/UpdateDialog'
import { UpdateProvider } from '@renderer/components/updater/update-context'
import type { UpdateShowDetailsPayload } from '@shared/updater/types'
import { initializeCronRuntime } from '@renderer/lib/tools/cron-runtime'
import { initializeSessionFollowUpRuntime } from '@renderer/lib/tools/session-follow-up-runtime'
import {
  initializeMemoryOrganizationRuntime,
  notifyMemoryOrganizationSettingsChanged
} from '@renderer/lib/agent/memory-organization'
import { agentBridge } from '@renderer/lib/ipc/agent-bridge'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { getAgentStreamReceiver } from '@renderer/lib/ipc/agent-stream-receiver'
import { useActivityStore } from '@renderer/stores/activity-store'

// Initialize provider store — ensures builtin presets exist
initProviderStore()

function App(): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const view = useUIStore((s) => s.view)
  const language = useSettingsStore((s) => s.language)
  const [i18nReady, setI18nReady] = useState(false)
  const [i18nError, setI18nError] = useState<Error | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const updater = useAppUpdater()

  const updatePhase = updater.state.phase

  useEffect(() => {
    // 后台巡检发现的更新只点亮顶栏图标，不弹窗 —— 巡检时用户多半不在跟前，抢焦点比不提示还烦。
    // downloaded / error 仍然直接弹：前者是用户已经开始的下载有结果了，后者是检查或下载失败了。
    if (updatePhase === 'available' && updater.silentAnnounce) return
    if (updatePhase === 'downloaded') {
      // 必须主动说一声：左下角那块常驻浮块已经砍掉，下载完成不再有任何自来的提示。
      toast.success(
        t('updater.toast.downloaded', {
          version: updater.state.downloadedVersion ?? '',
          defaultValue: '更新 {{version}} 已下载，可以重启安装了'
        })
      )
    }
    if (updatePhase === 'error') {
      toast.error(t('updater.toast.error', { defaultValue: '更新失败，点击顶栏图标查看详情。' }))
    }
    if (updatePhase === 'available' || updatePhase === 'downloaded' || updatePhase === 'error') {
      setUpdateDialogOpen(true)
    }
  }, [updatePhase, updater.silentAnnounce, updater.state.downloadedVersion, t])

  // Refresh before opening: a tray click can arrive long after the renderer last heard from Main,
  // and showing a stale phase would be worse than showing nothing.
  const showUpdateDetails = useCallback(async (): Promise<void> => {
    await updater.refreshStatus()
    setUpdateDialogOpen(true)
    // 重查排在开窗之后且不等它：这样「发现有更新却一直没处理」的人这一次能直接跳到最新版，
    // 而不是先盯着一屏旧快照等一次网络往返。
    void updater.recheckLatest()
  }, [updater.refreshStatus, updater.recheckLatest])

  useEffect(() => {
    return window.api.on<UpdateShowDetailsPayload>('update:show-details', () => {
      void showUpdateDetails()
    })
  }, [showUpdateDetails])

  // TitleBar 里的更新图标从 context 取状态：中间隔着 MainLayout，props 透传会把布局组件拖进业务字段。
  const updateContextValue = useMemo(
    () => ({ state: updater.state, showDetails: () => void showUpdateDetails() }),
    [updater.state, showUpdateDetails]
  )

  const handleDownload = useCallback(async (): Promise<void> => {
    // 收起要等用户自己点「后台下载」，不能替他做主：下载在 Main 里本来就继续跑，但点完
    // 「开始下载」直接把窗关掉，等于把「后台下载」那个按钮整个跳过了，也看不到进度。
    await updater.downloadUpdate()
  }, [updater.downloadUpdate])

  // Initialize i18n on mount
  useEffect(() => {
    initializeI18n()
      .then(() => setI18nReady(true))
      .catch((err) => {
        console.error('i18n init failed:', err)
        setI18nError(err)
      })

    // Register renderer bridge and synchronize built-in app plugins after persistence hydration.
    attachRendererToolBridge()
    initAppPluginStore()
    const syncAppPlugins = (): void => updateAppPluginToolRegistration()
    const unsubscribeAppPluginHydration = useAppPluginStore.persist.hasHydrated()
      ? undefined
      : useAppPluginStore.persist.onFinishHydration(syncAppPlugins)
    if (useAppPluginStore.persist.hasHydrated()) syncAppPlugins()
    const unsubscribeAppPluginChanges = useAppPluginStore.subscribe(syncAppPlugins)
    void initExtensionStore().then(() => refreshExtensionTools())

    // Register preview viewers (image, markdown, code, etc.)
    registerAllViewers()

    // Register all tools (fs, search, bash, memory, etc.) for the frontend tool registry
    registerAllTools().catch((err) => {
      console.warn('registerAllTools failed (some tools may not be available):', err)
    })
    // Initialize MCP servers at startup, then refresh the tool catalog
    // so MCP tools (mcp__*__*) get registered in the tool registry.
    // registerAllTools() runs refreshMcpTools() too early — servers aren't
    // connected yet at that point. This chain fills the gap.
    useMcpStore.getState().ensureConversationReady(null)
      .then(() => refreshDynamicToolCatalog())
      .catch((err) => {
        console.warn('MCP initialization failed:', err)
      })
    // Initialize terminal store early — registers SSH exec output listener
    // so Agent SSH commands show in terminal even before user opens the panel
    useTerminalStore.getState().init()

    const receiver = getAgentStreamReceiver()
    receiver.start((envelope) => {
      useActivityStore.getState().handleEnvelope(envelope)
    })
    const disposeCronRuntime = initializeCronRuntime()
    const disposeSessionFollowUpRuntime = initializeSessionFollowUpRuntime()
    const disposeMemoryOrganizationRuntime = initializeMemoryOrganizationRuntime()

    const syncRuntimeSettings = (maxConcurrentSubAgents: number): void => {
      void agentBridge.request('agent/configure-runtime', { maxConcurrentSubAgents }).catch((error) => {
        console.warn('runtime settings sync failed:', error)
      })
    }
    const syncHydratedRuntimeSettings = (): void => {
      syncRuntimeSettings(useSettingsStore.getState().maxConcurrentSubAgents)
    }
    const unsubscribeSettingsHydration = useSettingsStore.persist.hasHydrated()
      ? undefined
      : useSettingsStore.persist.onFinishHydration(syncHydratedRuntimeSettings)
    if (useSettingsStore.persist.hasHydrated()) syncHydratedRuntimeSettings()
    const unsubscribeRuntimeSettings = useSettingsStore.subscribe(
      (state, previous) => {
        if (state.maxConcurrentSubAgents !== previous.maxConcurrentSubAgents) {
          syncRuntimeSettings(state.maxConcurrentSubAgents)
        }
      }
    )
    const unsubscribeOrganizationSettings = useSettingsStore.subscribe(
      (state, previous) => {
        if (
          state.memoryOrganizationEnabled !== previous.memoryOrganizationEnabled ||
          state.memoryOrganizationSchedule !== previous.memoryOrganizationSchedule ||
          state.memoryOrganizationNightlyTime !== previous.memoryOrganizationNightlyTime
        ) {
          notifyMemoryOrganizationSettingsChanged()
        }
      }
    )
    const unsubscribeRuntimeLifecycle = ipcClient.on('sidecar:lifecycle', (payload) => {
      const state = (payload as { state?: string } | undefined)?.state
      if (state === 'reconnected') syncHydratedRuntimeSettings()
    })

    // Pre-fetch tool definitions in background so first message doesn't wait
    fetchToolDefinitions()

    return () => {
      unsubscribeAppPluginChanges()
      unsubscribeAppPluginHydration?.()
      unsubscribeSettingsHydration?.()
      unsubscribeRuntimeSettings()
      unsubscribeOrganizationSettings()
      unsubscribeRuntimeLifecycle()
      disposeCronRuntime()
      disposeSessionFollowUpRuntime()
      disposeMemoryOrganizationRuntime()
    }
  }, [])

  // Mount channel auto-reply listener (plugin:session-task → Agent Loop → reply)
  useChannelAutoReply()

  // Wake an idle main session when a background sub-agent completes, so its
  // report is processed instead of being dropped after the run finalized.
  useBackgroundSubAgentWakeup()

  // Sync language changes
  useEffect(() => {
    if (i18nReady) {
      changeI18nLanguage(language)
    }
  }, [language, i18nReady])

  if (i18nError) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace', fontSize: 14, color: '#f00', whiteSpace: 'pre-wrap' }}>
        <h2>i18n Initialization Error</h2>
        <div>{i18nError.message}</div>
        <div style={{ marginTop: 16, color: '#666' }}>{i18nError.stack}</div>
      </div>
    )
  }

  if (!i18nReady) {
    return null
  }

  return (
    <ThemeProvider defaultTheme="system">
      <ThemeRuntimeSync />
      <ErrorBoundary>
        <TooltipProvider delayDuration={0}>
          <UpdateProvider value={updateContextValue}>
            {view === 'splash' && <SplashPage />}
            {view === 'main' && <MainLayout />}
            {view === 'settings' && <SettingsPage />}
            {/* 浮块没了，toast 重新独占左下角 —— 那个给它让位的 offset 随浮块一起撤掉。 */}
            <Toaster position="bottom-left" theme="system" richColors />
            <UpdateDialog
              state={updater.state}
              open={updateDialogOpen}
              onOpenChange={setUpdateDialogOpen}
              onDownload={handleDownload}
              onInstall={updater.installUpdate}
              onCheck={updater.checkForUpdates}
              onOpenReleasePage={updater.openReleasePage}
            />
            <ConfirmDialogProvider />
          </UpdateProvider>
        </TooltipProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
