/**
 * Memory IPC helpers — call memory/* endpoints via Worker IPC.
 *
 * Architecture:
 *   Renderer → window.api.workerRequest('memory/xxx', params)
 *   → Electron Main 'worker:request' handler
 *   → .NET Worker MemoryModule handler
 *   → MemoryStore (files) + MemoryFtsService (SQLite FTS)
 */

// ─── Types ───

export interface MemoryStats {
  hotCount: number
  warmCount: number
  coldCount: number
  topicsCount: number
  dailyCount: number
}

export interface MemorySection {
  title: string
  body: string
}

export interface MemoryEntry {
  key: string
  title: string
  content: string
  priority: string
  tier: string
  scope: string
  created: string | null
  tags: string[]
  sourcePath: string | null
}

export interface MemorySearchResult {
  key: string
  title: string
  content: string
  scope: string
  tier: string
  score: number
  updatedAt: string
}

// ─── IPC Calls ───

export async function memoryStats(scope: string, workingFolder?: string | null): Promise<MemoryStats> {
  return window.api.workerRequest<MemoryStats>('memory/stats', { scope, workingFolder })
}

export async function memoryList(
  scope: string,
  target: string = 'memory',
  workingFolder?: string | null
): Promise<{ sections?: MemorySection[]; entries?: MemoryEntry[] }> {
  return window.api.workerRequest('memory/list', { scope, target, workingFolder })
}

export async function memorySearch(
  query: string,
  scope?: string | null,
  limit: number = 10
): Promise<{ hits: MemorySearchResult[] }> {
  return window.api.workerRequest('memory/search', { query, scope, limit })
}

export async function memoryRead(
  scope: string,
  target: string = 'memory',
  workingFolder?: string | null
): Promise<{ sections?: MemorySection[]; entries?: MemoryEntry[]; entry?: MemoryEntry | null }> {
  return window.api.workerRequest('memory/read', { scope, target, workingFolder })
}

export async function memoryWrite(
  scope: string,
  section: string,
  content: string,
  workingFolder?: string | null,
  sessionId?: string | null
): Promise<{ ok: boolean; key: string }> {
  // sessionId lets the worker announce the overwrite on the session's next
  // turn (memory-update injection); omit it for session-independent writes.
  return window.api.workerRequest('memory/write', {
    scope,
    section,
    content,
    workingFolder,
    sessionId: sessionId ?? undefined
  })
}

export async function memoryAppend(
  scope: string,
  content: string,
  priority: string = 'standard',
  workingFolder?: string | null
): Promise<{ ok: boolean; date: string }> {
  return window.api.workerRequest('memory/append', { scope, content, priority, workingFolder })
}

export async function memoryPromote(
  scope: string,
  key: string,
  workingFolder?: string | null
): Promise<{ ok: boolean }> {
  return window.api.workerRequest('memory/promote', { scope, key, workingFolder })
}

export async function memoryArchive(
  scope: string,
  key: string,
  workingFolder?: string | null
): Promise<{ ok: boolean }> {
  return window.api.workerRequest('memory/archive', { scope, key, workingFolder })
}

export async function memoryConsolidate(
  scope: string,
  workingFolder?: string | null
): Promise<{ ok: boolean; indexedCount: number }> {
  return window.api.workerRequest('memory/consolidate', { scope, workingFolder })
}
