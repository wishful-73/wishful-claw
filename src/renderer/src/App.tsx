import { useState, useEffect } from 'react'
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
import { initializeCronRuntime } from '@renderer/lib/tools/cron-runtime'
import { agentBridge } from '@renderer/lib/ipc/agent-bridge'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { getAgentStreamReceiver } from '@renderer/lib/ipc/agent-stream-receiver'
import { useActivityStore } from '@renderer/stores/activity-store'

// Initialize provider store — ensures builtin presets exist
initProviderStore()

function App(): React.JSX.Element | null {
  const view = useUIStore((s) => s.view)
  const language = useSettingsStore((s) => s.language)
  const [i18nReady, setI18nReady] = useState(false)
  const [i18nError, setI18nError] = useState<Error | null>(null)

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
    const unsubscribeRuntimeLifecycle = ipcClient.on('sidecar:lifecycle', (payload) => {
      const state = (payload as { state?: string } | undefined)?.state
      if (state === 'reconnected') syncHydratedRuntimeSettings()
    })

    // Pre-fetch tool definitions in background so first message doesn't wait
    fetchToolDefinitions('chat')

    return () => {
      unsubscribeAppPluginChanges()
      unsubscribeAppPluginHydration?.()
      unsubscribeSettingsHydration?.()
      unsubscribeRuntimeSettings()
      unsubscribeRuntimeLifecycle()
      disposeCronRuntime()
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
          {view === 'splash' && <SplashPage />}
          {view === 'main' && <MainLayout />}
          {view === 'settings' && <SettingsPage />}
          <Toaster position="bottom-left" theme="system" richColors />
          <ConfirmDialogProvider />
        </TooltipProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
