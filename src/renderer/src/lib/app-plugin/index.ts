import { toolRegistry } from '@renderer/lib/agent/tool-registry'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { imageGenerateTool } from './image-tool'
import {
  registerBrowserTool,
  unregisterBrowserTool,
  isBrowserToolRegistered
} from '@renderer/lib/tools/browser-tool'
import {
  registerCodeGraphExploreTool,
  unregisterCodeGraphExploreTool,
  isCodeGraphExploreToolRegistered,
  registerCodeGraphFullSurface,
  unregisterCodeGraphFullSurface,
  isCodeGraphFullSurfaceRegistered
} from '@renderer/lib/tools/codegraph-tool'
import { CODEGRAPH_PLUGIN_ID } from './types'

let imageToolRegistered = false

function updateImageToolRegistration(enabled: boolean): void {
  if (enabled && !imageToolRegistered) {
    toolRegistry.register(imageGenerateTool)
    imageToolRegistered = true
  } else if (!enabled && imageToolRegistered) {
    toolRegistry.unregister(imageGenerateTool.definition.name)
    imageToolRegistered = false
  }
}

export function updateAppPluginToolRegistration(): void {
  const store = useAppPluginStore.getState()

  updateImageToolRegistration(store.isImageToolAvailable())

  if (store.isBrowserToolAvailable()) registerBrowserTool()
  else if (isBrowserToolRegistered()) unregisterBrowserTool()

  const codeGraphEnabled = store.isCodeGraphToolAvailable()
  if (codeGraphEnabled && !isCodeGraphExploreToolRegistered()) registerCodeGraphExploreTool()
  else if (!codeGraphEnabled && isCodeGraphExploreToolRegistered()) unregisterCodeGraphExploreTool()

  const fullSurface = codeGraphEnabled
  if (fullSurface && !isCodeGraphFullSurfaceRegistered()) void registerCodeGraphFullSurface()
  else if (!fullSurface && isCodeGraphFullSurfaceRegistered()) unregisterCodeGraphFullSurface()
}

export function isAppPluginToolsRegistered(): boolean {
  return (
    imageToolRegistered ||
    isBrowserToolRegistered() ||
    isCodeGraphExploreToolRegistered()
  )
}

export { CODEGRAPH_PLUGIN_ID }
