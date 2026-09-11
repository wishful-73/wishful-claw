import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveDataDir } from '../lib/data-dir'
import { getNativeWorker } from '../lib/native-worker'
import type { McpManager } from '../mcp/mcp-manager'
import type { McpServerConfig } from '../mcp/mcp-types'
import type { ExtensionInstance, ExtensionManifest } from '../../shared/extension-types'
import { nativeExtensionRequest } from './extension-native-bridge'

/**
 * Extension resource synchronization.
 * Ported from WishfulClaw extension-plugin-sync.ts, simplified for wishful-claw:
 * - Skills/agents/commands sync omitted (those modules don't exist yet)
 * - MCP server sync retained
 * - Data dir: ~/.wishful-claw
 */

const WISHFUL_CLAW_DIR = resolveDataDir()
const SYNC_STATE_PATH = path.join(WISHFUL_CLAW_DIR, 'extensions-sync.json')
const MCP_CONFIG_TIMEOUT_MS = 60_000

interface ExtensionSyncRecord {
  version: string
  syncedAt: number
  mcpServerIds: string[]
}

type ExtensionSyncState = Record<string, ExtensionSyncRecord>

export interface ExtensionAggregateInfo {
  declared: {
    mcpServers: number
  }
  synced: {
    mcpServers: string[]
    syncedAt: number
  } | null
}

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function warn(warnings: string[], message: string): void {
  warnings.push(message)
  console.warn(`[ExtensionSync] ${message}`)
}

function emptyRecord(version: string): ExtensionSyncRecord {
  return { version, syncedAt: 0, mcpServerIds: [] }
}

async function readSyncState(): Promise<ExtensionSyncState> {
  try {
    const raw = await fs.readFile(SYNC_STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ExtensionSyncState) : {}
  } catch {
    return {}
  }
}

