/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

/*
 * 500-line exemption: 512 lines as of 2026-09-22 (before this iteration's sessionId/projectId
 * fields). This is the node-pty session store and nothing else — the session map, its output/exit
 * bookkeeping, the owner-window routing and the IPC surface that mutates it all share one lifetime,
 * and the map is deliberately module-private so nothing outside this file can hold a session. Moving
 * the handlers out would mean exporting the map. See AGENTS.md.
 */

import { BrowserWindow, type WebContents } from 'electron'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { statSync, accessSync, constants } from 'fs'
import { spawn, type IPty } from 'node-pty'
import { safeSendMessagePackToWindow } from '../window-ipc'
import { getMainWindow } from '../main-window-registry'
import { registerMessagePackHandler } from './messagepack-handler'
import { renderTerminalBuffer } from './terminal-output-text'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateTerminalSessionArgs {
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
  title?: string
  command?: string
  env?: Record<string, string>
  /** Session this terminal belongs to — set by agent-started terminals, absent for user tabs. */
  sessionId?: string
  /** Project the session belongs to — carried so the dock can match tabs to the right pane. */
  projectId?: string
}

interface CreateTerminalSessionResult {
  id?: string
  shell?: string
  cwd?: string
  cols?: number
  rows?: number
  createdAt?: number
  title?: string
  command?: string
  error?: string
}

interface TerminalOutputChunk {
  seq: number
  data: string
}

interface TerminalOutputEvent {
  id: string
  data: string
  seq: number
}

interface TerminalExitEvent {
  id: string
  exitCode: number
  signal?: number
}

export interface TerminalSessionListEntry {
  id: string
  shell: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  title: string
  command?: string
  exitCode?: number
  exitSignal?: number
  sessionId?: string
  projectId?: string
  /**
   * The tab is alive but no command is running in it — the user pressed Ctrl+C. Present so `start`
   * can tell "attach to the thing still running" from "type the command again"; see
   * `writeTerminalSession`.
   */
  interrupted?: boolean
  buffer?: TerminalOutputChunk[]
}

/**
 * What the agent gets back from a terminal: a plain-text slice, plus the shell's own liveness.
 *
 * There is deliberately no "is a command running" field. The text answers that — after the user
 * presses Ctrl+C the new output is `^C` and a fresh prompt — and a second source of truth for it
 * could only ever be a guess (node-pty does not expose the foreground process on Windows).
 */
export interface TerminalOutputView {
  text: string
  status: 'running' | 'exited'
  exitCode?: number
}

interface TerminalShellLaunch {
  shell: string
  args: string[]
}

