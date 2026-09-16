
import type { SubAgentState, PersistedAgentHistoryState, AgentStore } from './types'
import {
  LEGACY_AGENT_HISTORY_STORAGE_KEY,
  AGENT_STORE_STORAGE_KEY,
  AGENT_HISTORY_PERSIST_DEBOUNCE_MS
} from './constants'
import {
  compactSubAgentListForPersistence,
  buildPersistedSubAgentSnapshot
} from './utils/sub-agent-utils'
import { ipcStorage } from '../../lib/ipc/ipc-storage'
import {
  applyAgentHistory,
  readAgentHistory,
  readAgentHistoryIndex,
  replaceAgentHistory
} from '../../lib/ipc/agent-history-storage'
import { ipcClient } from '../../lib/ipc/ipc-client'

// Late-binding import to avoid circular dependency
// useAgentStore is imported lazily inside functions that reference it

let agentHistoryPersistenceHydrated = false
let agentHistoryPersistencePending = false
let agentHistoryPersistenceInFlight = false
let agentHistoryPersistenceTimer: ReturnType<typeof setTimeout> | null = null
const pendingAgentHistoryUpsertIds = new Set<string>()
const pendingAgentHistoryRemoveIds = new Set<string>()
const pendingAgentHistoryRemoveSessionIds = new Set<string>()
const inFlightAgentHistoryUpsertIds = new Set<string>()
const loadedAgentHistorySessionIds = new Set<string>()
const agentHistorySessionLoadPromises = new Map<string, Promise<void>>()
const agentHistorySessionVersions = new Map<string, number>()
let agentHistoryLoadEpoch = 0
let agentHistoryHydrationPromise: Promise<void> | null = null

export function getAgentHistoryHydrationPromise(): Promise<void> | null {
  return agentHistoryHydrationPromise
}

export function setAgentHistoryHydrationPromise(p: Promise<void> | null): void {
  agentHistoryHydrationPromise = p
}

export {
  pendingAgentHistoryUpsertIds,
  pendingAgentHistoryRemoveIds,
  pendingAgentHistoryRemoveSessionIds,
  inFlightAgentHistoryUpsertIds,
  loadedAgentHistorySessionIds,
  agentHistoryLoadEpoch
}

export function incrementAgentHistoryLoadEpoch(): void {
  agentHistoryLoadEpoch += 1
}

export function clearLoadedAgentHistorySessionIds(): void {
  loadedAgentHistorySessionIds.clear()
}

function normalizePersistedAgentRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.state && typeof record.state === 'object' && !Array.isArray(record.state)) {
      return record.state as Record<string, unknown>
    }
    return record
  } catch {
    return null
  }
}

function normalizePersistedSubAgentList(value: unknown): SubAgentState[] {
  if (!Array.isArray(value)) return []
  return compactSubAgentListForPersistence(value as SubAgentState[]).map((agent) => ({
    ...agent,
    // Worker 落库的 finalOutput 才是完整报告；流式累积的那份在父 run 提前结束时只有前
    // 几轮。它更长才覆盖，避免兜底文案冲掉已有内容（S-36）。
    report:
      typeof agent.finalOutput === 'string' &&
      agent.finalOutput.trim().length > (agent.report ?? '').trim().length
        ? agent.finalOutput
        : agent.report,
    endReason:
      agent.endReason === 'completed' ||
      agent.endReason === 'max_iterations' ||
      agent.endReason === 'aborted' ||
      agent.endReason === 'error'
        ? agent.endReason
        : agent.isRunning
          ? null
          : agent.success === true
            ? 'completed'
            : agent.success === false
              ? 'error'
              : null
  }))
}

function normalizePersistedSessionSummaries(value: unknown): Record<string, SubAgentState[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, SubAgentState[]> = {}
  for (const [sessionId, summaries] of Object.entries(value as Record<string, unknown>)) {
    const key = sessionId.trim()
    if (!key) continue
    next[key] = normalizePersistedSubAgentList(summaries)
  }
  return next
}

function hasAgentHistoryPayload(record: Record<string, unknown> | null): boolean {
  return Boolean(record && ('subAgentHistory' in record || 'sessionSubAgentSummaries' in record))
}

