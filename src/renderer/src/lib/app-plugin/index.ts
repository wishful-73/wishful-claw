import { toolRegistry } from '@renderer/lib/agent/tool-registry'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { imageGenerateTool } from './image-tool'
import {
  registerBrowserTool,
  unregisterBrowserTool,
  isBrowserToolRegistered
} from '@renderer/lib/tools/browser-tool'
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
}

export function isAppPluginToolsRegistered(): boolean {
  return imageToolRegistered || isBrowserToolRegistered()
}

export { CODEGRAPH_PLUGIN_ID }