interface TerminalSession {
  id: string
  pty: IPty
  shell: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  title: string
  command?: string
  exitCode?: number
  exitSignal?: number
  exitedAt?: number
  buffer: TerminalOutputChunk[]
  bufferBytes: number
  nextSeq: number
  ownerWindowId: number | null
  signalFirstOutput: () => void
  /** Set for agent-started terminals so the dock can filter tabs per session. */
  sessionId?: string
  projectId?: string
  /**
   * Highest chunk seq already handed to the agent. `read` returns only what came after it, so a
   * second read is the new output rather than the whole buffer over again.
   */
  lastReadSeq: number
  /** See `TerminalSessionListEntry.interrupted`. */
  interrupted?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MIN_COLS = 20
const MIN_ROWS = 5
const MAX_OUTPUT_BUFFER_BYTES = 64 * 1024
const MAX_ACTIVE_SESSIONS = 32
const EXITED_SESSION_RETENTION_MS = 120_000
const INITIAL_OUTPUT_WAIT_MS = 120
/**
 * A command from the agent is typed into the shell rather than passed to it, and these are the waits
 * that make that safe.
 *
 * `SHELL_READY_TIMEOUT_MS` is what a cold shell gets to paint its prompt when the create call's own
 * budget (`INITIAL_OUTPUT_WAIT_MS`) was not enough. `COMMAND_SUBMIT_DELAY_MS` is the grace period
 * after that, because PSReadLine drops keystrokes that arrive before it is listening — a dropped
 * first character turns `npm run dev` into `pm run dev`. `COMMAND_ECHO_WAIT_MS` then lets the echo
 * land in the buffer, so the tail the caller hands back shows the command line instead of a blank.
 */
const SHELL_READY_TIMEOUT_MS = 2000
const COMMAND_SUBMIT_DELAY_MS = 250
const COMMAND_ECHO_WAIT_MS = 150
/** Ctrl+C — the only keystroke with a settled session-level meaning. See `writeTerminalSession`. */
const INTERRUPT_CHAR = '\u0003'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const terminalSessions = new Map<string, TerminalSession>()
const terminalOutputListeners = new Set<(event: TerminalOutputEvent) => void>()
const terminalExitListeners = new Set<(event: TerminalExitEvent) => void>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveOwnerWindowId(sender?: WebContents | null): number | null {
  return sender ? (BrowserWindow.fromWebContents(sender)?.id ?? null) : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createWindowEvent(windowId: number | null, channel: string, payload: unknown): void {
  const win =
    (typeof windowId === 'number'
      ? BrowserWindow.getAllWindows().find((candidate) => candidate.id === windowId)
      : null) ??
    // Fall back to the registered main window — getAllWindows()[0] may be an
    // auxiliary window (clipboard enhancer, quick launcher).
    getMainWindow()
  if (!win || win.isDestroyed()) return
  safeSendMessagePackToWindow(win, channel, payload)
}

function emitTerminalOutput(event: TerminalOutputEvent): void {
  terminalOutputListeners.forEach((listener) => listener(event))
}

function emitTerminalExit(event: TerminalExitEvent): void {
  terminalExitListeners.forEach((listener) => listener(event))
}

function isExecutableFile(filePath?: string): filePath is string {
  if (!filePath?.trim()) return false
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function sanitizeEnvironmentOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const env: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (typeof rawValue !== 'string') continue
    env[key] = rawValue
  }
  return env
}

function isUsableDirectory(dirPath?: string): dirPath is string {
  if (!dirPath?.trim()) return false
  try {
    return statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function resolveCwd(cwd?: string): string {
  if (isUsableDirectory(cwd)) return cwd
  const home = homedir()
  if (isUsableDirectory(home)) return home
  return process.cwd()
}

function isPowerShell(shell: string): boolean {
  const name = shell.split(/[\\/]/).pop()?.toLowerCase()
  return (
    name === 'powershell.exe' || name === 'powershell' || name === 'pwsh.exe' || name === 'pwsh'
  )
}

function getShellLaunchCandidates(
  preferredShell: string | undefined,
  env: Record<string, string>
): TerminalShellLaunch[] {
  const preferred = preferredShell?.trim()

  if (process.platform === 'win32') {
    // PowerShell 优先：ConPTY 下 cmd.exe 的历史回溯与行内编辑体验都差很多，
    // 而 PSReadLine 带完整的历史、补全与行编辑。cmd 退到候选链末位兜底。
    const shells = [
      preferred,
      'powershell.exe',
      'pwsh.exe',
      env.ComSpec || env.COMSPEC || 'cmd.exe'
    ]
    return shells
      .filter(
        (candidate, index, list): candidate is string =>
          Boolean(candidate) && list.indexOf(candidate) === index
      )
      .map((shell) => ({ shell, args: [] }))
  }

  const shells = [preferred, env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (candidate, index, list): candidate is string =>
      Boolean(candidate) && list.indexOf(candidate) === index
  )

  const launches = shells
    .filter((candidate) => isExecutableFile(candidate))
    .map((shell) => ({ shell, args: shell === '/bin/sh' ? [] : ['-i'] }))

  return launches.length > 0 ? launches : [{ shell: '/bin/sh', args: [] }]
}

/**
 * Flags for an INTERACTIVE shell. A command from the agent is never one of them.
 *
 * `-Command <cmd>` looks like the obvious way to run something, and it is what this used to do:
 * PowerShell then runs non-interactively, which costs everything a terminal is for. No prompt, no
 * echo of the command, `-NoProfile` so the session does not match the user's own tab, and Ctrl+C
 * kills the whole shell instead of cancelling the line. Typing the command into an interactive shell
 * instead (see `createTerminalSession`) gives back all four, and makes an agent-started tab the same
 * object as one the user opened.
 */
function getLaunchArgs(launch: TerminalShellLaunch): string[] {
  if (process.platform === 'win32') {
    return isPowerShell(launch.shell) ? ['-NoLogo'] : []
  }
  return launch.args
}

function appendSessionOutput(session: TerminalSession, data: string): TerminalOutputChunk {
  session.nextSeq += 1
  const chunk: TerminalOutputChunk = { seq: session.nextSeq, data }
  session.buffer.push(chunk)
  session.bufferBytes += Buffer.byteLength(data, 'utf8')
  while (session.bufferBytes > MAX_OUTPUT_BUFFER_BYTES && session.buffer.length > 1) {
    const dropped = session.buffer.shift()
    if (!dropped) break
    session.bufferBytes -= Buffer.byteLength(dropped.data, 'utf8')
  }
  return chunk
}

function toSessionRecord(
  session: TerminalSession,
  includeBuffer: boolean
): TerminalSessionListEntry {
  return {
    id: session.id,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    title: session.title,
    ...(session.command ? { command: session.command } : {}),
    ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
    ...(session.exitSignal !== undefined ? { exitSignal: session.exitSignal } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.interrupted ? { interrupted: true } : {}),
    ...(includeBuffer ? { buffer: session.buffer.slice() } : {})
  }
}

function pruneExpiredExitedSessions(): void {
  const now = Date.now()
  for (const [id, session] of terminalSessions) {
    if (session.exitedAt !== undefined && now - session.exitedAt > EXITED_SESSION_RETENTION_MS) {
      terminalSessions.delete(id)
    }
  }
}

function waitForInitialOutput(session: TerminalSession, timeoutMs: number): Promise<void> {
  if (session.buffer.length > 0 || session.exitCode !== undefined) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      session.signalFirstOutput = () => {}
      resolve()
    }, timeoutMs)
    session.signalFirstOutput = () => {
      clearTimeout(timer)
      session.signalFirstOutput = () => {}
      resolve()
    }
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Snapshot of every live session, oldest first.
 *
 * The buffer is opt-in because it is the whole 64 KB the pty wrote; only the two callers that turn it
 * into text for a reader (the terminal:list handler, and the agent's read action) need it.
 */
export function listTerminalSessionRecords(includeBuffer = false): TerminalSessionListEntry[] {
  pruneExpiredExitedSessions()
  return Array.from(terminalSessions.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((session) => toSessionRecord(session, includeBuffer))
}

export async function createTerminalSession(
  args: CreateTerminalSessionArgs,
  sender?: WebContents | null
): Promise<CreateTerminalSessionResult> {
  pruneExpiredExitedSessions()

  const activeCount = Array.from(terminalSessions.values()).filter(
    (s) => s.exitCode === undefined
  ).length
  if (activeCount >= MAX_ACTIVE_SESSIONS) {
    return {
      error: `Terminal session quota exceeded (${MAX_ACTIVE_SESSIONS} active sessions).`
    }
  }

  const ownerWindowId = resolveOwnerWindowId(sender)
  const env = { ...process.env, ...sanitizeEnvironmentOverrides(args.env) } as Record<string, string>
  const requestedCwd = args.cwd?.trim()
  const cwd = resolveCwd(requestedCwd)
  const cols = Math.max(MIN_COLS, Math.floor(args.cols ?? DEFAULT_COLS))
  const rows = Math.max(MIN_ROWS, Math.floor(args.rows ?? DEFAULT_ROWS))
  const command = args.command?.trim() || undefined
  let lastError = 'Unknown error'

  for (const launch of getShellLaunchCandidates(args.shell, env)) {
    try {
      const pty = spawn(launch.shell, getLaunchArgs(launch), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...env,
          TERM: env.TERM?.trim() || 'xterm-256color'
        }
      })

      const id = `term-${randomUUID()}`
      const session: TerminalSession = {
        id,
        pty,
        shell: launch.shell,
        cwd,
        cols,
        rows,
        createdAt: Date.now(),
        title: args.title?.trim() || launch.shell.split(/[\\/]/).pop() || launch.shell,
        ...(command ? { command } : {}),
        ...(args.sessionId?.trim() ? { sessionId: args.sessionId.trim() } : {}),
        ...(args.projectId?.trim() ? { projectId: args.projectId.trim() } : {}),
        buffer: [],
        bufferBytes: 0,
        nextSeq: 0,
        lastReadSeq: 0,
        ownerWindowId,
        signalFirstOutput: () => {}
      }
      terminalSessions.set(id, session)

      pty.onData((data) => {
        const chunk = appendSessionOutput(session, data)
        session.signalFirstOutput()
        const event: TerminalOutputEvent = { id, data, seq: chunk.seq }
        createWindowEvent(session.ownerWindowId, 'terminal:output', event)
        emitTerminalOutput(event)
      })

      pty.onExit(({ exitCode, signal }) => {
        session.exitCode = exitCode
        session.exitSignal = signal
        session.exitedAt = Date.now()
        session.signalFirstOutput()
        const event: TerminalExitEvent = {
          id,
          exitCode,
          ...(signal !== undefined ? { signal } : {})
        }
        createWindowEvent(session.ownerWindowId, 'terminal:exit', event)
        emitTerminalExit(event)
      })

      await waitForInitialOutput(session, INITIAL_OUTPUT_WAIT_MS)

      // The command goes IN, not on the launch line — this is the half that makes an agent-started
      // tab behave like one the user opened, with the command typed at the prompt. See getLaunchArgs.
      // The read cursor stays at 0, so whoever asked for the terminal gets the prompt plus the echoed
      // command as its opening `tail` and the first `read` starts from there.
      if (command && session.exitCode === undefined) {
        // A cold shell can take well over the 120 ms the create call budgets for its first output. If
        // nothing has arrived yet, wait for the prompt properly before typing — a keystroke sent
        // before the shell is listening is simply dropped, and a dropped first character turns
        // `npm run dev` into `pm run dev`.
        if (session.buffer.length === 0) {
          await waitForInitialOutput(session, SHELL_READY_TIMEOUT_MS)
        }
        await delay(COMMAND_SUBMIT_DELAY_MS)
        try {
          session.pty.write(`${command}\r`)
        } catch {
          // The shell exited while we waited for its prompt. onExit already recorded that, and the
          // caller reads `status` to tell an exited terminal from a running one.
        }
        await delay(COMMAND_ECHO_WAIT_MS)
      }

      createWindowEvent(ownerWindowId, 'terminal:created', toSessionRecord(session, false))

      return {
        id,
        shell: session.shell,
        cwd,
        cols,
        rows,
        createdAt: session.createdAt,
        title: session.title,
        ...(command ? { command } : {})
      }
    } catch (error) {
      lastError = `${launch.shell}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const cwdHint =
    requestedCwd && requestedCwd !== cwd
      ? ` Requested cwd: ${requestedCwd}. Fallback cwd: ${cwd}.`
      : ` Cwd: ${cwd}.`
  return { error: `Failed to start terminal shell.${cwdHint} Last error: ${lastError}` }
}

export function onTerminalSessionOutput(
  listener: (event: TerminalOutputEvent) => void
): () => void {
  terminalOutputListeners.add(listener)
  return () => terminalOutputListeners.delete(listener)
}

export function onTerminalSessionExit(listener: (event: TerminalExitEvent) => void): () => void {
  terminalExitListeners.add(listener)
  return () => terminalExitListeners.delete(listener)
}

export async function getTerminalSessionSnapshot(
  id: string
): Promise<TerminalSessionListEntry | undefined> {
  pruneExpiredExitedSessions()
  const session = terminalSessions.get(id)
  return session ? toSessionRecord(session, true) : undefined
}

/**
 * The terminal's output since its last read, as plain text, plus the shell's liveness.
 *
 * `read` follows the tail instead of re-taking a snapshot. A snapshot answers "what ever happened",
 * which buries the new lines inside text the model has already paid for — and on the second read that
 * is most of the answer. The cursor also makes the text self-describing: after the user presses
 * Ctrl+C, the new output is `^C` followed by a fresh prompt, so the model can see the command stopped
 * without anyone having to model "is a command running" (which node-pty cannot answer on Windows).
 *
 * Returns undefined when there is no such terminal.
 */
export async function readTerminalOutput(id: string): Promise<TerminalOutputView | undefined> {
  pruneExpiredExitedSessions()
  const session = terminalSessions.get(id)
  if (!session) return undefined

  const fresh = session.buffer.filter((chunk) => chunk.seq > session.lastReadSeq)
  session.lastReadSeq = session.nextSeq

  return {
    // Empty is a real answer — "nothing new since you last looked" — and the caller says so in words
    // rather than handing the model a blank it cannot tell from a broken read.
    text: fresh.length > 0 ? renderTerminalBuffer(fresh) : '',
    status: session.exitCode === undefined ? 'running' : 'exited',
    ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {})
  }
}

/**
 * Types a command into an already-running shell, exactly as the user would at its prompt, and returns
 * what that produced.
 *
 * This is what `start` uses when it finds its terminal alive but idle: re-using the tab is right,
 * attaching to it is not — the command the model asked for is no longer running, and an attach would
 * hand back a bare prompt as if it were output.
 */
export async function submitTerminalCommand(
  id: string,
  command: string
): Promise<{ success?: true; view?: TerminalOutputView; error?: string }> {
  pruneExpiredExitedSessions()
  const session = terminalSessions.get(id)
  if (!session) return { error: 'Terminal not found' }
  if (session.exitCode !== undefined) return { error: 'Terminal already exited' }

  try {
    session.pty.write(`${command}\r`)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  // The command is running again, so the tab is no longer idle. The read cursor stays where it was,
  // and readTerminalOutput picks up the echoed command and whatever the new run printed.
  session.interrupted = false
  await delay(COMMAND_ECHO_WAIT_MS)

  const view = await readTerminalOutput(id)
  return view ? { success: true, view } : { error: 'Terminal not found' }
}

export async function writeTerminalSession(
  id: string,
  data: string
): Promise<{ success?: true; error?: string }> {
  pruneExpiredExitedSessions()
  const session = terminalSessions.get(id)
  if (!session) return { error: 'Terminal not found' }
  if (session.exitCode !== undefined) return { error: 'Terminal already exited' }
  try {
    session.pty.write(data)
    // Ctrl+C is the one input whose meaning is settled at the session level: whether it cancelled a
    // running command or an empty prompt line, no command is running afterwards. Nothing else says
    // so — the shell stays alive and no exit code ever arrives — which is why the mark is kept here,
    // off the wire, instead of being derived from output the model would have to guess at. Any other
    // keystroke means the user has taken the tab back, so the mark comes off.
    session.interrupted = data.includes(INTERRUPT_CHAR)
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function killTerminalSession(id: string): Promise<{ success?: true; error?: string }> {
  pruneExpiredExitedSessions()
  const session = terminalSessions.get(id)
  if (!session) return { error: 'Terminal not found' }
  if (session.exitCode !== undefined) return { success: true }
  try {
    session.pty.kill()
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function killAllTerminalSessions(): void {
  terminalSessions.forEach((session) => {
    if (session.exitCode !== undefined) return
    try {
      session.pty.kill()
    } catch {
      // ignore
    }
  })
  terminalSessions.clear()
}

// ---------------------------------------------------------------------------
// IPC Handler Registration
// ---------------------------------------------------------------------------

export function registerTerminalHandlers(): void {
  registerMessagePackHandler<CreateTerminalSessionArgs>('terminal:create', async (args, event) => {
    return await createTerminalSession(args, event.sender)
  })

  registerMessagePackHandler<{ id: string; data: string }>('terminal:input', async (args) => {
    return await writeTerminalSession(args.id, args.data)
  })

  registerMessagePackHandler<{ id: string; cols: number; rows: number }>(
    'terminal:resize',
    async (args) => {
      pruneExpiredExitedSessions()
      const session = terminalSessions.get(args.id)
      if (!session) return { error: 'Terminal not found' }
      if (session.exitCode !== undefined) return { success: true }
      try {
        const cols = Math.max(MIN_COLS, Math.floor(args.cols))
        const rows = Math.max(MIN_ROWS, Math.floor(args.rows))
        session.pty.resize(cols, rows)
        session.cols = cols
        session.rows = rows
        return { success: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  registerMessagePackHandler<{ id: string }>('terminal:kill', async (args) => {
    return await killTerminalSession(args.id)
  })

  registerMessagePackHandler<{ id: string }>('terminal:get', async (args) => {
    const session = await getTerminalSessionSnapshot(args.id)
    return session ? { success: true, session } : { success: false, error: 'Terminal not found' }
  })

  registerMessagePackHandler<undefined>('terminal:list', async () => {
    return listTerminalSessionRecords(true)
  })
}
