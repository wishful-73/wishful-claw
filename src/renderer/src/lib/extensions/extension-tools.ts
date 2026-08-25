import { useExtensionStore, resolveEffectiveActiveExtensionIds } from '@renderer/stores/extension-store'
import { useChatStore } from '@renderer/stores/chat-store'
import type { ExtensionInstance } from '../../../../shared/extension-types'

const EXTENSION_TOOL_PREFIX = 'extension__'
let registeredExtensionToolNames: string[] = []
let refreshPromise: Promise<void> | null = null

function getActiveExtensionToolNames(extensions: ExtensionInstance[], projectId: string | null): string[] {
  const activeIds = new Set(
    resolveEffectiveActiveExtensionIds({
      projectId,
      activeExtensionIdsByProject: useExtensionStore.getState().activeExtensionIdsByProject,
      extensions
    })
  )
  return extensions.flatMap((extension) => {
    if (!extension.enabled || !activeIds.has(extension.id)) return []
    return extension.manifest.tools.map(
      (tool) => `${EXTENSION_TOOL_PREFIX}${extension.id}__${tool.name}`
    )
  })
}

/**
 * Extension tools are executed by the Native Worker ToolDispatchRouter.
 * The renderer only refreshes the active-name snapshot; registering a fake
 * renderer handler with the same name would shadow the real Worker executor.
 */
export function unregisterExtensionTools(): void {
  registeredExtensionToolNames = []
}

export function getRegisteredExtensionToolNames(): string[] {
  return [...registeredExtensionToolNames]
}

export async function refreshExtensionTools(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const store = useExtensionStore.getState()
    if (!store.loaded) await store.loadExtensions()
    const current = useExtensionStore.getState()
    const projectId = useChatStore.getState().activeProjectId ?? null
    registeredExtensionToolNames = getActiveExtensionToolNames(current.extensions, projectId)
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}
