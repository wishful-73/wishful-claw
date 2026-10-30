import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { resolveImageBlockSource } from '@renderer/lib/tools/image-block-source'
import type { ImageBlock, ToolResultContent } from '@renderer/lib/api/types'
import type {
  ToolCallCardProps,
  ShellOutputSummary,
  LiveShellOutputState,
  ParsedShellResult
} from './types'
import {
  ANSI_ESCAPE_RE,
  LIVE_SHELL_OUTPUT_MAX_CHARS
} from './types'

// ── Record / equality helpers ──

export function shallowEqualRecord(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  if (prev === next) return true
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false
    if (!Object.is(prev[key], next[key])) return false
  }
  return true
}

export function toolResultContentEqual(
  prev: ToolResultContent | undefined,
  next: ToolResultContent | undefined
): boolean {
  if (prev === next) return true
  if (prev === undefined || next === undefined) return false
  if (typeof prev === 'string' || typeof next === 'string') return prev === next
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const prevBlock = prev[i]
    const nextBlock = next[i]
    if (prevBlock === nextBlock) continue
    if (prevBlock.type !== nextBlock.type) return false
    if (prevBlock.type === 'text' && nextBlock.type === 'text') {
      if (prevBlock.text !== nextBlock.text) return false
      continue
    }
    if (prevBlock.type === 'image' && nextBlock.type === 'image') {
      if (
        prevBlock.source.type !== nextBlock.source.type ||
        prevBlock.source.mediaType !== nextBlock.source.mediaType ||
        prevBlock.source.data !== nextBlock.source.data ||
        prevBlock.source.url !== nextBlock.source.url ||
        prevBlock.source.filePath !== nextBlock.source.filePath
      ) {
        return false
      }
      continue
    }
    return false
  }
  return true
}

export function areToolCallCardPropsEqual(prev: ToolCallCardProps, next: ToolCallCardProps): boolean {
  return (
    prev.toolUseId === next.toolUseId &&
    prev.name === next.name &&
    prev.status === next.status &&
    prev.error === next.error &&
    prev.startedAt === next.startedAt &&
    prev.completedAt === next.completedAt &&
    prev.forceOpen === next.forceOpen &&
    shallowEqualRecord(prev.input, next.input) &&
    toolResultContentEqual(prev.output, next.output)
  )
}

// ── Output helpers ──

export function outputAsString(output: ToolResultContent | undefined): string | undefined {
  if (output === undefined) return undefined
  if (typeof output === 'string') return output
  const texts = output
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
  return texts.join('\n') || undefined
}

export function hasImageBlocks(output: ToolResultContent | undefined): boolean {
  return Array.isArray(output) && output.some((b) => b.type === 'image')
}

export function getImageBlockPreviewSrc(image: ImageBlock): string {
  // S-284：统一走 resolveImageBlockSource —— 落库时 base64 会被剥掉，重开会话
  // 之后只剩 filePath，这里必须能兜底成 oc-media:// ，否则历史截图全是空白。
  return resolveImageBlockSource(image)?.src ?? ''
}

// ── Error detection ──

export function deriveOutputError(output: string | undefined): string | null {
  if (!output) return null
  const trimmed = output.trim()
  if (!trimmed) return null

  const parsed = decodeStructuredToolResult(trimmed)
  if (parsed) {
    if (!Array.isArray(parsed) && typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim()
    }
    return null
  }

  return trimmed
}

export function isErrorOnlyOutput(output: string | undefined): boolean {
  if (!output) return false
  const trimmed = output.trim()
  if (!trimmed) return false

  const parsed = decodeStructuredToolResult(trimmed)
  if (!parsed) return true
  if (Array.isArray(parsed)) return false

  return (
    Object.keys(parsed).length === 1 &&
    typeof parsed.error === 'string' &&
    parsed.error.trim().length > 0
  )
}

export function isStructuredBashResult(output: string | undefined): boolean {
  if (!output) return false
  const parsed = decodeStructuredToolResult(output.trim())
  if (!parsed || Array.isArray(parsed)) return false
  return (
    'stdout' in parsed ||
    'stderr' in parsed ||
    'output' in parsed ||
    'exitCode' in parsed ||
    'processId' in parsed
  )
}

// ── Path / string helpers ──

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function getStringInput(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function firstStringInput(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

export function compactPath(value: string, depth = 2): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return value
  return parts.slice(-depth).join('/')
}

export function pathFileName(value: string): string {
  return compactPath(value, 1)
}

export function pathParent(value: string, depth = 3): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(Math.max(0, parts.length - depth - 1), -1).join('/')
}

export function compactToolPathSummary(value: string): {
  primary: string
  secondary?: string
} {
  return {
    primary: pathFileName(value),
    secondary: value ? pathParent(value) || compactPath(value, 2) : undefined
  }
}

export function fileToolPath(input: Record<string, unknown>): string {
  return firstStringInput(input, [
    'file_path',
    'path',
    'notebook_path',
    'notebook',
    'targetPath',
    'target_path'
  ])
}

export function getSkillNameFromInput(input: Record<string, unknown>): string {
  const raw = input.SkillName ?? input.skillName ?? input.name
  return typeof raw === 'string' ? raw.trim() : ''
}

// ── Read helpers ──

export function stripReadLineNumbers(output: string): string {
  return /^\s*\d+\t/.test(output)
    ? output
        .split('\n')
        .map((line) => line.replace(/^\s*\d+\t/, ''))
        .join('\n')
    : output
}

