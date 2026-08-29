import { safeStorage } from 'electron'
import {
  listSshConnections as daoListConnections,
  createSshConnection as daoCreateConnection,
  updateSshConnection as daoUpdateConnection,
  deleteSshConnection as daoDeleteConnection,
  type SshConnectionRow
} from '../db/ssh-dao'

// SSH config repository: the only owner of saved connections and their
// secrets. Secrets are encrypted here with Electron safeStorage before they
// leave the main process, so the sidecar and the database only ever see
// ciphertext. Decryption happens on demand (connect / native payload injection /
// renderer read-back). Note: decrypted secrets are intentionally returned to the
// renderer for the connection-edit scenario — this is a local single-user
// product and plaintext display in the edit form is by design (audit M37).

export type SshAuthType = 'password' | 'privateKey' | 'agent'

export interface SshConnectionMeta {
  id: string
  groupId: string | null
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  privateKeyPath: string | null
  startupCommand: string | null
  defaultDirectory: string | null
  keepAliveInterval: number
  sortOrder: number
  lastConnectedAt: number | null
  createdAt: number
  updatedAt: number
  hasPassword: boolean
  hasPassphrase: boolean
}

export interface SshConnectionWithSecrets extends SshConnectionMeta {
  password: string | null
  passphrase: string | null
}

export interface SshConnectionInput {
  id: string
  groupId?: string | null
  name: string
  host: string
  port?: number
  username: string
  authType?: SshAuthType
  password?: string | null
  privateKeyPath?: string | null
  passphrase?: string | null
  startupCommand?: string | null
  defaultDirectory?: string | null
  keepAliveInterval?: number
  sortOrder?: number
}

export type SshConnectionPatch = Partial<Omit<SshConnectionInput, 'id'>> & {
  lastConnectedAt?: number | null
}

// ── Secret codec ──

const SECRET_SAFE_PREFIX = 'v1:safe:'
const SECRET_PLAIN_PREFIX = 'v1:plain:'

