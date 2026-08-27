import type { Session, Project, ChatMessage } from './types'

/**
 * DB persistence helpers — SQLite via Worker IPC (workerRequest → db/*).
 *
 * Architecture:
 *   Renderer → window.api.workerRequest('db/xxx', params)
 *   → Electron Main 'worker:request' handler
 *   → .NET Worker DbModule handler
 *   → SqlSugar ORM → SQLite (~/.wishful-claw/index.db)
 */

// ─── DB Row Types (from backend, snake_case) ───

interface ProjectRow {
  id: string
  name: string
  workingFolder: string | null
  sshConnectionId: string | null
  pluginId: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  sessionCount: number
}

interface SessionRow {
  id: string
  title: string
  icon: string | null
  mode: string
  createdAt: number
  updatedAt: number
  messageCount: number
  projectId: string | null
  workingFolder: string | null
  sshConnectionId: string | null
  planId: string | null
  pinned: boolean
  pluginId: string | null
  pluginType: string | null
  externalChatId: string | null
  externalChatType: string | null
  providerId: string | null
  modelId: string | null
  modelSelectionMode: string | null
  personaId: string | null
}

interface MessageRow {
  id: string
  sessionId: string
  role: string
  content: string
  meta: string | null
  createdAt: number
  usage: string | null
  sortOrder: number
}

// ─── Serialization helpers ───

/**
 * Serialize a ChatMessage to DB format.
 * content = message text
 * meta = JSON string of { thinking, toolCalls, isStreaming, error }
 * usage = JSON string of usage data
 */
function serializeMessage(msg: ChatMessage, sortOrder: number): {
  id: string
  sessionId: string
  role: string
  content: string
  meta: string | null
  createdAt: number
  usage: string | null
  sortOrder: number
} {
  const meta: Record<string, unknown> = {}
  if (msg.thinking) meta.thinking = msg.thinking
  if (msg.toolCalls && msg.toolCalls.length > 0) meta.toolCalls = msg.toolCalls
  if (msg.segments && msg.segments.length > 0) meta.segments = msg.segments
  if (msg.error) meta.error = msg.error
  if (msg.preToolPhase) meta.preToolPhase = msg.preToolPhase
  if (msg.meta) Object.assign(meta, msg.meta)

  return {
    id: msg.id,
    sessionId: '', // filled by caller
    role: msg.role,
    content: msg.text,
    meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    createdAt: msg.createdAt,
    usage: msg.usage ? JSON.stringify(msg.usage) : null,
    sortOrder
  }
}

/**
 * Deserialize a DB MessageRow back to ChatMessage.
 */
function deserializeMessage(row: MessageRow): ChatMessage {
  const msg: ChatMessage = {
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'system',
    text: row.content,
    createdAt: row.createdAt
  }

  if (row.meta) {
    try {
      const meta = JSON.parse(row.meta) as Record<string, unknown>
      if (meta.thinking) msg.thinking = meta.thinking as string
      if (meta.toolCalls) msg.toolCalls = meta.toolCalls as ChatMessage['toolCalls']
      if (meta.segments) msg.segments = meta.segments as ChatMessage["segments"]
      if (meta.error) msg.error = meta.error as string
      if (meta.preToolPhase) msg.preToolPhase = meta.preToolPhase as boolean
      const messageMeta = { ...meta }
      delete messageMeta.thinking
      delete messageMeta.toolCalls
      delete messageMeta.segments
      delete messageMeta.error
      delete messageMeta.preToolPhase
      if (Object.keys(messageMeta).length > 0) msg.meta = messageMeta as ChatMessage['meta']
    } catch {
      // ignore parse errors
    }
  }

  if (row.usage) {
    try {
      msg.usage = JSON.parse(row.usage)
    } catch {
      // ignore
    }
  }

  return msg
}

/**
 * Convert DB SessionRow to frontend Session type.
 */
function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon ?? undefined,
    mode: row.mode as Session['mode'],
    messages: [],
    messageCount: row.messageCount,
    messagesLoaded: false,
    loadedRangeStart: 0,
    loadedRangeEnd: 0,
    lastKnownMessageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    projectId: row.projectId ?? undefined,
    workingFolder: row.workingFolder ?? undefined,
    sshConnectionId: row.sshConnectionId ?? undefined,
    planId: row.planId ?? undefined,
    pinned: row.pinned,
    pluginId: row.pluginId ?? undefined,
    pluginType: row.pluginType ?? undefined,
    externalChatId: row.externalChatId ?? undefined,
    providerId: row.providerId ?? undefined,
    modelId: row.modelId ?? undefined,
    modelSelectionMode: (row.modelSelectionMode ?? 'inherit') as Session['modelSelectionMode'],
    personaId: row.personaId ?? undefined
  }
}

