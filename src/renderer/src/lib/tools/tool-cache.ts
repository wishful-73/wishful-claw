/**
 * Lightweight tool definition cache — no store/component imports.
 *
 * getCachedTools() returns synchronously (cached value or null).
 * fetchToolDefinitions() fires a background Worker request to warm the cache.
 * fetchToolDefinitionsAsync() returns a Promise — use when you need to await
 * the result before proceeding (e.g. skill-installer preset).
 *
 * This module is safe to import from App.tsx or any other entry point
 * without triggering circular dependency chains through stores.
 */

export interface CachedToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  category?: string
  priority?: number
}

let cachedTools: CachedToolDef[] | null = null
let cachedPreset: string | null = null
let fetchInFlight: Promise<void> | null = null

export function getCachedTools(): CachedToolDef[] | null {
  return cachedTools
}

export function fetchToolDefinitions(preset = 'chat'): void {
  if (cachedTools && cachedPreset === preset) return
  if (fetchInFlight) return
  fetchInFlight = (async () => {
    try {
      const result = await window.api.workerRequest<{ tools: CachedToolDef[] }>('tool/list', { preset })
      cachedTools = result.tools
      cachedPreset = preset
    } catch {
      // Worker not ready yet; will retry on next call
    } finally {
      fetchInFlight = null
    }
  })()
}

/**
 * Async version — awaits the fetch so the caller gets the correct preset's tools.
 * Use for special presets (e.g. skill-installer) where the default cache
 * (chat/coding) would return the wrong tool set.
 */
export async function fetchToolDefinitionsAsync(preset: string): Promise<CachedToolDef[]> {
  if (cachedTools && cachedPreset === preset) return cachedTools
  // Wait for any in-flight fetch to complete first
  if (fetchInFlight) await fetchInFlight
  if (cachedTools && cachedPreset === preset) return cachedTools
  try {
    const result = await window.api.workerRequest<{ tools: CachedToolDef[] }>('tool/list', { preset })
    cachedTools = result.tools
    cachedPreset = preset
    return result.tools
  } catch {
    return cachedTools ?? []
  }
}