export function getReadOutputLineCount(output: string | undefined): number | null {
  if (!output?.trim()) return null
  const decoded = decodeStructuredToolResult(output)
  if (decoded && !Array.isArray(decoded) && typeof decoded.error === 'string') return null
  return stripReadLineNumbers(output).split('\n').length
}

// ── Line / lang helpers ──

export function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

export function detectLang(filePath: string): string {
  const ext = filePath.includes('.') ? (filePath.split('.').pop()?.toLowerCase() ?? '') : ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    mdx: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cxx: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    dockerfile: 'docker',
    makefile: 'makefile',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    ini: 'ini',
    env: 'bash',
    conf: 'ini'
  }
  return map[ext] ?? 'text'
}

// ── Shell helpers ──

export function normalizeLiveShellChunk(chunk: string): string {
  return chunk.replace(ANSI_ESCAPE_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function clampLiveShellText(text: string): string {
  if (text.length <= LIVE_SHELL_OUTPUT_MAX_CHARS) return text
  return text.slice(-LIVE_SHELL_OUTPUT_MAX_CHARS)
}

export function appendLiveShellOutput(
  state: LiveShellOutputState,
  execId: string,
  chunk: string
): LiveShellOutputState {
  const base =
    state.execId === execId
      ? state
      : {
          execId,
          text: ''
        }
  const text = normalizeLiveShellChunk(chunk)
  if (!text) return base
  return {
    ...base,
    text: clampLiveShellText(`${base.text}${text}`)
  }
}

export function getShellInputCommand(input: Record<string, unknown>, fallback?: string): string {
  if (typeof fallback === 'string' && fallback.trim()) return fallback
  return (
    getStringInput(input, ['command', 'command_preview']) ||
    (typeof fallback === 'string' ? fallback : '')
  )
}

export function getShellCwd(input: Record<string, unknown>, fallback?: string): string {
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim()
  return (
    getStringInput(input, ['cwd', 'workingDirectory', 'working_dir', 'workingFolder']) ||
    (typeof fallback === 'string' && fallback.trim() ? fallback.trim() : '~')
  )
}

export function buildShellPromptLine(toolName: string, cwd: string, command: string): string {
  const normalizedCommand = normalizeLiveShellChunk(command).trimEnd()
  const isPowerShell = toolName === 'PowerShell'
  const prefix = isPowerShell ? `PS ${cwd}>` : `${cwd} $`
  if (!normalizedCommand) return prefix

  const lines = normalizedCommand.split('\n')
  const continuation = isPowerShell ? '>>' : '>'
  return [`${prefix} ${lines[0]}`, ...lines.slice(1).map((line) => `${continuation} ${line}`)].join(
    '\n'
  )
}

export function getBashInputTerminalId(input: Record<string, unknown>): string | null {
  const terminalId = input.terminalId
  return typeof terminalId === 'string' && terminalId.trim() ? terminalId.trim() : null
}

function getStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

function getNumberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key]
  return typeof field === 'number' ? field : undefined
}

export function normalizeShellResult(value: unknown): ParsedShellResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const source =
    record.result && typeof record.result === 'object' && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : record
  if (
    !('stdout' in source) &&
    !('stderr' in source) &&
    !('output' in source) &&
    !('exitCode' in source) &&
    !('processId' in source)
  ) {
    return null
  }

  return {
    stdout: getStringField(source, 'stdout'),
    stderr: getStringField(source, 'stderr'),
    output: getStringField(source, 'output'),
    exitCode: getNumberField(source, 'exitCode'),
    processId: getStringField(source, 'processId'),
    terminalId: getStringField(source, 'terminalId'),
    summary:
      source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary)
        ? (source.summary as ShellOutputSummary)
        : undefined,
    cwd: getStringField(source, 'cwd'),
    command: getStringField(source, 'command'),
    timedOut: typeof source.timedOut === 'boolean' ? source.timedOut : undefined,
    totalMs: getNumberField(source, 'totalMs')
  }
}

export function buildStoredShellOutput(parsed: ParsedShellResult | null): string {
  if (!parsed) return ''
  if (parsed.output) return parsed.output
  return [parsed.stderr, parsed.stdout ?? parsed.output]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join('\n')
}

export function bashOutputStats(outputText: string | undefined): {
  lines: number | null
  exitCode: number | null
} {
  if (!outputText?.trim()) return { lines: null, exitCode: null }
  const decoded = decodeStructuredToolResult(outputText)
  if (decoded && !Array.isArray(decoded)) {
    const stdout =
      typeof decoded.stdout === 'string'
        ? decoded.stdout
        : typeof decoded.output === 'string'
          ? decoded.output
          : ''
    const stderr = typeof decoded.stderr === 'string' ? decoded.stderr : ''
    const text = [stderr, stdout].filter(Boolean).join('\n\n')
    return {
      lines: text ? lineCount(text) : null,
      exitCode: typeof decoded.exitCode === 'number' ? decoded.exitCode : null
    }
  }
  return { lines: lineCount(outputText), exitCode: null }
}

// ── Search helpers ──

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}


// Search/grep/glob/widget parsing extracted to search-utils.ts
export {
  normalizeSearchMeta,
  formatSearchEngineLabel,
  parseLegacyGrepMatch,
  parseGrepTextMatches,
  getSearchVisualState,
  parseGrepOutput,
  parseGlobOutput,
  parseLsEntries,
  formatPrimitiveInputValue,
  formatStructuredInputValue,
  normalizeWidgetPayload,
  buildWidgetDocument,
} from './search-utils'