/**
 * Convert DB ProjectRow to frontend Project type.
 */
function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    workingFolder: row.workingFolder ?? undefined,
    sshConnectionId: row.sshConnectionId ?? undefined,
    pluginId: row.pluginId ?? undefined,
    pinned: row.pinned,
    sessionCount: row.sessionCount
  }
}

// ─── DB Initialize ───

let dbInitPromise: Promise<void> | null = null

export async function ensureDbInitialized(): Promise<void> {
  dbInitPromise ??= window.api.workerRequest<{ success: boolean; dbPath: string; error: string | null }>('db/initialize', {})
    .then((result) => {
      if (!result.success) {
        dbInitPromise = null
        throw new Error(result.error || 'DB initialization failed')
      }
    })
    .catch((err) => {
      dbInitPromise = null
      throw err
    })
  return dbInitPromise
}

// ─── Session DB Operations ───

/** Tracks in-flight session creation promises so callers can await them
 *  before issuing updates (prevents race condition where db/sessions-update
 *  reaches the worker before db/sessions-create, causing a silent no-op). */
const sessionCreatePromises = new Map<string, Promise<void>>()

export async function dbCreateSession(session: Session): Promise<void> {
  const promise = (async () => {
    await ensureDbInitialized()
    await window.api.workerRequest('db/sessions-create', {
    id: session.id,
    title: session.title,
    icon: session.icon ?? null,
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    projectId: session.projectId ?? null,
    workingFolder: session.workingFolder ?? null,
    sshConnectionId: session.sshConnectionId ?? null,
    planId: session.planId ?? null,
    pinned: session.pinned ?? false,
    providerId: session.providerId ?? null,
    modelId: session.modelId ?? null,
    modelSelectionMode: session.modelSelectionMode ?? 'inherit',
    personaId: session.personaId ?? null
    })
  })()
  sessionCreatePromises.set(session.id, promise)
  promise.finally(() => sessionCreatePromises.delete(session.id))
  return promise
}

/** Await a pending dbCreateSession for the given session id.
 *  No-op if creation already completed or was never initiated. */
export async function awaitSessionCreated(sessionId: string): Promise<void> {
  const promise = sessionCreatePromises.get(sessionId)
  if (promise) await promise
}

export async function dbDeleteSession(sessionId: string): Promise<void> {
  await window.api.workerRequest('db/sessions-delete', { id: sessionId })
}

export async function dbUpdateSession(
  sessionId: string,
  patch: Partial<Session>
): Promise<void> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.title !== undefined) dbPatch.title = patch.title
  if (patch.icon !== undefined) dbPatch.icon = patch.icon
  if (patch.mode !== undefined) dbPatch.mode = patch.mode
  if (patch.updatedAt !== undefined) dbPatch.updatedAt = patch.updatedAt
  if (patch.projectId !== undefined) dbPatch.projectId = patch.projectId
  if (patch.workingFolder !== undefined) dbPatch.workingFolder = patch.workingFolder
  if (patch.pinned !== undefined) dbPatch.pinned = patch.pinned
  if (patch.providerId !== undefined) dbPatch.providerId = patch.providerId
  if (patch.modelId !== undefined) dbPatch.modelId = patch.modelId
  if (patch.modelSelectionMode !== undefined) dbPatch.modelSelectionMode = patch.modelSelectionMode
  if (patch.personaId !== undefined) dbPatch.personaId = patch.personaId

  await window.api.workerRequest('db/sessions-update', { id: sessionId, patch: dbPatch })
}

// ─── Project DB Operations ───

export async function dbCreateProject(project: Project): Promise<void> {
  await ensureDbInitialized()
  await window.api.workerRequest('db/projects-create', {
    id: project.id,
    name: project.name,
    workingFolder: project.workingFolder ?? null,
    sshConnectionId: project.sshConnectionId ?? null,
    pinned: project.pinned ?? false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  })
}

export async function dbDeleteProject(projectId: string): Promise<void> {
  await window.api.workerRequest('db/projects-delete', { id: projectId })
}

export async function dbUpdateProject(
  projectId: string,
  patch: Partial<Project>
): Promise<void> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.workingFolder !== undefined) dbPatch.workingFolder = patch.workingFolder
  if (patch.sshConnectionId !== undefined) dbPatch.sshConnectionId = patch.sshConnectionId
  if (patch.pinned !== undefined) dbPatch.pinned = patch.pinned
  if (patch.updatedAt !== undefined) dbPatch.updatedAt = patch.updatedAt

  await window.api.workerRequest('db/projects-update', { id: projectId, patch: dbPatch })
}

