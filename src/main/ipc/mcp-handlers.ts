import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { resolveDataDir } from '../lib/data-dir'
import { resolveCodeGraphEnginePath } from '../lib/codegraph-assets'
import { registerMessagePackHandler } from './messagepack-handler'
import { McpManager } from '../mcp/mcp-manager'
import type { McpServerConfig } from '../mcp/mcp-types'
import { logInfo } from '../lib/logger'

// ── Config persistence (JSON file) ──

const CONFIG_DIR = resolveDataDir()
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-servers.json')

/**
 * 内置代码图谱 MCP server 的固定 id —— 用户不可删除，随插件资产存在而出现。
 *
 * **不加冒号是有意的**：C# 侧的 MCP 工具名拼成 `mcp__{serverId}__{tool}`，而 OpenAI 与
 * Anthropic 的函数名只接受 `[a-zA-Z0-9_-]`。冒号不会在本轮炸掉（MCP 工具不逐个注册成
 * function，只经 `use_capability` 代理），但 capability_id 会变成
 * `mcp-tool:builtin:codegraph/xxx` 这种双冒号怪串，且一旦以后改成直注册就是确定的 400。
 */
export const BUILTIN_CODEGRAPH_SERVER_ID = 'builtin-codegraph'

/** 改名前的 id，只用于迁移存量配置。 */
const LEGACY_BUILTIN_CODEGRAPH_SERVER_ID = 'builtin:codegraph'

/**
 * 内置 server（方案 B，2026-11-03）：代码图谱引擎是独立 AOT exe（MCP stdio server），
 * 由插件资产下载落盘。装好后自动作为内置 MCP server 出现，卸掉即消失 ——
 * 主仓这里只有一条配置，引擎本身完全在独立仓。
 *
 * 用户对内置项唯一可改的是启用开关，取值以持久化里那条覆盖记录为准。
 */
function builtinServers(persisted: McpServerConfig[]): McpServerConfig[] {
  const engine = resolveCodeGraphEnginePath()
  if (!existsSync(engine)) return []
  const override = persisted.find((s) => s.id === BUILTIN_CODEGRAPH_SERVER_ID)
  return [
    {
      id: BUILTIN_CODEGRAPH_SERVER_ID,
      name: '代码图谱',
      description: '代码图谱引擎（符号、引用与影响分析）',
      enabled: override?.enabled ?? true,
      transport: 'stdio',
      command: engine,
      args: [],
      createdAt: 0
    }
  ]
}

/** 只读持久化那份配置（用户自己加的 server + 内置项的开关覆盖记录）。 */
function loadPersistedServers(): McpServerConfig[] {
  try {
    if (!existsSync(CONFIG_FILE)) return []
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    if (!Array.isArray(data)) return []
    // id 从 `builtin:codegraph` 改成 `builtin-codegraph` 之前存过开关记录的，就地改名 ——
    // 否则那条记录会被当成用户自建的普通 server，面板上多出一个可删的重复项。
    let migrated = false
    const servers = data.map((server: McpServerConfig) => {
      if (server?.id !== LEGACY_BUILTIN_CODEGRAPH_SERVER_ID) return server
      migrated = true
      return { ...server, id: BUILTIN_CODEGRAPH_SERVER_ID }
    })
    if (migrated) writeServers(servers)
    return servers
  } catch (err) {
    console.error('[MCP] Config read error:', err)
    return []
  }
}

/** 持久化配置 + 内置配置。内置的排在前面，同 id 时以内置为准。 */
function readServers(): McpServerConfig[] {
  const persisted = loadPersistedServers()
  const builtins = builtinServers(persisted)
  const builtinIds = new Set(builtins.map((s) => s.id))
  // 内置项的开关覆盖记录永远只经 builtinServers() 消费，绝不能当用户自建 server 漏出去。
  // 不能只靠 builtinIds 过滤：引擎没装时 builtinServers() 直接返回 []，集合为空，
  // 那条 `{ id: 'builtin-codegraph', command: '' }` 就会以普通条目出现在面板里 ——
  // 没有内置徽章、可删、点连接是空 command。
  return [
    ...builtins,
    ...persisted.filter(
      (s) => s.id !== BUILTIN_CODEGRAPH_SERVER_ID && !builtinIds.has(s.id)
    )
  ]
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

  // 内置 server（代码图谱）装好即自动连上：引擎文件存在才出现，连接失败只记日志，
  // 不影响用户自己配的 server。
  void (async () => {
    for (const config of builtinServers(loadPersistedServers())) {
      try {
        await mcpManager.connectServer(config)
      } catch (err) {
        console.error(`[MCP] Builtin server ${config.id} connect failed:`, err)
      }
    }
  })()

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
      if (id === BUILTIN_CODEGRAPH_SERVER_ID) {
        // 内置项只持久化启用开关这一项覆盖；命令路径由插件资产决定，不写死进配置文件。
        const persisted = loadPersistedServers()
        const rest = persisted.filter((s) => s.id !== id)
        const enabled =
          patch.enabled ?? builtinServers(persisted).find((s) => s.id === id)?.enabled ?? true
        writeServers([
          ...rest,
          {
            id,
            name: '代码图谱',
            description: '',
            enabled,
            transport: 'stdio',
            command: '',
            args: [],
            createdAt: 0
          }
        ])
        return { success: true }
      }
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
      // 内置 server 随插件资产存亡，不提供删除 —— 卸插件走插件面板的「移除」。
      if (id === BUILTIN_CODEGRAPH_SERVER_ID) {
        return { success: false, error: 'Builtin server cannot be removed' }
      }
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

  logInfo('ipc', `[MCP] Handlers registered — config file: ${CONFIG_FILE}`)
}

/**
 * 只断开内置 codegraph server，不重连。
 *
 * 卸载 / 重装前必须先调这个：`codegraph.exe` 是 MCP server 的 stdio 子进程，进程活着时
 * Windows 会锁住 exe 与 dll，直接删目录就是 EPERM（2026-11-03 真机报的）。
 */
export async function disconnectBuiltinCodeGraph(): Promise<void> {
  if (!activeMcpManager) return
  await activeMcpManager.disconnectServer(BUILTIN_CODEGRAPH_SERVER_ID).catch(() => undefined)
}

/**
 * 装/卸代码图谱插件后刷新内置 server 连接：装好就拉起，卸掉就断开。
 * 用户自己配的 server 不受影响。
 */
export async function reconnectBuiltinCodeGraph(): Promise<void> {
  if (!activeMcpManager) return
  await disconnectBuiltinCodeGraph()
  const [config] = builtinServers(loadPersistedServers())
  if (!config) return
  try {
    await activeMcpManager.connectServer(config)
  } catch (err) {
    console.error('[MCP] Builtin codegraph reconnect failed:', err)
  }
}

/** Disconnect all MCP servers (call on app shutdown) */
export async function shutdownMcp(): Promise<void> {
  if (activeMcpManager) {
    await activeMcpManager.disconnectAll()
  }
}
