/**
 * Plugin command handlers — extracted from plugin-commands.ts.
 *
 * Each handler receives CommandContext + raw args string and returns a CommandResult.
 */
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { app } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import { readChannelPlugins, readGlobalChannelSettings } from './channel-config-store'
import type { ChannelManager } from './channel-manager'
import type {
  ChannelIncomingMessageData,
  ChannelInstance,
  GlobalChannelSettings
} from './channel-types'

// ── Shared Types (re-exported from plugin-commands) ──

export interface CommandContext {
  pluginId: string
  pluginType: string
  chatId: string
  data: ChannelIncomingMessageData
  sessionId: string | undefined
  pluginWorkDir: string
  pluginManager: ChannelManager
}

export interface CommandResult {
  handled: boolean
  reply?: string
  rewriteContent?: string
}

export type CommandHandler = (
  ctx: CommandContext,
  args: string
) => CommandResult | Promise<CommandResult>

// ── Native Result Interfaces ──

interface NativeMessageCompactResult {
  success: boolean
  totalMessages: number
  compacted: number
  error?: string | null
}

interface NativeSessionResetResult {
  success: boolean
  deletedMessages: number
  updatedAt: number
  error?: string | null
}

interface NativeSessionStatusResult {
  success: boolean
  found: boolean
  title?: string | null
  createdAt?: number | null
  updatedAt?: number | null
  messageCount: number
  error?: string | null
}

export interface NativeMessageUsageStatsResult {
  success: boolean
  hasUsage: boolean
  totalInput: number
  totalOutput: number
  totalCacheCreation: number
  totalCacheRead: number
  totalReasoning: number
  totalDurationMs: number
  requestCount: number
  assistantReplies: number
  firstCreatedAt?: number | null
  lastCreatedAt?: number | null
  error?: string | null
}

// ── Workspace Memory Template Helpers ──

const WORKSPACE_MEMORY_TEMPLATE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md'] as const
export type WorkspaceMemoryTemplateFile = (typeof WORKSPACE_MEMORY_TEMPLATE_FILES)[number]

function getBundledAgentTemplatesDir(): string {
  const isDev = !app.isPackaged
  if (isDev) {
    return path.join(app.getAppPath(), 'resources', 'agents', 'templates')
  }

  const unpackedDir = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'resources',
    'agents',
    'templates'
  )
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir
  }

  return path.join(process.resourcesPath, 'resources', 'agents', 'templates')
}

function initializeWorkspaceMemoryFiles(workDir: string): {
  created: WorkspaceMemoryTemplateFile[]
  existing: WorkspaceMemoryTemplateFile[]
} {
  const bundledDir = getBundledAgentTemplatesDir()
  const created: WorkspaceMemoryTemplateFile[] = []
  const existing: WorkspaceMemoryTemplateFile[] = []

  for (const filename of WORKSPACE_MEMORY_TEMPLATE_FILES) {
    const targetPath = path.join(workDir, filename)
    if (fs.existsSync(targetPath)) {
      existing.push(filename)
      continue
    }

    const templatePath = path.join(bundledDir, filename)
    if (!fs.existsSync(templatePath)) {
      console.warn(`[PluginCommand] Missing bundled template: ${templatePath}`)
      continue
    }

    fs.copyFileSync(templatePath, targetPath)
    created.push(filename)
  }

  return { created, existing }
}

function tokenizeSlashCommandArguments(text: string): string[] {
  const normalized = text.trim()
  if (!normalized) return []

  const args: string[] = []
  let current = ''
  let quoteChar: '"' | "'" | null = null
  let escaping = false
  let tokenStarted = false

  for (const char of normalized) {
    if (escaping) {
      current += char
      escaping = false
      tokenStarted = true
      continue
    }

    if (char === '\\') {
      escaping = true
      tokenStarted = true
      continue
    }

    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = null
      } else {
        current += char
      }
      tokenStarted = true
      continue
    }

    if (char === '"' || char === "'") {
      quoteChar = char
      tokenStarted = true
      continue
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    current += char
    tokenStarted = true
  }

  if (escaping) {
    current += '\\'
  }

  if (tokenStarted) {
    args.push(current)
  }

  return args
}

