/**
 * Reverse-request handlers for the `Terminal` tool.
 *
 * The agent's Terminal tool ends up here because a terminal the agent starts has to be the *same kind
 * of thing* the user's own tabs are: a node-pty session owned by `terminal-handlers`, rendered by the
 * dock, killable from either side. So these handlers do not open a pty of their own — they drive the
 * session manager the renderer already drives, and translate its records into the small JSON shape
 * `AgentRuntimeTerminalExecutor` reads back.
 */

import {
  createTerminalSession,
  getTerminalSessionSnapshot,
  killTerminalSession,
  listTerminalSessionRecords,
  type TerminalSessionListEntry
} from '../terminal-handlers'
import { renderTerminalBuffer } from '../terminal-output-text'

const DEFAULT_TITLE_MAX_CHARS = 40

interface TerminalStartParams {
  command?: string
  cwd?: string
  shell?: string
  title?: string
  env?: unknown
  sessionId?: string
  projectId?: string
}

interface TerminalRefParams {
  terminalId?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** `Agent: npm run dev` — enough to tell two tabs apart without crowding the tab strip. */
function defaultTitle(command: string): string {
  const firstLine = command.split(/\r?\n/, 1)[0].trim()
  const clipped =
    firstLine.length > DEFAULT_TITLE_MAX_CHARS
      ? `${firstLine.slice(0, DEFAULT_TITLE_MAX_CHARS - 1)}…`
      : firstLine
  return `Agent: ${clipped}`
}

/**
 * Environment overrides as a flat string map. Numbers and booleans are stringified because a model
 * writing `{"PORT": 3000}` means the obvious thing; anything else (nested objects, null) is dropped
 * rather than turned into "[object Object]".
 */
function readEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const entries: [string, string][] = []
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') entries.push([key, raw])
    else if (typeof raw === 'number' || typeof raw === 'boolean') entries.push([key, String(raw)])
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * The read-back shape. `textField` is named per action so the two answers stay distinguishable to the
 * model: `start` hands over the startup `tail`, `read` hands over the accumulated `text`.
 */
function describe(
  record: TerminalSessionListEntry,
  textField: 'tail' | 'text'
): Record<string, unknown> {
  return {
    terminalId: record.id,
    status: record.exitCode === undefined ? 'running' : 'exited',
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    [textField]: renderTerminalBuffer(record.buffer ?? [])
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleTerminalStart(params: Record<string, unknown>): Promise<unknown> {
  const args = params as TerminalStartParams
  const command = readString(args.command)
  if (!command) return { success: false, error: 'command is required' }

  // A terminal belongs to a session because the dock shows tabs per session. Without one it would run
  // with no pane pointing at it, which is worse than refusing.
  const sessionId = readString(args.sessionId)
  if (!sessionId) return { success: false, error: 'sessionId is required' }

  // Re-running the same command is the common case — the model checks on a server it already
  // started. Attach to the live terminal instead of spending a second pty on the same job.
  const running = listTerminalSessionRecords().find(
    (record) =>
      record.exitCode === undefined && record.sessionId === sessionId && record.command === command
  )
  if (running) {
    const snapshot = await getTerminalSessionSnapshot(running.id)
    return {
      success: true,
      ...(snapshot
        ? describe(snapshot, 'tail')
        : { terminalId: running.id, status: 'running', tail: '' }),
      reused: true
    }
  }

  const cwd = readString(args.cwd)
  const shell = readString(args.shell)
  const projectId = readString(args.projectId)
  const env = readEnv(args.env)

  const created = await createTerminalSession({
    command,
    title: readString(args.title) || defaultTitle(command),
    sessionId,
    ...(cwd ? { cwd } : {}),
    ...(shell ? { shell } : {}),
    ...(projectId ? { projectId } : {}),
    ...(env ? { env } : {})
  })

  if (created.error || !created.id) {
    return { success: false, error: created.error ?? 'Failed to start terminal' }
  }

  // createTerminalSession already waited for the first output, so this tail is the startup banner
  // rather than an empty string.
  const snapshot = await getTerminalSessionSnapshot(created.id)
  return {
    success: true,
    ...(snapshot
      ? describe(snapshot, 'tail')
      : { terminalId: created.id, status: 'running', tail: '' }),
    reused: false
  }
}

export async function handleTerminalRead(params: Record<string, unknown>): Promise<unknown> {
  const terminalId = readString((params as TerminalRefParams).terminalId)
  if (!terminalId) return { success: false, error: 'terminalId is required' }

  const snapshot = await getTerminalSessionSnapshot(terminalId)
  if (!snapshot) return { success: false, error: `Terminal not found: ${terminalId}` }

  return { success: true, ...describe(snapshot, 'text') }
}

export async function handleTerminalStop(params: Record<string, unknown>): Promise<unknown> {
  const terminalId = readString((params as TerminalRefParams).terminalId)
  if (!terminalId) return { success: false, error: 'terminalId is required' }

  const result = await killTerminalSession(terminalId)
  if (result.error) return { success: false, error: result.error }

  return { success: true, terminalId, status: 'stopped' }
}
