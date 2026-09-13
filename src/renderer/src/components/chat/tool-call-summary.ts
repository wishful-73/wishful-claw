/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { ToolResultContent } from '@renderer/lib/api/types'
import { coerceAskUserQuestions } from '@renderer/lib/tools/ask-user-tool'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'

const COMMAND_TOOL_NAMES = new Set(['Bash', 'Shell', 'PowerShell'])

export type SearchToolSummary = {
  kind: 'glob' | 'grep'
  matchCount: number
  fileCount: number
  truncated: boolean
  timedOut: boolean
  error?: string
}

function outputAsString(output: ToolResultContent | undefined): string | undefined {
  if (output === undefined) return undefined
  if (typeof output === 'string') return output
  const texts = output
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
  return texts.join('\n') || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeGlobSummary(decoded: unknown): SearchToolSummary | null {
  if (Array.isArray(decoded)) {
    return {
      kind: 'glob',
      matchCount: decoded.length,
      fileCount: decoded.length,
      truncated: false,
      timedOut: false
    }
  }
  if (!isRecord(decoded)) return null
  const matches = Array.isArray(decoded.matches)
    ? decoded.matches
    : Array.isArray(decoded.results)
      ? decoded.results
      : []
  return {
    kind: 'glob',
    matchCount: matches.length,
    fileCount: matches.length,
    truncated: decoded.truncated === true,
    timedOut: decoded.timedOut === true,
    error: typeof decoded.error === 'string' ? decoded.error : undefined
  }
}

function normalizeGrepSummary(decoded: unknown): SearchToolSummary | null {
  if (Array.isArray(decoded)) {
    const legacyFiles = new Set(
      decoded
        .map((item) => {
          if (typeof item !== 'string') return null
          const match = item.match(/^(.+?):(\d+):(.*)$/)
          return match?.[1] ?? null
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
    const fileCount = new Set(
      decoded
        .map((item) => (isRecord(item) ? (item.file ?? item.path) : null))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    ).size
    return {
      kind: 'grep',
      matchCount: decoded.length,
      fileCount: Math.max(fileCount, legacyFiles.size),
      truncated: false,
      timedOut: false
    }
  }
  if (!isRecord(decoded)) return null
  const matches = Array.isArray(decoded.matches)
    ? decoded.matches
    : Array.isArray(decoded.results)
      ? decoded.results
      : []
  const fileCount = new Set(
    matches
      .map((item) => (isRecord(item) ? (item.file ?? item.path) : null))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  ).size
  return {
    kind: 'grep',
    matchCount: matches.length,
    fileCount,
    truncated: decoded.truncated === true,
    timedOut: decoded.timedOut === true,
    error: typeof decoded.error === 'string' ? decoded.error : undefined
  }
}

function normalizeRawGrepTextSummary(text: string): SearchToolSummary | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const matches = lines
    .map((line) => line.match(/^(.+?)([:-])(\d+)\2(.*)$/))
    .filter((match): match is RegExpMatchArray => !!match)
  if (matches.length > 0) {
    return {
      kind: 'grep',
      matchCount: matches.length,
      fileCount: new Set(matches.map((match) => match[1])).size,
      truncated: false,
      timedOut: false
    }
  }

  const counts = lines
    .map((line) => line.match(/^(.*):(\d+)$/))
    .filter((match): match is RegExpMatchArray => !!match)
  if (counts.length === lines.length && counts.length > 0) {
    return {
      kind: 'grep',
      matchCount: counts.reduce((total, match) => total + Number(match[2] || 0), 0),
      fileCount: new Set(counts.map((match) => match[1])).size,
      truncated: false,
      timedOut: false
    }
  }

  if (lines.length === 0) return null
  return {
    kind: 'grep',
    matchCount: lines.length,
    fileCount: new Set(lines).size,
    truncated: false,
    timedOut: false
  }
}

export function summarizeSearchToolOutput(
  name: string,
  output: ToolResultContent | undefined
): SearchToolSummary | null {
  const text = outputAsString(output)
  if (!text?.trim()) return null
  const decoded = decodeStructuredToolResult(text)
  if (!decoded) return name === 'Grep' ? normalizeRawGrepTextSummary(text) : null
  if (name === 'Glob') return normalizeGlobSummary(decoded)
  if (name === 'Grep') return normalizeGrepSummary(decoded)
  return null
}

function truncateSummary(value: string, max = 140): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function firstMeaningfulLine(text: string | undefined): string | null {
  if (!text) return null
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  return line ? line.replace(/\s+/g, ' ') : null
}

function summarizeBashInput(input: Record<string, unknown>, outputText?: string): string {
  const command = typeof input.command === 'string' ? input.command.slice(0, 80) : ''
  if (!outputText?.trim()) return command

  const decoded = decodeStructuredToolResult(outputText)
  let preview: string | null = null

  if (isRecord(decoded)) {
    const stdout =
      typeof decoded.stdout === 'string'
        ? decoded.stdout
        : typeof decoded.output === 'string'
          ? decoded.output
          : undefined
    const stderr = typeof decoded.stderr === 'string' ? decoded.stderr : undefined
    const toolError = typeof decoded.error === 'string' ? decoded.error : undefined
    preview =
      firstMeaningfulLine(stdout) ?? firstMeaningfulLine(stderr) ?? firstMeaningfulLine(toolError)
  } else {
    preview = firstMeaningfulLine(outputText)
  }

  if (!preview) return command
  if (!command) return truncateSummary(preview)
  return truncateSummary(`${command} — ${preview}`)
}

function summarizeLsInput(input: Record<string, unknown>, outputText?: string): string {
  const pathSummary = String(input.path ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
    .slice(-2)
    .join('/')

  if (!outputText?.trim()) return pathSummary

  const decoded = decodeStructuredToolResult(outputText)
  if (!Array.isArray(decoded)) return pathSummary

  const names = decoded
    .map((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return null
      const suffix = item.type === 'directory' ? '/' : ''
      return `${item.name}${suffix}`
    })
    .filter((item): item is string => !!item)

  if (names.length === 0) return pathSummary
  const preview = truncateSummary(names.slice(0, 4).join(', '), 100)
  return pathSummary ? truncateSummary(`${pathSummary} — ${preview}`) : preview
}

export function inputSummary(
  name: string,
  input: Record<string, unknown>,
  outputText?: string
): string {
  if (name === 'Skill') {
    const skillName = input.SkillName ?? input.skillName ?? input.name
    return typeof skillName === 'string' ? skillName.trim() : ''
  }
  if (COMMAND_TOOL_NAMES.has(name)) return summarizeBashInput(input, outputText)
  if (name === 'LS') return summarizeLsInput(input, outputText)
  if (['Read', 'Write', 'SavePlan'].includes(name)) {
    const preview =
      name === 'SavePlan' && typeof input.content_preview === 'string'
        ? String(input.content_preview)
        : null
    if (preview) return preview.slice(0, 80)
    const p = String(input.file_path ?? input.path ?? '')
    return p.split(/[\\/]/).slice(-2).join('/')
  }
  if (name === 'Edit') {
    const p = String(input.file_path ?? input.path ?? '')
      .split(/[\\/]/)
      .slice(-2)
      .join('/')
    const expl = typeof input.explanation === 'string' ? ` - ${input.explanation.slice(0, 50)}` : ''
    return `${p}${expl}`
  }
  if (name === 'Delete') {
    const p = String(input.file_path ?? input.path ?? '')
    return `delete: ${p.split(/[\\/]/).slice(-2).join('/')}`
  }
  if (name === 'Glob' && input.pattern) return `pattern: ${input.pattern}`
  if (name === 'Grep' && input.pattern) return `grep: ${input.pattern}`
  if ((name === 'TodoTaskCreate' || name === 'TaskCreate') && (input.title ?? input.subject))
    return String(input.title ?? input.subject).slice(0, 60)
  if ((name === 'TodoTaskUpdate' || name === 'TaskUpdate') && input.taskId)
    return `#${input.taskId}${input.status ? ` -> ${input.status}` : ''}`
  if ((name === 'TodoTaskGet' || name === 'TaskGet') && input.taskId) return `#${input.taskId}`
  if (name === 'TodoTaskList' || name === 'TaskList') return 'list tasks'
  if (name === 'CronAdd') {
    const n = input.name ? String(input.name) : ''
    const sched = input.schedule as { kind?: string; expr?: string } | undefined
    const kindLabel = sched?.kind ?? ''
    const expr = sched?.expr ?? ''
    return n ? `${n} (${kindLabel}${expr ? ` ${expr}` : ''})` : kindLabel
  }
  if (name === 'CronUpdate' && input.jobId) return `update: ${String(input.jobId)}`
  if (name === 'CronRemove' && input.jobId) return `remove: ${String(input.jobId)}`
  if (name === 'CronList') return 'list cron jobs'
  if (name === 'AskUserQuestion') {
    const qs = coerceAskUserQuestions(input.questions)
    if (qs && qs.length > 0) return String(qs[0].question ?? '').slice(0, 60)
    return 'asking user...'
  }
  if (name === 'Task')
    return `[${input.subagent_type ?? '?'}] ${String(input.description ?? '').slice(0, 50)}`
  if (name === 'visualize_show_widget') {
    const title = typeof input.title === 'string' ? input.title : ''
    const widgetCode = typeof input.widget_code === 'string' ? input.widget_code.trim() : ''
    const kind = widgetCode.startsWith('<svg') ? 'SVG' : 'HTML'
    return title ? `${title} (${kind})` : kind
  }
  if (name === 'memory_hot_read') {
    const scope = typeof input.scope === 'string' ? input.scope : ''
    return scope ? `read (${scope})` : 'read hot'
  }
  if (name === 'memory_hot_write') {
    const section = typeof input.section === 'string' ? input.section.slice(0, 60) : ''
    return section || 'write section'
  }
  if (name === 'memory_search') {
    const query = typeof input.query === 'string' ? input.query.slice(0, 60) : ''
    return query ? `search: ${query}` : 'search memory'
  }
  if (name === 'memory_append') {
    const priority = typeof input.priority === 'string' ? input.priority : 'standard'
    const content = typeof input.content === 'string' ? input.content.slice(0, 50) : ''
    return content ? `${priority}: ${content}` : `append (${priority})`
  }
  if (name === 'memory_update') {
    const id = typeof input.id === 'number' ? String(input.id) : ''
    const status = typeof input.status === 'string' ? input.status : ''
    return id ? `update #${id}${status ? ` (${status})` : ''}` : 'update'
  }
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  const first = input[keys[0]]
  const val = typeof first === 'string' ? first : JSON.stringify(first)
  return val.length > 60 ? `${val.slice(0, 60)}...` : val
}
