import * as fs from 'fs'
import * as path from 'path'
import { resolveDataDir } from './data-dir'

const AGENT_HISTORY_DIRECTORY_NAME = 'agent-history'

function getDataDirectory(): string {
  return resolveDataDir()
}

function getAgentHistoryDirectory(): string {
  return path.join(getDataDirectory(), AGENT_HISTORY_DIRECTORY_NAME)
}

function getSessionFilePath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getAgentHistoryDirectory(), `${safe}.json`)
}

function ensureDirectory(): void {
  const dir = getAgentHistoryDirectory()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

interface SubAgentRecord {
  toolUseId: string
  sessionId?: string
  startedAt: number
  completedAt?: number | null
  [key: string]: unknown
}

interface AgentHistoryIndex {
  total: number
  sessions: Array<{
    sessionId: string
    count: number
    latestStartedAt: number
  }>
}

/** Read all sub-agent records for a given session. */
export function readAgentHistory(sessionId: string): SubAgentRecord[] {
  const filePath = getSessionFilePath(sessionId)
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as SubAgentRecord[]
  } catch {
    return []
  }
}

/** Build an index of all sessions that have sub-agent history. */
export function readAgentHistoryIndex(): AgentHistoryIndex {
  const dir = getAgentHistoryDirectory()
  if (!fs.existsSync(dir)) return { total: 0, sessions: [] }

  const sessions: AgentHistoryIndex['sessions'] = []
  let total = 0

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8')
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.length === 0) continue

        const sessionId = parsed[0]?.sessionId ?? path.basename(file, '.json')
        const count = parsed.length
        const latestStartedAt = Math.max(
          ...parsed.map((a: SubAgentRecord) => a.startedAt ?? 0)
        )
        sessions.push({ sessionId, count, latestStartedAt })
        total += count
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // Directory read failed
  }

  sessions.sort((a, b) => b.latestStartedAt - a.latestStartedAt)
  return { total, sessions }
}

export interface AgentHistoryApplyRequest {
  upserts?: SubAgentRecord[]
  removeIds?: string[]
  removeSessionIds?: string[]
}

/** Apply upserts and removals to sub-agent history. */
export function applyAgentHistory(request: AgentHistoryApplyRequest): void {
  ensureDirectory()

  const { upserts = [], removeIds = [], removeSessionIds = [] } = request

  // Group upserts by sessionId
  const upsertsBySession = new Map<string, Map<string, SubAgentRecord>>()
  for (const agent of upserts) {
    const sid = agent.sessionId ?? '_unknown'
    if (!upsertsBySession.has(sid)) {
      upsertsBySession.set(sid, new Map())
    }
    upsertsBySession.get(sid)!.set(agent.toolUseId, agent)
  }

  // Process removals by sessionId
  const removeSessionSet = new Set(removeSessionIds)

  // Collect all affected sessions
  const affectedSessions = new Set<string>()
  for (const sid of upsertsBySession.keys()) affectedSessions.add(sid)

  // For removeIds, we need to find which session they belong to
  if (removeIds.length > 0) {
    const allSessions = listAllSessionIds()
    for (const sid of allSessions) {
      const records = readAgentHistory(sid)
      if (records.some((r) => removeIds.includes(r.toolUseId))) {
        affectedSessions.add(sid)
      }
    }
  }

  for (const sid of removeSessionIds) affectedSessions.add(sid)

  // Apply changes to each affected session
  for (const sid of affectedSessions) {
    // If the entire session is being removed, delete the file
    if (removeSessionSet.has(sid) && !upsertsBySession.has(sid)) {
      const filePath = getSessionFilePath(sid)
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        // Ignore deletion errors
      }
      continue
    }

    // Read existing records
    let records = readAgentHistory(sid)
    const removeIdSet = new Set(removeIds)

    // Remove by IDs
    if (removeIdSet.size > 0) {
      records = records.filter((r) => !removeIdSet.has(r.toolUseId))
    }

    // Remove by session (if this session is in removeSessionIds but also has upserts)
    if (removeSessionSet.has(sid)) {
      records = []
    }

    // Apply upserts
    const upsertMap = upsertsBySession.get(sid)
    if (upsertMap) {
      for (const [id, agent] of upsertMap) {
        const idx = records.findIndex((r) => r.toolUseId === id)
        if (idx !== -1) {
          records[idx] = agent
        } else {
          records.push(agent)
        }
      }
    }

    // Sort by startedAt descending (newest first)
    records.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))

    // Write back
    const filePath = getSessionFilePath(sid)
    if (records.length === 0) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        // Ignore
      }
    } else {
      fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8')
    }
  }
}

interface PersistedAgentHistorySnapshot {
  subAgentHistory: SubAgentRecord[]
  sessionSubAgentSummaries: Record<string, SubAgentRecord[]>
}

/** Replace the entire agent history store (used during migration). */
export function replaceAgentHistory(snapshot: PersistedAgentHistorySnapshot): void {
  ensureDirectory()

  // Clear existing files
  const dir = getAgentHistoryDirectory()
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file))
      }
    }
  } catch {
    // Ignore
  }

  // Group by sessionId and write
  const { subAgentHistory = [], sessionSubAgentSummaries = {} } = snapshot

  // Merge: sessionSubAgentSummaries takes priority, then subAgentHistory
  const bySession = new Map<string, Map<string, SubAgentRecord>>()

  for (const agent of subAgentHistory) {
    const sid = agent.sessionId ?? '_unknown'
    if (!bySession.has(sid)) bySession.set(sid, new Map())
    bySession.get(sid)!.set(agent.toolUseId, agent)
  }

  for (const [sid, agents] of Object.entries(sessionSubAgentSummaries)) {
    if (!bySession.has(sid)) bySession.set(sid, new Map())
    for (const agent of agents) {
      bySession.get(sid)!.set(agent.toolUseId, agent)
    }
  }

  for (const [sid, agentMap] of bySession) {
    const records = [...agentMap.values()].sort(
      (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
    )
    if (records.length === 0) continue
    const filePath = getSessionFilePath(sid)
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8')
  }
}

/** List all session IDs that have history files. */
function listAllSessionIds(): string[] {
  const dir = getAgentHistoryDirectory()
  if (!fs.existsSync(dir)) return []

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    const sessionIds: string[] = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sid = parsed[0]?.sessionId ?? path.basename(file, '.json')
          sessionIds.push(sid)
        }
      } catch {
        // Skip
      }
    }
    return sessionIds
  } catch {
    return []
  }
}