export function isSecretEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encodeSecret(plain: string): string {
  if (isSecretEncryptionAvailable()) {
    return SECRET_SAFE_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  console.warn('[SSH Repository] OS secret encryption unavailable, falling back to plain storage')
  return SECRET_PLAIN_PREFIX + Buffer.from(plain, 'utf-8').toString('base64')
}

function decodeSecret(stored: string | null): string | null {
  if (!stored) return null
  if (stored.startsWith(SECRET_SAFE_PREFIX)) {
    try {
      const payload = Buffer.from(stored.slice(SECRET_SAFE_PREFIX.length), 'base64')
      return safeStorage.decryptString(payload)
    } catch (err) {
      console.warn('[SSH Repository] Failed to decrypt stored secret:', err)
      return null
    }
  }
  if (stored.startsWith(SECRET_PLAIN_PREFIX)) {
    return Buffer.from(stored.slice(SECRET_PLAIN_PREFIX.length), 'base64').toString('utf-8')
  }
  return stored
}

// ── Cache ──

interface CachedConnection {
  meta: SshConnectionMeta
  encryptedPassword: string | null
  encryptedPassphrase: string | null
}

let connectionsCache = new Map<string, CachedConnection>()
let initializePromise: Promise<void> | null = null

function toAuthType(value: string | null | undefined): SshAuthType {
  return value === 'privateKey' || value === 'agent' || value === 'password' ? value : 'password'
}

function fromConnectionRow(row: SshConnectionRow): CachedConnection {
  return {
    meta: {
      id: row.id,
      groupId: row.group_id ?? null,
      name: row.name,
      host: row.host,
      port: row.port ?? 22,
      username: row.username,
      authType: toAuthType(row.auth_type),
      privateKeyPath: row.private_key_path ?? null,
      startupCommand: row.startup_command ?? null,
      defaultDirectory: row.default_directory ?? null,
      keepAliveInterval: row.keep_alive_interval ?? 60,
      sortOrder: row.sort_order ?? 0,
      lastConnectedAt: row.last_connected_at ?? null,
      createdAt: row.created_at ?? 0,
      updatedAt: row.updated_at ?? 0,
      hasPassword: Boolean(row.encrypted_password),
      hasPassphrase: Boolean(row.encrypted_passphrase)
    },
    encryptedPassword: row.encrypted_password ?? null,
    encryptedPassphrase: row.encrypted_passphrase ?? null
  }
}

async function reload(): Promise<void> {
  const connectionRows = await daoListConnections()
  const next = new Map<string, CachedConnection>()
  for (const row of connectionRows) {
    const cached = fromConnectionRow(row)
    next.set(cached.meta.id, cached)
  }
  connectionsCache = next
}

// ── Lifecycle ──

export async function initializeSshRepository(): Promise<void> {
  initializePromise ??= (async () => {
    await reload()
  })().catch((err) => {
    initializePromise = null
    throw err
  })
  await initializePromise
}

// ── Reads (sync, from cache) ──

export function listConnections(): SshConnectionMeta[] {
  return [...connectionsCache.values()]
    .map((cached) => ({ ...cached.meta }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getConnectionMeta(id: string): SshConnectionMeta | undefined {
  const cached = connectionsCache.get(id)
  return cached ? { ...cached.meta } : undefined
}

export function getConnectionWithSecrets(id: string): SshConnectionWithSecrets | undefined {
  const cached = connectionsCache.get(id)
  if (!cached) return undefined
  return {
    ...cached.meta,
    password: decodeSecret(cached.encryptedPassword),
    passphrase: decodeSecret(cached.encryptedPassphrase)
  }
}

// ── Mutations ──

export async function createConnection(input: SshConnectionInput): Promise<void> {
  const now = Date.now()
  await daoCreateConnection({
    id: input.id,
    groupId: input.groupId ?? undefined,
    name: input.name,
    host: input.host,
    port: input.port ?? 22,
    username: input.username,
    authType: input.authType ?? 'password',
    encryptedPassword: input.password ? encodeSecret(input.password) : undefined,
    privateKeyPath: input.privateKeyPath ?? undefined,
    encryptedPassphrase: input.passphrase ? encodeSecret(input.passphrase) : undefined,
    startupCommand: input.startupCommand ?? undefined,
    defaultDirectory: input.defaultDirectory ?? undefined,
    keepAliveInterval: input.keepAliveInterval ?? 60,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now
  })
  await reload()
}

export async function updateConnection(id: string, patch: SshConnectionPatch): Promise<void> {
  const daoPatch: Parameters<typeof daoUpdateConnection>[1] = { updatedAt: Date.now() }
  if (patch.groupId !== undefined) daoPatch.groupId = patch.groupId
  if (patch.name !== undefined) daoPatch.name = patch.name
  if (patch.host !== undefined) daoPatch.host = patch.host
  if (patch.port !== undefined) daoPatch.port = patch.port
  if (patch.username !== undefined) daoPatch.username = patch.username
  if (patch.authType !== undefined) daoPatch.authType = patch.authType
  if (patch.password !== undefined) {
    daoPatch.encryptedPassword = patch.password ? encodeSecret(patch.password) : null
  }
  if (patch.privateKeyPath !== undefined) daoPatch.privateKeyPath = patch.privateKeyPath
  if (patch.passphrase !== undefined) {
    daoPatch.encryptedPassphrase = patch.passphrase ? encodeSecret(patch.passphrase) : null
  }
  if (patch.startupCommand !== undefined) daoPatch.startupCommand = patch.startupCommand
  if (patch.defaultDirectory !== undefined) daoPatch.defaultDirectory = patch.defaultDirectory
  if (patch.keepAliveInterval !== undefined) daoPatch.keepAliveInterval = patch.keepAliveInterval
  if (patch.sortOrder !== undefined) daoPatch.sortOrder = patch.sortOrder
  if (patch.lastConnectedAt !== undefined) daoPatch.lastConnectedAt = patch.lastConnectedAt
  await daoUpdateConnection(id, daoPatch)
  await reload()
}

export async function deleteConnection(id: string): Promise<void> {
  await daoDeleteConnection(id)
  await reload()
}