async function readPersistedAgentHistory(): Promise<{
  snapshot: PersistedAgentHistoryState | null
  migratedFromLegacy: boolean
}> {
  const databaseIndex = await readAgentHistoryIndex()
  if (databaseIndex.total > 0) {
    return { snapshot: null, migratedFromLegacy: false }
  }

  const primaryRaw = await ipcStorage.getItem(LEGACY_AGENT_HISTORY_STORAGE_KEY)
  const primaryRecord = normalizePersistedAgentRecord(primaryRaw)
  if (primaryRaw !== null) {
    return {
      snapshot: {
        subAgentHistory: normalizePersistedSubAgentList(primaryRecord?.subAgentHistory),
        sessionSubAgentSummaries: normalizePersistedSessionSummaries(
          primaryRecord?.sessionSubAgentSummaries
        )
      },
      migratedFromLegacy: true
    }
  }

  const legacyRecord = normalizePersistedAgentRecord(
    await ipcStorage.getItem(AGENT_STORE_STORAGE_KEY)
  )
  if (!hasAgentHistoryPayload(legacyRecord)) {
    return { snapshot: null, migratedFromLegacy: false }
  }

  return {
    snapshot: {
      subAgentHistory: normalizePersistedSubAgentList(legacyRecord?.subAgentHistory),
      sessionSubAgentSummaries: normalizePersistedSessionSummaries(
        legacyRecord?.sessionSubAgentSummaries
      )
    },
    migratedFromLegacy: true
  }
}

async function removeLegacyAgentHistorySettings(): Promise<void> {
  await ipcClient.invoke('settings:set', {
    key: LEGACY_AGENT_HISTORY_STORAGE_KEY,
    value: undefined
  })

  const legacyAgentStoreRaw = await ipcStorage.getItem(AGENT_STORE_STORAGE_KEY)
  if (!legacyAgentStoreRaw) return
  try {
    const persisted = JSON.parse(legacyAgentStoreRaw) as Record<string, unknown>
    const state =
      persisted.state && typeof persisted.state === 'object' && !Array.isArray(persisted.state)
        ? (persisted.state as Record<string, unknown>)
        : persisted
    const hadHistory = 'subAgentHistory' in state || 'sessionSubAgentSummaries' in state
    if (!hadHistory) return
    delete state.subAgentHistory
    delete state.sessionSubAgentSummaries
    await ipcClient.invoke('settings:set', {
      key: AGENT_STORE_STORAGE_KEY,
      value: persisted
    })
  } catch {
    // Native startup migration handles malformed or older string-wrapped stores on the next run.
  }
}

export function invalidateAgentHistorySession(sessionId: string): void {
  loadedAgentHistorySessionIds.delete(sessionId)
  agentHistorySessionVersions.set(sessionId, (agentHistorySessionVersions.get(sessionId) ?? 0) + 1)
}

export async function loadAgentHistorySession(sessionId: string): Promise<void> {
  const key = sessionId.trim()
  if (!key) return
  if (agentHistoryHydrationPromise) {
    await agentHistoryHydrationPromise
  }
  if (loadedAgentHistorySessionIds.has(key)) return

  const existingPromise = agentHistorySessionLoadPromises.get(key)
  if (existingPromise) {
    await existingPromise
    return
  }

  // Late import to avoid circular dependency
  const { useAgentStore } = await import('./index')

  const epoch = agentHistoryLoadEpoch
  const version = agentHistorySessionVersions.get(key) ?? 0
  const loadPromise = readAgentHistory<SubAgentState>(key)
    .then((value) => {
      if (
        epoch !== agentHistoryLoadEpoch ||
        version !== (agentHistorySessionVersions.get(key) ?? 0) ||
        pendingAgentHistoryRemoveSessionIds.has(key)
      ) {
        return
      }

      const state = useAgentStore.getState()
      const mergedById = new Map<string, SubAgentState>()
      for (const agent of normalizePersistedSubAgentList(value)) {
        if (!pendingAgentHistoryRemoveIds.has(agent.toolUseId)) {
          mergedById.set(agent.toolUseId, agent)
        }
      }
      for (const agent of state.subAgentHistory) {
        if (agent.sessionId === key) mergedById.set(agent.toolUseId, agent)
      }
      for (const agent of state.sessionSubAgentSummaries[key] ?? []) {
        mergedById.set(agent.toolUseId, agent)
      }

      const merged = [...mergedById.values()].sort(
        (left, right) =>
          (right.completedAt ?? right.startedAt) - (left.completedAt ?? left.startedAt)
      )
      useAgentStore.setState({
        subAgentHistory: [
          ...state.subAgentHistory.filter((agent) => agent.sessionId !== key),
          ...merged
        ],
        sessionSubAgentSummaries: {
          ...state.sessionSubAgentSummaries,
          [key]: merged
        }
      })
      loadedAgentHistorySessionIds.add(key)
    })
    .catch((error) => {
      console.warn(`[AgentStore] Failed to load sub-agent history for session ${key}:`, error)
    })
    .finally(() => {
      agentHistorySessionLoadPromises.delete(key)
    })

  agentHistorySessionLoadPromises.set(key, loadPromise)
  await loadPromise
}

function findAgentHistoryEntryForPersistence(
  state: AgentStore,
  toolUseId: string
): SubAgentState | null {
  const historyEntry = state.subAgentHistory.find((agent) => agent.toolUseId === toolUseId)
  if (historyEntry) return historyEntry
  for (const summaries of Object.values(state.sessionSubAgentSummaries)) {
    const summary = summaries.find((agent) => agent.toolUseId === toolUseId)
    if (summary) return summary
  }
  return null
}

