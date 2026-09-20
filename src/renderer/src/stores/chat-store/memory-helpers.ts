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

export async function memoryStats(
  scope: string,
  workingFolder?: string | null,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<MemoryStats> {
  return window.api.workerRequest<MemoryStats>('memory/stats', {
    scope,
    workingFolder,
    projectId,
    sshConnectionId
  })
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
  limit: number = 10,
  workingFolder?: string | null,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<{ hits: MemorySearchResult[] }> {
  return window.api.workerRequest('memory/search', {
    query,
    scope,
    limit,
    workingFolder,
    projectId,
    sshConnectionId
  })
}

/**
 * Reads the hot-memory file (MEMORY.md) for a scope as raw text.
 *
 * The worker returns the whole file (`MemoryReadResult(content)`) — it does NOT
 * parse the markdown into `sections`. The old signature advertised `sections` /
 * `entries` and accepted a `target` argument; neither exists on the wire
 * (`MemoryModule.MemoryRead` reads only `scope`), and the function had zero
 * callers, so the misleading shape was removed in iter-33 S-96 when the global
 * hot-memory tab became its first caller.
 */
export async function memoryRead(
  scope: string,
  workingFolder?: string | null
): Promise<{ content: string }> {
  return window.api.workerRequest('memory/read', { scope, workingFolder })
}

/**
 * Overwrites the hot-memory file (MEMORY.md) for a scope with `content`.
 *
 * Whole-file overwrite, not a per-section patch: the worker ignores any
 * `section` field (`MemoryModule.MemoryWrite` writes `content` verbatim), so the
 * old `section` parameter was dropped in iter-33 S-96 rather than left as a
 * parameter that silently does nothing.
 */
export async function memoryWrite(
  scope: string,
  content: string,
  workingFolder?: string | null,
  sessionId?: string | null
): Promise<{ ok: boolean; key: string }> {
  // sessionId lets the worker announce the overwrite on the session's next
  // turn (memory-update injection); omit it for session-independent writes.
  return window.api.workerRequest('memory/write', {
    scope,
    content,
    workingFolder,
    sessionId: sessionId ?? undefined
  })
}

export async function memoryAppend(
  scope: string,
  content: string,
  priority: string = 'standard',
  workingFolder?: string | null,
  options?: { projectId?: string | null; sshConnectionId?: string | null; title?: string | null }
): Promise<{ ok: boolean; id?: number | null; error?: string | null }> {
  return window.api.workerRequest('memory/append', {
    scope,
    content,
    priority,
    workingFolder,
    projectId: options?.projectId ?? undefined,
    sshConnectionId: options?.sshConnectionId ?? undefined,
    title: options?.title ?? undefined
  })
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
  workingFolder?: string | null,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<{ ok: boolean; indexedCount: number }> {
  return window.api.workerRequest('memory/consolidate', {
    scope,
    workingFolder,
    projectId,
    sshConnectionId
  })
}

// ─── Tier organization (S4 endpoints) ───

export interface MemoryDemotionCandidate {
  id: number
  scope: string
  title: string | null
  priority: string
  status: string
  updatedAt: number
  targetStatus: 'warm' | 'cold' | string
}

export interface MemoryDemotionThresholds {
  warmDaysEphemeral?: number
  coldDaysEphemeral?: number
  warmDaysStandard?: number
  coldDaysStandard?: number
  warmDaysLasting?: number
  coldDaysLasting?: number
}

/**
 * Lists entries eligible for tier demotion (active → warm → cold) based on
 * priority × idle days. scope 'all' scans every scope; explicit scopes are exact.
 */
export async function memoryDemotionCandidates(
  scope: string,
  thresholds?: MemoryDemotionThresholds,
  workingFolder?: string | null,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<{ candidates?: MemoryDemotionCandidate[] }> {
  return window.api.workerRequest('memory/demotion-candidates', {
    scope,
    workingFolder,
    projectId,
    sshConnectionId,
    ...(thresholds ?? {})
  })
}

/**
 * Batch status transition shared by demotion, recovery and manual repair.
 * touch=true additionally refreshes updated_at.
 */
export interface MemoryStatusEntry {
  id: number
  scope: string
  title: string | null
  content: string
  priority: string
  status: string
  updatedAt: number
}

export async function memoryEntriesByStatus(
  status: 'active' | 'warm' | 'cold',
  scope: string = 'all',
  workingFolder?: string | null,
  limit: number = 200,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<{ entries?: MemoryStatusEntry[] }> {
  return window.api.workerRequest('memory/entries-by-status', {
    status,
    scope,
    workingFolder,
    projectId,
    sshConnectionId,
    limit
  })
}

/**
 * Lists every entry of a scope regardless of status (iter-33 S-91). The archive
 * page's memory library needs "everything in this project"; memoryEntriesByStatus
 * cannot express that because an empty status returns an empty list.
 * scope='project' is resolved worker-side by GetScope (workingFolder / projectId /
 * sshConnectionId), so the renderer never hand-builds a `project:ssh:{…}` scope.
 *
 * Server-side paging (iter-33 S-98): pass `offset` to walk the list and read
 * `total` off the response to know how far it goes. `order` is a whitelist —
 * the worker treats anything other than 'asc' as newest-first. The last two
 * parameters were appended so the existing five-argument call sites keep working.
 */
export async function memoryEntries(
  scope: string = 'all',
  workingFolder?: string | null,
  limit: number = 200,
  projectId?: string | null,
  sshConnectionId?: string | null,
  offset: number = 0,
  order: 'desc' | 'asc' = 'desc'
): Promise<{ entries?: MemoryStatusEntry[]; total?: number }> {
  return window.api.workerRequest('memory/entries', {
    scope,
    workingFolder,
    projectId,
    sshConnectionId,
    limit,
    offset,
    order
  })
}

export async function memoryBatchStatus(
  ids: number[],
  status: 'active' | 'warm' | 'cold',
  touch: boolean = false,
  scope: string = 'all',
  workingFolder?: string | null,
  projectId?: string | null,
  sshConnectionId?: string | null
): Promise<{ ok: boolean; affected: number; error?: string | null }> {
  return window.api.workerRequest('memory/batch-status', {
    ids,
    status,
    touch,
    scope,
    workingFolder,
    projectId,
    sshConnectionId
  })
}