async function writeSyncState(state: ExtensionSyncState): Promise<void> {
  await fs.mkdir(WISHFUL_CLAW_DIR, { recursive: true })
  await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

async function resolveExtensionRoot(id: string): Promise<string | null> {
  try {
    const result = await nativeExtensionRequest<{ success: boolean; path?: string }>(
      'extension/resolve-path',
      { id }
    )
    return result.success && result.path ? result.path : null
  } catch {
    return null
  }
}

async function readRawManifest(extensionRoot: string): Promise<ExtensionManifest | null> {
  try {
    const raw = await fs.readFile(path.join(extensionRoot, 'extension.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return parsed as ExtensionManifest
  } catch {
    return null
  }
}

function hasAggregateResources(manifest: ExtensionManifest): boolean {
  return Boolean(
    manifest.mcpServers && Object.keys(manifest.mcpServers).length > 0
  )
}

function resolveInsideRoot(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative)
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
}

// ── MCP server sync ──

function extensionMcpServerId(extensionId: string, serverName: string): string {
  const safeName = serverName.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `ext-${extensionId}-${safeName}`
}

async function syncMcpServers(
  manifest: ExtensionManifest,
  root: string,
  previous: string[],
  mcpManager: McpManager | null,
  warnings: string[]
): Promise<string[]> {
  const servers = Object.entries(manifest.mcpServers ?? {})
  const existing = await getNativeWorker()
    .request<McpServerConfig[]>('mcp/config-list', {}, MCP_CONFIG_TIMEOUT_MS)
    .catch(() => [] as McpServerConfig[])
  const existingIds = new Set(existing.map((server) => server.id))
  const synced: string[] = []

  for (const [serverName, definition] of servers) {
    const id = extensionMcpServerId(manifest.id, serverName)
    const config: McpServerConfig = {
      id,
      name: `${manifest.name}: ${serverName}`,
      enabled: true,
      transport: definition.transport ?? (definition.url ? 'streamable-http' : 'stdio'),
      command: definition.command,
      args: definition.args,
      env: definition.env,
      cwd: definition.cwd ? (resolveInsideRoot(root, definition.cwd) ?? root) : root,
      url: definition.url,
      headers: definition.headers,
      createdAt: Date.now(),
      description: definition.description ?? `Provided by extension ${manifest.id}`
    }

    const result = existingIds.has(id)
      ? await getNativeWorker().request<{ success: boolean; error?: string }>(
          'mcp/config-update',
          { id, patch: config },
          MCP_CONFIG_TIMEOUT_MS
        )
      : await getNativeWorker().request<{ success: boolean; error?: string }>(
          'mcp/config-add',
          config,
          MCP_CONFIG_TIMEOUT_MS
        )
    if (!result.success) {
      warn(warnings, `${manifest.id}: MCP server "${serverName}" sync failed: ${result.error}`)
      continue
    }
    if (mcpManager?.isConnected(id)) {
      await mcpManager.disconnectServer(id)
    }
    synced.push(id)
  }

  for (const stale of previous.filter((id) => !synced.includes(id))) {
    await removeMcpServer(stale, mcpManager)
  }
  return synced
}

async function removeMcpServer(id: string, mcpManager: McpManager | null): Promise<void> {
  if (mcpManager) await mcpManager.disconnectServer(id).catch(() => undefined)
  await getNativeWorker()
    .request('mcp/config-remove', id, MCP_CONFIG_TIMEOUT_MS)
    .catch(() => undefined)
}

// ── Public lifecycle API ──

async function syncExtensionInternal(
  id: string,
  mcpManager: McpManager | null,
  force: boolean
): Promise<string[]> {
  const warnings: string[] = []
  const root = await resolveExtensionRoot(id)
  if (!root) return warnings
  const manifest = await readRawManifest(root)
  if (!manifest) return warnings

  const state = await readSyncState()
  const previous = state[id]
  if (!hasAggregateResources(manifest)) {
    if (previous) await unsyncExtensionInternal(id, mcpManager)
    return warnings
  }
  if (!force && previous && previous.version === manifest.version && previous.syncedAt > 0) {
    return warnings
  }

  const record = previous ?? emptyRecord(manifest.version)
  record.version = manifest.version

  try {
    record.mcpServerIds = await syncMcpServers(
      manifest,
      root,
      record.mcpServerIds,
      mcpManager,
      warnings
    )
  } catch (err) {
    warn(warnings, `${id}: MCP sync failed: ${err}`)
  }

  record.syncedAt = Date.now()
  state[id] = record
  await writeSyncState(state)
  return warnings
}

async function unsyncExtensionInternal(id: string, mcpManager: McpManager | null): Promise<void> {
  const state = await readSyncState()
  const record = state[id]
  if (!record) return

  for (const serverId of record.mcpServerIds) {
    await removeMcpServer(serverId, mcpManager)
  }

  delete state[id]
  await writeSyncState(state)
}

export function syncExtensionResources(
  id: string,
  mcpManager: McpManager | null
): Promise<string[]> {
  return enqueue(() =>
    syncExtensionInternal(id, mcpManager, true).catch((err) => {
      console.error(`[ExtensionSync] sync failed for ${id}:`, err)
      return [`${id}: sync failed: ${err}`]
    })
  )
}

export async function getExtensionAggregateInfo(id: string): Promise<ExtensionAggregateInfo> {
  const empty: ExtensionAggregateInfo = {
    declared: { mcpServers: 0 },
    synced: null
  }
  const root = await resolveExtensionRoot(id)
  if (!root) return empty
  const manifest = await readRawManifest(root)
  if (!manifest) return empty

  const record = (await readSyncState())[id]
  return {
    declared: {
      mcpServers: Object.keys(manifest.mcpServers ?? {}).length
    },
    synced: record
      ? {
          mcpServers: record.mcpServerIds,
          syncedAt: record.syncedAt
        }
      : null
  }
}

export function unsyncExtensionResources(id: string, mcpManager: McpManager | null): Promise<void> {
  return enqueue(() =>
    unsyncExtensionInternal(id, mcpManager).catch((err) => {
      console.error(`[ExtensionSync] unsync failed for ${id}:`, err)
    })
  )
}

export function reconcileExtensionSync(mcpManager: McpManager | null): Promise<void> {
  return enqueue(async () => {
    let extensions: ExtensionInstance[] = []
    try {
      extensions = await nativeExtensionRequest<ExtensionInstance[]>('extension/list')
    } catch (err) {
      console.warn('[ExtensionSync] reconcile skipped, extension list unavailable:', err)
      return
    }

    const known = new Map(extensions.map((extension) => [extension.id, extension]))
    const state = await readSyncState()

    for (const staleId of Object.keys(state).filter((id) => !known.has(id))) {
      await unsyncExtensionInternal(staleId, mcpManager).catch((err) => {
        console.warn(`[ExtensionSync] cleanup failed for removed extension ${staleId}:`, err)
      })
    }

    for (const extension of extensions) {
      if (extension.enabled) {
        await syncExtensionInternal(extension.id, mcpManager, false).catch((err) => {
          console.warn(`[ExtensionSync] reconcile sync failed for ${extension.id}:`, err)
        })
      } else if (state[extension.id]) {
        await unsyncExtensionInternal(extension.id, mcpManager).catch((err) => {
          console.warn(`[ExtensionSync] reconcile unsync failed for ${extension.id}:`, err)
        })
      }
    }
  })
}
