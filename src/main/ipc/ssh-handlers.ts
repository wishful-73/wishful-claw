import { randomUUID } from 'crypto'
import { registerMessagePackHandler } from './messagepack-handler'
import {
  initializeSshRepository,
  listConnections,
  getConnectionWithSecrets,
  createConnection,
  updateConnection,
  deleteConnection,
  type SshConnectionMeta,
  type SshConnectionInput,
  type SshConnectionPatch
} from '../ssh/repository'
import { execSshCommand, type SshExecResult } from '../ssh/ssh-exec'
import { testSshConnection } from '../ssh/ssh-test'
import { closeConnection, closeAllSshConnections } from '../ssh/connection-pool'
import { logInfo } from '../lib/logger'

// SSH IPC handlers: connection CRUD + exec + group stubs + misc.

let sshInitialized = false

async function ensureSshInitialized(): Promise<void> {
  if (sshInitialized) return
  sshInitialized = true
  try {
    await initializeSshRepository()
    logInfo('ipc', '[SSH Handlers] Repository initialized')
  } catch (err) {
    console.warn('[SSH Handlers] Repository initialization failed:', err)
    sshInitialized = false
    throw err
  }
}

function toMeta(meta: SshConnectionMeta, password?: string | null, passphrase?: string | null): Record<string, unknown> {
  // Returns snake_case fields to match SshConnectionRow / rowToConnection in frontend
  return {
    id: meta.id,
    group_id: meta.groupId,
    name: meta.name,
    host: meta.host,
    port: meta.port,
    username: meta.username,
    auth_type: meta.authType,
    private_key_path: meta.privateKeyPath,
    startup_command: meta.startupCommand,
    default_directory: meta.defaultDirectory,
    proxy_jump: null,
    keep_alive_interval: meta.keepAliveInterval,
    sort_order: meta.sortOrder,
    last_connected_at: meta.lastConnectedAt,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
    has_password: meta.hasPassword,
    has_passphrase: meta.hasPassphrase,
    password: password ?? null,
    passphrase: passphrase ?? null
  }
}

export function registerSshHandlers(): void {
  // ── Connection CRUD ──

  registerMessagePackHandler('ssh:connection:list', async () => {
    await ensureSshInitialized()
    return listConnections().map((meta) => {
      const withSecrets = getConnectionWithSecrets(meta.id)
      return toMeta(meta, withSecrets?.password, withSecrets?.passphrase)
    })
  })

  registerMessagePackHandler('ssh:connection:create', async (args) => {
    await ensureSshInitialized()
    const input = args as SshConnectionInput
    if (!input.id) input.id = randomUUID()
    await createConnection(input)
    const withSecrets = getConnectionWithSecrets(input.id)
    return withSecrets ? toMeta(withSecrets, withSecrets.password, withSecrets.passphrase) : null
  })

  registerMessagePackHandler('ssh:connection:update', async (args) => {
    await ensureSshInitialized()
    const { id, ...patch } = args as { id: string } & SshConnectionPatch
    await updateConnection(id, patch)
    const withSecrets = getConnectionWithSecrets(id)
    return withSecrets ? toMeta(withSecrets, withSecrets.password, withSecrets.passphrase) : null
  })

  registerMessagePackHandler('ssh:connection:delete', async (args) => {
    await ensureSshInitialized()
    const { id } = args as { id: string }
    await deleteConnection(id)
    return { success: true }
  })

  registerMessagePackHandler('ssh:connection:test', async (args) => {
    await ensureSshInitialized()
    const { id } = args as { id: string }
    const result = await testSshConnection(id)
    return result
  })

  // ── Exec ──

  registerMessagePackHandler('ssh:exec', async (args) => {
    await ensureSshInitialized()
    const { connectionId, command, timeoutMs } = args as {
      connectionId: string
      command: string
      timeoutMs?: number
    }
    if (!connectionId || !command) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'connectionId and command are required',
        error: 'connectionId and command are required'
      } as SshExecResult
    }
    return await execSshCommand(connectionId, command, timeoutMs ?? 60_000)
  })

  // ── Connect / Disconnect ──

  registerMessagePackHandler('ssh:connect', async (args) => {
    await ensureSshInitialized()
    const { connectionId } = args as { connectionId: string }
    const result = await testSshConnection(connectionId)
    return result
  })

  registerMessagePackHandler('ssh:disconnect', async (args) => {
    const { connectionId } = args as { connectionId: string }
    closeConnection(connectionId)
    return { success: true }
  })

  // ── Session list (stub — no interactive terminal sessions) ──

  registerMessagePackHandler('ssh:session:list', async () => {
    return []
  })

  // ── Group stubs (groups not implemented — return empty) ──

  registerMessagePackHandler('ssh:group:list', async () => {
    return []
  })

  registerMessagePackHandler('ssh:group:create', async () => {
    return { success: false, error: 'SSH groups not implemented' }
  })

  registerMessagePackHandler('ssh:group:update', async () => {
    return { success: false, error: 'SSH groups not implemented' }
  })

  registerMessagePackHandler('ssh:group:delete', async () => {
    return { success: false, error: 'SSH groups not implemented' }
  })

  // ── Auth stubs ──

  registerMessagePackHandler('ssh:auth:install-public-key', async () => {
    return { success: false, error: 'Public key installation not implemented' }
  })

  // ── Import / Export stubs ──

  registerMessagePackHandler('ssh:export', async () => {
    return { connections: [] }
  })

  registerMessagePackHandler('ssh:import:preview', async () => {
    return { connections: [], groups: [] }
  })

  registerMessagePackHandler('ssh:import:apply', async () => {
    return { success: false, error: 'SSH import not implemented' }
  })

  // ── Terminal session stubs (interactive SSH terminal not implemented) ──

  registerMessagePackHandler('ssh:output:buffer', async () => {
    return { data: '' }
  })

  registerMessagePackHandler('ssh:data', async () => {
    return { success: false, error: 'Interactive SSH terminal not implemented' }
  })

  registerMessagePackHandler('ssh:resize', async () => {
    return { success: false }
  })

  registerMessagePackHandler('ssh:output', async () => {
    return { data: '' }
  })

  registerMessagePackHandler('ssh:status', async () => {
    return { status: 'disconnected' }
  })

  registerMessagePackHandler('ssh:connect:log', async () => {
    return { entries: [] }
  })

  registerMessagePackHandler('ssh:config:changed', async () => {
    return { success: true }
  })

  // ── SFTP upload/transfer stubs ──

  registerMessagePackHandler('ssh:fs:zip-dir', async () => {
    return { success: false, error: 'SSH zip-dir not implemented' }
  })

  registerMessagePackHandler('ssh:fs:download', async () => {
    return { success: false, error: 'SSH download not implemented' }
  })

  registerMessagePackHandler('ssh:fs:upload:start', async () => {
    return { success: false, error: 'SSH upload not implemented' }
  })

  registerMessagePackHandler('ssh:fs:upload:cancel', async () => {
    return { success: true }
  })

  registerMessagePackHandler('ssh:fs:transfer:start', async () => {
    return { success: false, error: 'SSH transfer not implemented' }
  })

  registerMessagePackHandler('ssh:fs:transfer:cancel', async () => {
    return { success: true }
  })
}

export function cleanupSshHandlers(): void {
  closeAllSshConnections()
}