// ── Command Handlers ──

export function handleHelp(ctx: CommandContext, args: string): CommandResult {
  void ctx
  void args
  const helpText = [
    '📋 Available Commands',
    '',
    '/help      — Show this help message',
    '/new       — Clear current session, start new conversation',
    '/init [args...] — Initialize AGENTS/SOUL/USER/MEMORY and analyze project to update AGENTS.md',
    '/status    — Show current status information',
    '/stats     — Show token usage statistics',
    '/compress  — Compress context (clear stale tool results and thinking blocks)',
    '',
    '💡 Use @bot + command in group chats, e.g. "@Bot /help"',
    'Send a message directly to chat with the AI assistant.'
  ].join('\n')

  return { handled: true, reply: helpText }
}

export async function handleNew(ctx: CommandContext, args: string): Promise<CommandResult> {
  void args
  if (!ctx.sessionId) {
    return { handled: true, reply: 'No active session found.' }
  }

  try {
    const result = await getNativeWorker().request<NativeSessionResetResult>(
      'db/session-reset-conversation',
      { sessionId: ctx.sessionId },
      120_000
    )
    if (!result.success) {
      throw new Error(result.error || 'Native session reset failed')
    }

    console.log(
      `[PluginCommand] Cleared session ${ctx.sessionId}, removed ${result.deletedMessages} messages`
    )
    return {
      handled: true,
      reply: '✅ Session cleared. Starting fresh.'
    }
  } catch (err) {
    console.error('[PluginCommand] Failed to clear session:', err)
    return {
      handled: true,
      reply: '❌ Failed to clear session. Please try again.'
    }
  }
}

export function handleInit(ctx: CommandContext, args: string): CommandResult {
  const agentsPath = path.join(ctx.pluginWorkDir, 'AGENTS.md')
  const parsedArgs = tokenizeSlashCommandArguments(args)

  if (!fs.existsSync(ctx.pluginWorkDir)) {
    fs.mkdirSync(ctx.pluginWorkDir, { recursive: true })
  }

  const initialization = initializeWorkspaceMemoryFiles(ctx.pluginWorkDir)
  const hasExistingAgents = initialization.existing.includes('AGENTS.md')

  const initPrompt = buildInitAgentPrompt({
    workDir: ctx.pluginWorkDir,
    agentsPath,
    hasExistingAgents,
    createdFiles: initialization.created,
    existingFiles: initialization.existing,
    rawArgs: args,
    parsedArgs
  })

  const statusLine = [
    initialization.created.length > 0
      ? `🧩 Initialized template files: ${initialization.created.join(', ')}`
      : '🧩 Template files already exist, skipping initialization.',
    hasExistingAgents
      ? '🔄 Analyzing project and updating AGENTS.md...'
      : '🔍 Analyzing project structure, generating AGENTS.md...'
  ].join('\n')

  return {
    handled: false,
    reply: `${statusLine}\n${hasExistingAgents ? 'Analyzing project and updating AGENTS.md...' : 'Analyzing project structure to generate AGENTS.md...'}`,
    rewriteContent: initPrompt
  }
}

