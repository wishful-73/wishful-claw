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
  killTerminalSession,
  listTerminalSessionRecords,
  readTerminalOutput,
  submitTerminalCommand,
  type TerminalOutputView
} from '../terminal-handlers'

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
 * model: `start` hands over the startup `tail`, `read` hands over what is new as `text`.
 */
function describe(
  terminalId: string,
  view: TerminalOutputView,
  textField: 'tail' | 'text'
): Record<string, unknown> {
  return {
    terminalId,
    status: view.status,
    ...(view.exitCode !== undefined ? { exitCode: view.exitCode } : {}),
    [textField]: view.text
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
  const sameCommand = listTerminalSessionRecords().filter(
    (record) =>
      record.exitCode === undefined && record.sessionId === sessionId && record.command === command
  )

  const running = sameCommand.find((record) => !record.interrupted)
  if (running) {
    const view = await readTerminalOutput(running.id)
    return {
      success: true,
      ...(view
        ? describe(running.id, view, 'tail')
        : { terminalId: running.id, status: 'running', tail: '' }),
      reused: true,
      note: 'Attached to the terminal already running this command in this session.'
    }
  }

  // The tab is alive but the user pressed Ctrl+C in it, so the command is not running any more.
  // Attaching would hand back a bare prompt as if it were the answer; type the command into the same
  // shell instead — same tab, new run. `read` returning only what is new is what makes this honest:
  // the model sees the echoed command and the new output, not the previous run's log.
  const idle = sameCommand.find((record) => record.interrupted)
  if (idle) {
    const submitted = await submitTerminalCommand(idle.id, command)
    if (submitted.error || !submitted.view) {
      return { success: false, error: submitted.error ?? 'Failed to start terminal' }
    }
    return {
      success: true,
      ...describe(idle.id, submitted.view, 'tail'),
      reused: true,
      note: 'The command was no longer running in this terminal (it had been interrupted), so it was typed into the existing shell again.'
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

  // createTerminalSession already waited for the prompt and typed the command into it, so this tail
  // is the prompt plus the echoed command rather than an empty string. Reading through the cursor
  // rather than off the buffer keeps the two in step: everything handed back here is exactly what the
  // next `read` will not repeat.
  const view = await readTerminalOutput(created.id)
  return {
    success: true,
    ...(view
      ? describe(created.id, view, 'tail')
      : { terminalId: created.id, status: 'running', tail: '' }),
    reused: false
  }
}

export async function handleTerminalRead(params: Record<string, unknown>): Promise<unknown> {
  const terminalId = readString((params as TerminalRefParams).terminalId)
  if (!terminalId) return { success: false, error: 'terminalId is required' }

  const view = await readTerminalOutput(terminalId)
  if (!view) return { success: false, error: `Terminal not found: ${terminalId}` }

  return {
    success: true,
    ...describe(terminalId, view, 'text'),
    // Nothing new is a normal answer on a quiet terminal, not a failure — say so in words, so the
    // model does not read an empty string as a broken read.
    ...(view.text.length === 0 ? { note: 'No new output since the previous read.' } : {})
  }
}

export async function handleTerminalStop(params: Record<string, unknown>): Promise<unknown> {
  const terminalId = readString((params as TerminalRefParams).terminalId)
  if (!terminalId) return { success: false, error: 'terminalId is required' }

  const result = await killTerminalSession(terminalId)
  if (result.error) return { success: false, error: result.error }

  return { success: true, terminalId, status: 'stopped' }
}
