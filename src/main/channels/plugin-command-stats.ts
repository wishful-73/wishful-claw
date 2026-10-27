/**
 * Plugin command handlers — extracted from plugin-commands.ts.
 *
 * Each handler receives CommandContext + raw args string and returns a CommandResult.
 */
import { getNativeWorker } from '../lib/native-worker'
import type {
  CommandContext,
  CommandResult,
  NativeMessageUsageStatsResult,
  WorkspaceMemoryTemplateFile
} from './plugin-command-handlers'

// ── Shared Types (re-exported from plugin-commands) ──


export async function handleStats(ctx: CommandContext, args: string): Promise<CommandResult> {
  void args
  if (!ctx.sessionId) {
    return { handled: true, reply: 'No active session found.' }
  }

  try {
    const stats = await getNativeWorker().request<NativeMessageUsageStatsResult>(
      'db/messages-usage-stats',
      { sessionId: ctx.sessionId },
      120_000
    )
    if (!stats.success) {
      throw new Error(stats.error || 'Native message usage stats failed')
    }

    if (!stats.hasUsage) {
      return { handled: true, reply: 'No token usage data available.' }
    }

    const totalTokens = stats.totalInput + stats.totalOutput
    const formatNum = (n: number): string => {
      if (n < 1_000) return String(n)
      if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
      return `${(n / 1_000_000).toFixed(2)}M`
    }
    const formatPercent = (rate: number): string => {
      const safeRate = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0
      const percent = Math.round(safeRate * 1000) / 10
      return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`
    }

    const lines: string[] = ['📈 Usage Stats']

    lines.push('')
    lines.push(`📊 Total: ${formatNum(totalTokens)} tokens`)
    lines.push(`  Input:  ${formatNum(stats.totalInput)}`)
    lines.push(`  Output: ${formatNum(stats.totalOutput)}`)

    if (stats.totalCacheRead > 0 || stats.totalCacheCreation > 0) {
      lines.push('')
      lines.push(`💾 Cache:`)
      if (stats.totalCacheRead > 0) {
        const cacheTokenShare = stats.totalCacheRead / (stats.totalInput + stats.totalCacheRead)
        lines.push(`  Cache Read: ${formatNum(stats.totalCacheRead)}`)
        lines.push(`  Cached Token Share: ${formatPercent(cacheTokenShare)}`)
      }
      if (stats.totalCacheCreation > 0)
        lines.push(`  Cache Write: ${formatNum(stats.totalCacheCreation)}`)
    }

    if (stats.totalReasoning > 0) {
      lines.push(`🧠 推理 (Reasoning): ${formatNum(stats.totalReasoning)}`)
    }

    lines.push('')
    lines.push(`🔄 API Calls: ${stats.requestCount}`)
    lines.push(`💬 Assistant Replies: ${stats.assistantReplies}`)

    if (stats.totalDurationMs > 0) {
      const totalSec = stats.totalDurationMs / 1000
      const tps = totalSec > 0 ? totalTokens / totalSec : 0
      // S-245：耗时读数不带小数。主进程引不到渲染端的 format-duration（不同进程 / 不同模块图），
      // 口径就地照抄：< 60s 取整到秒，>= 60s 取整到分钟。
      lines.push(
        `⏱️ Total Time: ${totalSec < 60 ? `${Math.round(totalSec)}s` : `${Math.round(totalSec / 60)}min`}`
      )
      lines.push(`⚡ TPS: ${tps.toFixed(1)}`)
    }

    if (stats.firstCreatedAt && stats.lastCreatedAt) {
      lines.push('')
      lines.push(`📅 Stats Range:`)
      lines.push(`  First: ${new Date(stats.firstCreatedAt).toLocaleString()}`)
      lines.push(`  Latest: ${new Date(stats.lastCreatedAt).toLocaleString()}`)
    }

    return { handled: true, reply: lines.join('\n') }
  } catch (err) {
    console.error('[PluginCommand] Failed to get stats:', err)
    return {
      handled: true,
      reply: '❌ Failed to get usage stats.'
    }
  }
}

// ── /init Agent Prompt Builder ──

export function buildInitAgentPrompt(options: {
  workDir: string
  agentsPath: string
  hasExistingAgents: boolean
  createdFiles: WorkspaceMemoryTemplateFile[]
  existingFiles: WorkspaceMemoryTemplateFile[]
  rawArgs: string
  parsedArgs: string[]
}): string {
  const {
    workDir,
    agentsPath,
    hasExistingAgents,
    createdFiles,
    existingFiles,
    rawArgs,
    parsedArgs
  } = options
  const existingNote = hasExistingAgents
    ? `There is already an AGENTS.md at \`${agentsPath}\`. Read it first and suggest improvements — preserve any user-customized sections while enhancing the auto-generated parts.`
    : `No AGENTS.md exists yet. Create a new one at \`${agentsPath}\`.`
  const initializedNote =
    createdFiles.length > 0
      ? `The workspace memory templates were just initialized: ${createdFiles.map((file) => `\`${file}\``).join(', ')}. Keep their intent intact. You may lightly tailor AGENTS.md to the repository, but do not overwrite SOUL.md, USER.md, or MEMORY.md unless the user explicitly asked for it.`
      : existingFiles.length > 0
        ? `The workspace already contains memory files: ${existingFiles.map((file) => `\`${file}\``).join(', ')}. Read them before changing anything and preserve user-authored content.`
        : 'No workspace memory files were pre-existing.'
  const argsNote = rawArgs
    ? `The user passed slash-command arguments to /init.
- Raw arguments: ${rawArgs}
- Parsed arguments: ${JSON.stringify(parsedArgs)}
Treat them as explicit scope or preferences for initialization, and honor them when analyzing the workspace.`
    : 'No slash-command arguments were provided.'

  return `[System Command: /init]

Please analyze the codebase in \`${workDir}\` and ${hasExistingAgents ? 'update' : 'create'} an AGENTS.md file.

${existingNote}
${initializedNote}
${argsNote}

**Your task:**
1. Explore the project structure using Glob, Grep, and Read tools. Look at package.json, README.md, config files, source entry points, and key modules.
2. Identify the tech stack, build system, common commands (build, lint, test, dev), and project architecture.
3. ${hasExistingAgents ? 'Update' : 'Write'} the AGENTS.md file at \`${agentsPath}\` with the following structure:

\`\`\`
# AGENTS.md

This file provides guidance to the AI assistant when working with code in this repository.

## Commands
[Common commands: build, lint, test, dev, etc. Include how to run a single test if applicable.]

## Architecture
[High-level code architecture and structure — the "big picture" that requires reading multiple files to understand. Focus on entry points, data flow, key patterns, and module responsibilities.]

## Conventions
[Project-specific conventions: naming, file organization, import patterns, error handling, and code comment expectations. Comments should explain intent, invariants, boundaries, side effects, or non-obvious behavior rather than restating straightforward code. Only include things that are NOT obvious from the code.]

## Custom Instructions
[Preserve any existing custom instructions from the user, or leave a placeholder for them to fill in.]
\`\`\`

**Rules:**
- Do NOT repeat information that can be easily discovered by reading a single file.
- Do NOT include generic development practices or obvious instructions.
- Do NOT list every component or file — focus on architecture and relationships.
- Do NOT make up information — only include what you can verify from the codebase.
- If there's a README.md, incorporate its important parts (don't duplicate verbatim).
- If there are existing rule files (.cursorrules, .cursor/rules/, .github/copilot-instructions.md, CLAUDE.md), incorporate their important parts.
- Keep it concise and actionable — this file should help an AI assistant be productive quickly.
- Prefix the file with:

\`\`\`
# AGENTS.md

This file provides guidance to the AI assistant when working with code in this repository.
\`\`\`

After writing the file, confirm completion with a brief summary of what was generated.`
}
