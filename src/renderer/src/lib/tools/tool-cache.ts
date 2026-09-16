/**
 * Lightweight tool definition cache — no store/component imports.
 *
 * getCachedTools() returns synchronously (cached value or null).
 * fetchToolDefinitions() fires a background Worker request to warm the cache.
 * fetchToolDefinitionsAsync() returns a Promise — use when you need to await
 * the result before proceeding (e.g. a background run that builds its request up front).
 *
 * There is one tool list, not one per scenario: what a run may actually call is decided from its
 * run context and each tool's own scope declaration, so no caller names a scenario.
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
let fetchInFlight: Promise<void> | null = null

export function getCachedTools(): CachedToolDef[] | null {
  return cachedTools
}

export function fetchToolDefinitions(): void {
  if (cachedTools) return
  if (fetchInFlight) return
  fetchInFlight = (async () => {
    try {
      const result = await window.api.workerRequest<{ tools: CachedToolDef[] }>('tool/list')
      cachedTools = result.tools
    } catch {
      // Worker not ready yet; will retry on next call
    } finally {
      fetchInFlight = null
    }
  })()
}

/**
 * Async version — awaits the fetch so the caller has the tool list before proceeding.
 * There is one list per registration, not one per scenario: what a run may actually call is
 * resolved from its run context, so nothing here varies by caller.
 */
export async function fetchToolDefinitionsAsync(): Promise<CachedToolDef[]> {
  if (cachedTools) return cachedTools
  // Wait for any in-flight fetch to complete first
  if (fetchInFlight) await fetchInFlight
  if (cachedTools) return cachedTools
  try {
    const result = await window.api.workerRequest<{ tools: CachedToolDef[] }>('tool/list')
    cachedTools = result.tools
    return result.tools
  } catch {
    return cachedTools ?? []
  }
}
