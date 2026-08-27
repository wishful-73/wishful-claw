import { Client, type SFTPWrapper } from 'ssh2'
import { getConnectionWithSecrets, updateConnection } from './repository'
import { buildConnectConfig } from './auth'

// Connection pool: one authenticated ssh2 Client per saved connection.
// Handles keepalive-detected drops with exponential-backoff reconnect.
// Supports exec (non-interactive command execution) and SFTP file operations.

type HandleState = 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'closed'

interface ConnectionHandle {
  connectionId: string
  state: HandleState
  client: Client | null
  lastError?: string
  generation: number
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
  lingerTimer: NodeJS.Timeout | null
  connectPromise: Promise<void> | null
  // Non-terminal consumers (exec ops) currently borrowing this handle.
  busyCount: number
}

const handles = new Map<string, ConnectionHandle>()

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]
const MAX_RECONNECT_ATTEMPTS = 2
const LINGER_MS = 60_000

function currentState(handle: ConnectionHandle): HandleState {
  return handle.state
}

function acquireHandle(connectionId: string): ConnectionHandle {
  let handle = handles.get(connectionId)
  if (!handle) {
    handle = {
      connectionId,
      state: 'connecting',
      client: null,
      generation: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      lingerTimer: null,
      connectPromise: null,
      busyCount: 0
    }
    handles.set(connectionId, handle)
  }
  return handle
}

function scheduleLingerIfIdle(handle: ConnectionHandle): void {
  if (handle.busyCount > 0) return
  if (handle.lingerTimer) return
  handle.lingerTimer = setTimeout(() => {
    handle.lingerTimer = null
    if (handle.busyCount > 0) return
    closeHandle(handle)
  }, LINGER_MS)
}

function closeHandle(handle: ConnectionHandle): void {
  handle.state = 'closed'
  if (handle.client) {
    try {
      handle.client.end()
    } catch {
      // ignore
    }
    handle.client = null
  }
  if (handle.reconnectTimer) {
    clearTimeout(handle.reconnectTimer)
    handle.reconnectTimer = null
  }
  handles.delete(handle.connectionId)
}

async function ensureConnected(handle: ConnectionHandle): Promise<Client> {
  // Already ready?
  if (currentState(handle) === 'ready' && handle.client) {
    return handle.client
  }

  // Already connecting?
  if (handle.connectPromise) {
    await handle.connectPromise
    if (handle.client && currentState(handle) === 'ready') return handle.client
    throw new Error(handle.lastError ?? 'Connection is not ready')
  }

  handle.state = 'connecting'
  handle.connectPromise = doConnect(handle)
  try {
    await handle.connectPromise
  } finally {
    handle.connectPromise = null
  }

  if (handle.client && currentState(handle) === 'ready') return handle.client
  throw new Error(handle.lastError ?? 'Connection failed')
}

async function doConnect(handle: ConnectionHandle): Promise<void> {
  const connection = getConnectionWithSecrets(handle.connectionId)
  if (!connection) throw new Error('Connection not found')

  const config = await buildConnectConfig(connection)

  return new Promise<void>((resolve) => {
    const client = new Client()
    let settled = false

    const generation = handle.generation + 1
    handle.generation = generation

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      if (err) {
        handle.state = 'failed'
        handle.lastError = err.message
        // Do NOT reset reconnectAttempts here: consecutive failures must
        // accumulate so MAX_RECONNECT_ATTEMPTS actually stops the loop.
        // Only a successful connect (below) resets the counter.
        scheduleReconnect(handle)
        resolve()
      } else {
        handle.state = 'ready'
        handle.lastError = undefined
        handle.reconnectAttempts = 0
        // Update lastConnectedAt
        void updateConnection(handle.connectionId, {
          lastConnectedAt: Date.now()
        })
        resolve()
      }
    }

    client.on('ready', () => {
      if (handle.generation !== generation) {
        try { client.end() } catch { /* ignore */ }
        return
      }
      handle.client = client

      client.on('error', (err) => {
        console.warn(`[SSH] Connection ${handle.connectionId} error:`, err.message)
      })

      client.on('close', () => {
        if (handle.generation !== generation) return
        if (currentState(handle) === 'closed') return
        console.warn(`[SSH] Connection ${handle.connectionId} closed unexpectedly`)
        handle.client = null
        handle.state = 'reconnecting'
        scheduleReconnect(handle)
      })

      client.on('end', () => {
        if (handle.generation !== generation) return
        if (currentState(handle) === 'closed') return
        handle.client = null
        handle.state = 'reconnecting'
        scheduleReconnect(handle)
      })

      finish()
    })

    client.on('error', (err) => {
      if (settled) {
        // Post-connect error
        console.warn(`[SSH] Connection ${handle.connectionId} error:`, err.message)
        return
      }
      finish(err)
    })

    client.connect(config)
  })
}

function scheduleReconnect(handle: ConnectionHandle): void {
  if (handle.reconnectTimer) return
  if (handle.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    handle.state = 'failed'
    handle.lastError = `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded`
    return
  }

  const delay = RECONNECT_DELAYS_MS[Math.min(handle.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
  handle.reconnectAttempts += 1
  console.log(`[SSH] Scheduling reconnect for ${handle.connectionId} in ${delay}ms (attempt ${handle.reconnectAttempts})`)

  handle.reconnectTimer = setTimeout(() => {
    handle.reconnectTimer = null
    if (currentState(handle) === 'closed') return

    handle.state = 'reconnecting'
    handle.connectPromise = doConnect(handle)
    handle.connectPromise
      .catch((err) => {
        console.warn(`[SSH] Reconnect failed for ${handle.connectionId}:`, err.message)
      })
      .finally(() => {
        handle.connectPromise = null
      })
  }, delay)
}

// ── Public API ──

/**
 * Borrow a connected SSH client from the pool.
 * The connection is kept alive after fn returns (for reuse by subsequent calls).
 * Idle connections are closed after LINGER_MS.
 */
export async function withSshConnection<T>(
  connectionId: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  if (!getConnectionWithSecrets(connectionId)) {
    throw new Error('Connection not found')
  }
  const handle = acquireHandle(connectionId)
  handle.busyCount += 1

  // Cancel any pending linger timer
  if (handle.lingerTimer) {
    clearTimeout(handle.lingerTimer)
    handle.lingerTimer = null
  }

  try {
    await ensureConnected(handle)
    const client = handle.client
    if (!client) throw new Error(handle.lastError ?? 'Connection is not ready')
    return await fn(client)
  } finally {
    handle.busyCount -= 1
    scheduleLingerIfIdle(handle)
  }
}

/**
 * Borrow a connected SSH client's SFTP session.
 * Reuses the underlying SSH connection from the pool.
 */
export async function withSftp<T>(
  connectionId: string,
  fn: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  return withSshConnection(connectionId, async (client) => {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, s) => {
        if (err) reject(err)
        else resolve(s)
      })
    })
    try {
      return await fn(sftp)
    } finally {
      // SFTP sessions are lightweight wrappers; no explicit close needed.
      // The underlying SSH connection is managed by the pool.
    }
  })
}

/**
 * Close a single SSH connection by connectionId.
 * Used when the user explicitly disconnects.
 */
export function closeConnection(connectionId: string): void {
  const handle = handles.get(connectionId)
  if (handle) {
    closeHandle(handle)
  }
}

/**
 * Close all active SSH connections (used during app shutdown).
 */
export function closeAllSshConnections(): void {
  for (const handle of handles.values()) {
    closeHandle(handle)
  }
}