async function flushAgentHistoryPersistence(): Promise<void> {
  if (!agentHistoryPersistenceHydrated) return
  if (agentHistoryPersistenceInFlight) {
    agentHistoryPersistencePending = true
    return
  }

  // Late import to avoid circular dependency
  const { useAgentStore } = await import('./index')

  agentHistoryPersistenceInFlight = true
  agentHistoryPersistencePending = false
  const upsertIds = [...pendingAgentHistoryUpsertIds]
  const explicitRemoveIds = [...pendingAgentHistoryRemoveIds]
  const removeSessionIds = [...pendingAgentHistoryRemoveSessionIds]
  for (const id of upsertIds) inFlightAgentHistoryUpsertIds.add(id)
  pendingAgentHistoryUpsertIds.clear()
  pendingAgentHistoryRemoveIds.clear()
  pendingAgentHistoryRemoveSessionIds.clear()
  try {
    const state = useAgentStore.getState()
    const upserts: SubAgentState[] = []
    const removeIds = new Set(explicitRemoveIds)
    for (const id of upsertIds) {
      const entry = findAgentHistoryEntryForPersistence(state, id)
      if (entry) {
        upserts.push(buildPersistedSubAgentSnapshot(entry))
        removeIds.delete(id)
      } else {
        removeIds.add(id)
      }
    }

    if (upserts.length > 0 || removeIds.size > 0 || removeSessionIds.length > 0) {
      await applyAgentHistory({
        upserts,
        removeIds: [...removeIds],
        removeSessionIds
      })
    }
  } catch (error) {
    for (const id of upsertIds) pendingAgentHistoryUpsertIds.add(id)
    for (const id of explicitRemoveIds) pendingAgentHistoryRemoveIds.add(id)
    for (const sessionId of removeSessionIds) {
      pendingAgentHistoryRemoveSessionIds.add(sessionId)
    }
    agentHistoryPersistencePending = true
    console.warn('[AgentStore] Failed to persist sub-agent history:', error)
  } finally {
    for (const id of upsertIds) inFlightAgentHistoryUpsertIds.delete(id)
    agentHistoryPersistenceInFlight = false
    if (agentHistoryPersistencePending) {
      queueAgentHistoryPersistence()
    }
  }
}

export function queueAgentHistoryPersistence(change?: {
  upsertIds?: string[]
  removeIds?: string[]
  removeSessionIds?: string[]
}): void {
  for (const id of change?.upsertIds ?? []) {
    pendingAgentHistoryUpsertIds.add(id)
    pendingAgentHistoryRemoveIds.delete(id)
  }
  for (const id of change?.removeIds ?? []) {
    pendingAgentHistoryRemoveIds.add(id)
    pendingAgentHistoryUpsertIds.delete(id)
  }
  for (const sessionId of change?.removeSessionIds ?? []) {
    pendingAgentHistoryRemoveSessionIds.add(sessionId)
  }
  agentHistoryPersistencePending = true
  if (!agentHistoryPersistenceHydrated) return
  if (agentHistoryPersistenceTimer) return

  agentHistoryPersistenceTimer = setTimeout(() => {
    agentHistoryPersistenceTimer = null
    void flushAgentHistoryPersistence()
  }, AGENT_HISTORY_PERSIST_DEBOUNCE_MS)
}

async function hydrateAgentHistoryPersistence(): Promise<void> {
  // Late import to avoid circular dependency
  const { useAgentStore } = await import('./index')

  try {
    const { snapshot, migratedFromLegacy } = await readPersistedAgentHistory()
    if (snapshot) {
      useAgentStore.setState({
        subAgentHistory: snapshot.subAgentHistory,
        sessionSubAgentSummaries: snapshot.sessionSubAgentSummaries
      })
      for (const sessionId of Object.keys(snapshot.sessionSubAgentSummaries)) {
        loadedAgentHistorySessionIds.add(sessionId)
      }
    }
    if (migratedFromLegacy && snapshot) {
      await replaceAgentHistory(snapshot)
      await removeLegacyAgentHistorySettings()
    }
    agentHistoryPersistenceHydrated = true
    if (agentHistoryPersistencePending) {
      queueAgentHistoryPersistence()
    }
  } catch (error) {
    console.warn('[AgentStore] Failed to hydrate sub-agent history:', error)
    agentHistoryPersistenceHydrated = true
    if (agentHistoryPersistencePending) {
      queueAgentHistoryPersistence()
    }
  }
}

export function initAgentHistoryHydration(): Promise<void> {
  agentHistoryHydrationPromise = hydrateAgentHistoryPersistence()
  return agentHistoryHydrationPromise
}