export async function handleStatus(ctx: CommandContext, args: string): Promise<CommandResult> {
  void args
  const lines: string[] = ['📊 Status']

  let pluginInstance: ChannelInstance | undefined
  try {
    const plugins = await readChannelPlugins()
    pluginInstance = plugins.find((p) => p.id === ctx.pluginId)
  } catch {
    /* ignore */
  }

  lines.push('')
  lines.push(`🔌 Plugin: ${pluginInstance?.name ?? ctx.pluginId}`)
  lines.push(`📡 Type: ${ctx.pluginType}`)
  lines.push(`🆔 ID: ${ctx.pluginId}`)

  const status = ctx.pluginManager.getStatus(ctx.pluginId)
  lines.push(
    `⚡ Status: ${status === 'running' ? 'Running ✅' : status === 'error' ? 'Error ❌' : 'Stopped ⏹'}`
  )

  lines.push('')
  if (pluginInstance?.providerId) {
    lines.push(`🏢 Provider: ${pluginInstance.providerId}`)
  }
  if (pluginInstance?.model) {
    lines.push(`🤖 Model: ${pluginInstance.model}`)
  } else {
    lines.push(`🤖 Model: Using global default`)
  }

  let settings: GlobalChannelSettings | null = null
  try {
    settings = await readGlobalChannelSettings()
  } catch (err) {
    console.error('[Channel Status] Global settings read failed:', err)
  }

  lines.push('')
  lines.push('📋 Global Settings:')
  if (!settings) {
    lines.push('  ⚠️ Unavailable: global channel settings could not be read')
  } else {
    const flag = (value: boolean): string => (value ? '✅ ON' : '❌ OFF')
    lines.push(`  Auto Start: ${flag(settings.autoStart)}`)
    lines.push(
      `  Shell Approval: ${settings.shellRequiresApproval ? '🔐 Requires confirmation' : '⚡ Auto-approved'}`
    )
  }

  lines.push('')
  if (ctx.sessionId) {
    try {
      const session = await getNativeWorker().request<NativeSessionStatusResult>(
        'db/session-status',
        { sessionId: ctx.sessionId },
        120_000
      )
      if (!session.success) {
        throw new Error(session.error || 'Native session status failed')
      }

      lines.push(`💬 Session: ${session.found ? session.title || 'Untitled' : 'Untitled'}`)
      lines.push(`  Messages: ${session.messageCount}`)
      if (session.createdAt) {
        lines.push(`  Created: ${new Date(session.createdAt).toLocaleString()}`)
      }
      if (session.updatedAt) {
        lines.push(`  Last Active: ${new Date(session.updatedAt).toLocaleString()}`)
      }
    } catch {
      /* ignore */
    }
  } else {
    lines.push(`💬 Session: No active session`)
  }

  lines.push('')
  for (const filename of WORKSPACE_MEMORY_TEMPLATE_FILES) {
    const filePath = path.join(ctx.pluginWorkDir, filename)
    lines.push(
      `📝 ${filename}: ${fs.existsSync(filePath) ? 'Configured ✅' : 'Not initialized (use /init to create)'}`
    )
  }
  lines.push(`📁 Working Directory: ${ctx.pluginWorkDir}`)

  lines.push('')
  lines.push(`🖥️ System: ${os.platform()} ${os.release()}`)
  lines.push(`⏰ Current Time: ${new Date().toLocaleString()}`)

  return { handled: true, reply: lines.join('\n') }
}

export async function handleCompress(ctx: CommandContext, args: string): Promise<CommandResult> {
  void args
  if (!ctx.sessionId) {
    return { handled: true, reply: 'No active session found.' }
  }

  try {
    const result = await getNativeWorker().request<NativeMessageCompactResult>(
      'db/messages-compact-session',
      { sessionId: ctx.sessionId },
      120_000
    )
    if (!result.success) {
      throw new Error(result.error || 'Native message compaction failed')
    }

    if (result.totalMessages < 6) {
      return { handled: true, reply: 'Too few messages to compress.' }
    }

    if (result.compacted === 0) {
      return { handled: true, reply: 'Context is already compact.' }
    }

    console.log(
      `[PluginCommand] Compacted ${result.compacted} messages in session ${ctx.sessionId}`
    )
    return {
      handled: true,
      reply: `✅ Context compressed, cleaned ${result.compacted} messages (stale tool results and thinking blocks cleared). Compressed ${result.compacted} messages.`
    }
  } catch (err) {
    console.error('[PluginCommand] Failed to compress context:', err)
    return {
      handled: true,
      reply: '❌ Compression failed. Please try again.'
    }
  }
}


import { handleStats, buildInitAgentPrompt } from './plugin-command-stats'

export { handleStats, buildInitAgentPrompt }
