import { Globe, Image, MonitorSmartphone, Puzzle, Waypoints } from 'lucide-react'
import { useProviderStore } from '@renderer/stores/provider-store'
import {
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_GET_CONTENT_TOOL_NAME,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_PLUGIN_ID,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_SET_DEVICE_TOOL_NAME,
  BROWSER_SNAPSHOT_TOOL_NAME,
  BROWSER_TYPE_TOOL_NAME,
  CODEGRAPH_PLUGIN_ID,
  DESKTOP_CLICK_TOOL_NAME,
  DESKTOP_CONTROL_PLUGIN_ID,
  DESKTOP_LIST_WINDOWS_TOOL_NAME,
  DESKTOP_SCREENSHOT_TOOL_NAME,
  DESKTOP_SCROLL_TOOL_NAME,
  DESKTOP_TYPE_TOOL_NAME,
  DESKTOP_WAIT_TOOL_NAME,
  IMAGE_GENERATE_TOOL_NAME,
  IMAGE_PLUGIN_ID,
  isAppPluginEnabledByDefault,
  type AppPluginDescriptor,
  type AppPluginId,
  type AppPluginInstance,
  type AppPluginToolName
} from '@renderer/lib/app-plugin/types'

export const TOOL_ARG_LABELS: Record<AppPluginToolName, string[]> = {
  [IMAGE_GENERATE_TOOL_NAME]: ['prompt', 'count', 'reference_images', 'size', 'quality'],
  [BROWSER_NAVIGATE_TOOL_NAME]: ['url', 'action'],
  [BROWSER_GET_CONTENT_TOOL_NAME]: ['selector', 'type'],
  [BROWSER_SCREENSHOT_TOOL_NAME]: ['no args'],
  [BROWSER_SNAPSHOT_TOOL_NAME]: ['no args'],
  [BROWSER_CLICK_TOOL_NAME]: ['selector'],
  [BROWSER_TYPE_TOOL_NAME]: ['selector', 'text', 'clear', 'submit'],
  [BROWSER_SCROLL_TOOL_NAME]: ['direction', 'amount'],
  [BROWSER_SET_DEVICE_TOOL_NAME]: ['device', 'width', 'height'],
  [DESKTOP_SCREENSHOT_TOOL_NAME]: ['path', 'delayMs', 'grid', 'window'],
  [DESKTOP_LIST_WINDOWS_TOOL_NAME]: ['match'],
  [DESKTOP_CLICK_TOOL_NAME]: ['x', 'y', 'button', 'action'],
  [DESKTOP_TYPE_TOOL_NAME]: ['text', 'key', 'hotkey'],
  [DESKTOP_SCROLL_TOOL_NAME]: ['x', 'y', 'scrollX', 'scrollY'],
  [DESKTOP_WAIT_TOOL_NAME]: ['delayMs']
}

export function resolveDefaultImageModelId(providerId: string): string | null {
  const provider = useProviderStore.getState().providers.find((item) => item.id === providerId)
  if (!provider) return null
  const enabledModel = provider.models.find((item) => item.enabled && item.category === 'image')
  if (enabledModel) return enabledModel.id
  return provider.models.find((item) => item.category === 'image')?.id ?? null
}

function ImagePluginIcon(): React.JSX.Element {
  return <Image className="size-4" />
}

function DesktopControlPluginIcon(): React.JSX.Element {
  return <MonitorSmartphone className="size-4" />
}

function BrowserPluginIcon(): React.JSX.Element {
  return <Globe className="size-4" />
}

export function getPluginIcon(id: AppPluginId): React.JSX.Element {
  if (id === IMAGE_PLUGIN_ID) {
    return <ImagePluginIcon />
  }
  if (id === BROWSER_PLUGIN_ID) {
    return <BrowserPluginIcon />
  }
  if (id === DESKTOP_CONTROL_PLUGIN_ID) {
    return <DesktopControlPluginIcon />
  }
  if (id === CODEGRAPH_PLUGIN_ID) {
    return <Waypoints className="size-4" />
  }
  return <Puzzle className="size-4" />
}

export function createFallbackPlugin(id: AppPluginId): AppPluginInstance {
  return {
    id,
    enabled: isAppPluginEnabledByDefault(id),
    useGlobalModel: true,
    providerId: null,
    modelId: null
  }
}

export function getPluginState(options: {
  descriptor: AppPluginDescriptor
  pluginEnabled: boolean
  isResolvedImageModelReady: boolean
  /**
   * 资产就绪态。`null` = 状态还没从主进程拉回来。
   *
   * 必须与 `false` 分开：以前 `null` 被当成 `false`，列表首屏把「还没检测」
   * 显示成「待下载」，点进详情拉回真状态又变「已启用」—— 同一样东西两种说法。
   */
  isCodeGraphReady: boolean | null
}): 'disabled' | 'checking' | 'not_ready' | 'ready' {
  const { descriptor, pluginEnabled, isResolvedImageModelReady, isCodeGraphReady } = options
  if (!pluginEnabled) return 'disabled'
  if (descriptor.requiresModelConfig && !isResolvedImageModelReady) return 'not_ready'
  if (descriptor.requiresDownload) {
    if (isCodeGraphReady === null) return 'checking'
    if (!isCodeGraphReady) return 'not_ready'
  }
  return 'ready'
}

export function getToolStatusDescriptionKey(descriptor: AppPluginDescriptor): string {
  if (descriptor.requiresModelConfig) return 'plugin.toolStatusDesc'
  if (descriptor.id === BROWSER_PLUGIN_ID) return 'plugin.toolStatusDescBrowser'
  if (descriptor.id === CODEGRAPH_PLUGIN_ID) return 'plugin.toolStatusDescCodeGraph'
  return 'plugin.toolStatusDescDesktop'
}
