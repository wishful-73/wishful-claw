import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { registerMessagePackHandler } from './messagepack-handler'
import { McpManager } from '../mcp/mcp-manager'
import type { McpServerConfig } from '../mcp/mcp-types'

// ── Config persistence (JSON file) ──

const isolatedDataDirectory = process.env.WISHFULCLAW_DATA_DIR?.trim()
const CONFIG_DIR = isolatedDataDirectory || join(homedir(), '.wishful-claw')
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-servers.json')

function readServers(): McpServerConfig[] {
  try {
    if (!existsSync(CONFIG_FILE)) return []
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.error('[MCP] Config read error:', err)
    return []
  }
}

function writeServers(servers: McpServerConfig[]): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(servers, null, 2), 'utf-8')
  } catch (err) {
    console.error('[MCP] Config write error:', err)
  }
}

// ── Singleton McpManager ──

let activeMcpManager: McpManager | null = null

export function getMcpManager(): McpManager {
  if (!activeMcpManager) {
    throw new Error('MCP manager is not initialized. Call registerMcpHandlers() first.')
  }
  return activeMcpManager
}

// ── Types ──

type McpCallToolArgs = {
  serverId: string
  toolName: string
  args: Record<string, unknown>
}

type McpReadResourceArgs = {
  serverId: string
  uri?: string
  resourceName?: string
}

// ── Reverse-request entry points (called from reverse-handler dispatch) ──

export async function executeMcpToolFromMain({
  serverId,
  toolName,
  args
}: McpCallToolArgs): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const result = await getMcpManager().callTool(serverId, toolName, args)
    return { success: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

export async function readMcpResourceFromMain({
  serverId,
  uri,
  resourceName
}: McpReadResourceArgs): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const manager = getMcpManager()
    const resolvedUri =
      uri ??
      manager.getResources(serverId).find((r) => r.name === resourceName)?.uri

    if (!resolvedUri) {
      return {
        success: false,
        error: resourceName
          ? `MCP resource "${resourceName}" not found on server ${serverId}`
          : 'MCP resource uri is required'
      }
    }

    const result = await manager.readResource(serverId, resolvedUri)
    return { success: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

// ── Register IPC handlers ──

export function registerMcpHandlers(): void {
  const mcpManager = new McpManager()
  activeMcpManager = mcpManager

  // List all configured MCP servers
  registerMessagePackHandler<undefined, McpServerConfig[]>('mcp:list', async () => {
    return readServers()
  })

  // Add a new MCP server config
  registerMessagePackHandler<McpServerConfig, { success: boolean; error?: string }>(
    'mcp:add',
    async (config) => {
      const servers = readServers()
      if (servers.some((s) => s.id === config.id)) {
        return { success: false, error: 'Server with this ID already exists' }
      }
      servers.push(config)
      writeServers(servers)
      return { success: true }
    }
  )

  // Update an MCP server config
  registerMessagePackHandler<{ id: string; patch: Partial<McpServerConfig> }, { success: boolean; error?: string }>(
    'mcp:update',
    async ({ id, patch }) => {
      const servers = readServers()
      const idx = servers.findIndex((s) => s.id === id)
      if (idx === -1) return { success: false, error: 'Server not found' }
      servers[idx] = { ...servers[idx], ...patch, id }
      writeServers(servers)
      return { success: true }
    }
  )

  // Remove an MCP server config
  registerMessagePackHandler<string, { success: boolean; error?: string }>(
    'mcp:remove',
    async (id) => {
      await mcpManager.disconnectServer(id)
      const servers = readServers().filter((s) => s.id !== id)
      writeServers(servers)
      return { success: true }
    }
  )

  // Connect to an MCP server
  registerMessagePackHandler<string, { success: boolean; error?: string }>(
    'mcp:connect',
    async (id) => {
      const servers = readServers()
      const config = servers.find((s) => s.id === id)
      if (!config) return { success: false, error: 'Server not found' }

      try {
        await mcpManager.connectServer(config)
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  // Disconnect from an MCP server
  registerMessagePackHandler<string, { success: boolean }>('mcp:disconnect', async (id) => {
    await mcpManager.disconnectServer(id)
    return { success: true }
  })

  // Get server status
  registerMessagePackHandler<string, string>('mcp:status', (id) => {
    return mcpManager.getStatus(id)
  })

  // Get full server info (status + capabilities)
  registerMessagePackHandler<string, unknown>('mcp:server-info', (id) => {
    return mcpManager.getServerInfo(id) ?? { status: 'disconnected' }
  })

  // Get all servers info (config + runtime status + capabilities)
  registerMessagePackHandler<undefined, unknown[]>('mcp:all-servers-info', async () => {
    const servers = readServers()
    return servers.map((config) => {
      const info = mcpManager.getServerInfo(config.id)
      return {
        config,
        status: info?.status ?? 'disconnected',
        tools: info?.tools ?? [],
        resources: info?.resources ?? [],
        prompts: info?.prompts ?? [],
        error: info?.error
      }
    })
  })

  // List tools for a specific server
  registerMessagePackHandler<string, unknown[]>('mcp:list-tools', (id) => {
    return mcpManager.getTools(id)
  })

  // Call a tool on an MCP server (also used as reverse-request handler)
  registerMessagePackHandler<McpCallToolArgs, unknown>('mcp:call-tool', async (args) => {
    return await executeMcpToolFromMain(args)
  })

  // Read a resource from an MCP server (also used as reverse-request handler)
  registerMessagePackHandler<McpReadResourceArgs, unknown>('mcp:read-resource', async (args) => {
    return await readMcpResourceFromMain(args)
  })

  // List resources for a server
  registerMessagePackHandler<string, unknown[]>('mcp:list-resources', (id) => {
    return mcpManager.getResources(id)
  })

  // Get a prompt from an MCP server
  registerMessagePackHandler<
    { serverId: string; promptName: string; args?: Record<string, string> },
    unknown
  >('mcp:get-prompt', async ({ serverId, promptName, args }) => {
    try {
      const result = await mcpManager.getPrompt(serverId, promptName, args)
      return { success: true, result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  // List prompts for a server
  registerMessagePackHandler<string, unknown[]>('mcp:list-prompts', (id) => {
    return mcpManager.getPrompts(id)
  })

  // Refresh capabilities for a server
  registerMessagePackHandler<string, { success: boolean; error?: string }>(
    'mcp:refresh-capabilities',
    async (id) => {
      try {
        await mcpManager.refreshCapabilities(id)
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  console.log('[MCP] Handlers registered — config file:', CONFIG_FILE)
}

/** Disconnect all MCP servers (call on app shutdown) */
export async function shutdownMcp(): Promise<void> {
  if (activeMcpManager) {
    await activeMcpManager.disconnectAll()
  }
}