// ─── Message DB Operations ───

/**
 * Upsert a message to DB. Called during streaming (message_end) and for user messages.
 */
export async function dbUpsertMessage(
  sessionId: string,
  msg: ChatMessage,
  sortOrder: number
): Promise<void> {
  await ensureDbInitialized()
  const data = serializeMessage(msg, sortOrder)
  data.sessionId = sessionId
  await window.api.workerRequest('db/messages-upsert', data)
}

/**
 * Load messages for a session from DB.
 */
export async function dbLoadMessages(sessionId: string): Promise<ChatMessage[]> {
  await ensureDbInitialized()
  const rows = await window.api.workerRequest<MessageRow[]>('db/messages-list', { sessionId })
  return rows.map(deserializeMessage)
}

/**
 * Load a page of messages from DB (like WishfulClaw's dbListMessagesPage).
 */
export async function dbListMessagesPage(args: {
  sessionId: string
  limit: number
  offset: number
}): Promise<ChatMessage[]> {
  await ensureDbInitialized()
  const rows = await window.api.workerRequest<MessageRow[]>('db/messages-list-page', {
    sessionId: args.sessionId,
    limit: args.limit,
    offset: args.offset
  })
  return rows.map(deserializeMessage)
}

/**
 * Load messages by conversation turns (e.g. 5 most recent user→assistant rounds).
 * If beforeSortOrder is omitted, loads from the latest message.
 * Returns messages + rangeStart (earliest sort_order) + hasMore.
 */
export async function dbListMessagesByTurns(args: {
  sessionId: string
  turns?: number
  beforeCreatedAt?: number
}): Promise<{ messages: ChatMessage[]; rangeStart: number; hasMore: boolean; totalTurns: number }> {
  await ensureDbInitialized()
  const result = await window.api.workerRequest<{
    success: boolean
    messages: MessageRow[]
    rangeStart: number
    hasMore: boolean
    totalTurns?: number
    error: string | null
  }>('db/messages-list-by-turns', {
    sessionId: args.sessionId,
    turns: args.turns ?? 5,
    beforeCreatedAt: args.beforeCreatedAt
  })
  return {
    messages: (result.messages ?? []).map(deserializeMessage),
    rangeStart: result.rangeStart ?? 0,
    hasMore: result.hasMore ?? false,
    totalTurns: result.totalTurns ?? 0
  }
}

/**
 * Get message count for a session.
 */
export async function dbGetMessageCount(sessionId: string): Promise<number> {
  const result = await window.api.workerRequest<{ success: boolean; count: number }>('db/messages-count', { sessionId })
  return result.count
}

/**
 * Delete a single message by id. Safe no-op when the row was never persisted.
 */
export async function dbDeleteMessage(sessionId: string, messageId: string): Promise<void> {
  await window.api.workerRequest('db/messages-delete', { sessionId, messageId })
}

/**
 * Delete last message of a given role from DB.
 */
export async function dbDeleteLastMessage(sessionId: string, role: string): Promise<void> {
  await window.api.workerRequest('db/messages-delete-last', { sessionId, role })
}

/**
 * Clear all messages for a session.
 */
export async function dbClearMessages(sessionId: string): Promise<void> {
  await window.api.workerRequest('db/messages-clear', { sessionId })
}

// ─── Load All (startup) ───

/** Fetch a single session row (channel metadata included) by id. */
export async function dbGetSession(sessionId: string): Promise<Session | null> {
  await ensureDbInitialized()
  const result = await window.api.workerRequest<{ success: boolean; session: SessionRow | null }>(
    'db/sessions-get',
    { id: sessionId }
  )
  return result?.session ? rowToSession(result.session) : null
}

export async function dbLoadAll(): Promise<{ projects: Project[]; sessions: Session[] } | null> {
  try {
    await ensureDbInitialized()

    const [projectRows, sessionRows] = await Promise.all([
      window.api.workerRequest<ProjectRow[]>('db/projects-list', {}),
      window.api.workerRequest<SessionRow[]>('db/sessions-list', {})
    ])

    return {
      projects: projectRows.map(rowToProject),
      sessions: sessionRows.map(rowToSession)
    }
  } catch (err) {
    console.error('[DB] dbLoadAll failed:', err)
    return null
  }
}

// ─── Ensure Default Project ───

export async function dbEnsureDefaultProject(): Promise<Project | null> {
  await ensureDbInitialized()
  const row = await window.api.workerRequest<ProjectRow>('db/projects-ensure-default', {})
  return row ? rowToProject(row) : null
}
