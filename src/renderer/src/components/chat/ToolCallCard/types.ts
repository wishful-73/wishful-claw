import type { ToolCallStatus } from '@renderer/lib/agent/types'
import type { ToolResultContent } from '@renderer/lib/api/types'

export interface ToolCallCardProps {
  toolUseId?: string
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
  forceOpen?: boolean
}

export interface WidgetToolPayload {
  title: string
  loadingMessages: string[]
  widgetCode: string
  kind: 'svg' | 'html'
}

export interface ShellOutputSummary {
  live?: boolean
  mode?: 'full' | 'compact' | 'tail'
  noisy?: boolean
  totalChars?: number
  totalLines?: number
  stdoutLines?: number
  stderrLines?: number
  errorLikeLines?: number
  warningLikeLines?: number
  totalMs?: number
  spawnMs?: number
  firstChunkMs?: number
  shell?: string
  executionEngine?: 'main' | 'sidecar'
  timedOut?: boolean
  aborted?: boolean
}

export interface LiveShellOutputState {
  execId: string | null
  text: string
}

export interface ParsedShellResult {
  stdout?: string
  stderr?: string
  output?: string
  exitCode?: number
  processId?: string
  terminalId?: string
  summary?: ShellOutputSummary
  cwd?: string
  command?: string
  timedOut?: boolean
  totalMs?: number
}

export type SearchOutputMeta = {
  engine?: string
  truncated: boolean
  timedOut: boolean
  limitReason?: string | null
  warnings: string[]
  error?: string
}

export type SearchVisualState = 'found' | 'empty' | 'warning' | 'error'

export type ParsedGrepEntry = {
  file: string
  line?: number
  column?: number
  text: string
  kind?: 'match' | 'context'
  count?: number
}

export type LsEntry = { name: string; type: string; path?: string }

// ── Constants ──

export const WIDGET_BRIDGE_SOURCE = 'wishful_claw_widget'

export const LIVE_SHELL_OUTPUT_MAX_CHARS = 12_000

export const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

export const COMMAND_TOOL_NAMES = new Set(['Bash', 'Shell', 'PowerShell'])

export const COMPACT_BUILTIN_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'Bash',
  'BrowserClick',
  'BrowserGetContent',
  'BrowserNavigate',
  'BrowserSearch',
  'BrowserScreenshot',
  'BrowserScroll',
  'BrowserSnapshot',
  'BrowserType',
  'CronAdd',
  'CronCreate',
  'CronDelete',
  'CronList',
  'CronRemove',
  'CronUpdate',
  'Delete',
  'Edit',
  'EnterPlanMode',
  'SubmitPlanReview',
  'Glob',
  'Grep',
  'LS',
  'memory_read',
  'memory_write',
  'memory_search',
  'memory_append',
  'Monitor',
  'NotebookEdit',
  'Notify',
  'PowerShell',
  'Read',
  'SavePlan',
  'Shell',
  'Skill',
  'TodoTaskCreate',
  'TodoTaskGet',
  'TodoTaskList',
  'TodoTaskUpdate',
  // Legacy names for old persisted transcripts.
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'WebFetch',
  'WebSearch',
  'Write',
  'create_goal',
  'get_goal',
  'update_goal',
  'visualize_show_widget'
])

export const STRUCTURED_INPUT_VALUE_CHARS = 300
export const STRUCTURED_INPUT_OBJECT_KEY_LIMIT = 12
export const STRUCTURED_INPUT_ARRAY_ITEM_LIMIT = 6
