// Logs go to ~/.wishful-claw/logs/; packaged builds persist errors only.
import { app } from 'electron'
import { join } from 'path'
import * as os from 'os'
import * as fs from 'fs'

// ─── Types ───

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 3,
  warn: 2,
  info: 1,
  debug: 0
}

/**
 * Minimum level that gets written to disk.
 * - Packaged (released) builds: error only, to keep log files small.
 * - Dev builds: everything (debug and up).
 * - Override via env WISHFUL_CLAW_LOG_LEVEL=error|warn|info|debug.
 */
function resolveMinLevel(): LogLevel {
  const override = process.env['WISHFUL_CLAW_LOG_LEVEL'] as LogLevel | undefined
  if (override && override in LEVEL_PRIORITY) return override
  return app.isPackaged ? 'error' : 'debug'
}

const MIN_LEVEL = resolveMinLevel()

export interface LogEntry {
  timestamp: string
  level: LogLevel
  source: 'main' | 'renderer' | 'worker' | 'ipc'
  message: string
  stack?: string
  extra?: Record<string, unknown>
}

// ─── Log file management ───

let logDir: string = ''

function getLogDir(): string {
  if (!logDir) {
    const isolatedDataDirectory = process.env.WISHFULCLAW_DATA_DIR?.trim()
    logDir = isolatedDataDirectory
      ? join(isolatedDataDirectory, 'logs')
      : join(os.homedir(), '.wishful-claw', 'logs')
  }
  return logDir
}

function getLogFilePath(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return join(getLogDir(), `${y}-${m}-${d}.log`)
}

function ensureLogDir(): void {
  const dir = getLogDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ─── Write ───

function formatEntry(entry: LogEntry): string {
  const parts: string[] = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.source}]`,
    entry.message
  ]
  if (entry.stack) {
    parts.push('\n' + entry.stack)
  }
  if (entry.extra && Object.keys(entry.extra).length > 0) {
    try {
      parts.push('\n  extra: ' + JSON.stringify(entry.extra, null, 2))
    } catch {
      parts.push('\n  extra: [unserializable]')
    }
  }
  return parts.join(' ') + '\n'
}

function writeLog(entry: LogEntry): void {
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[MIN_LEVEL]) return
  try {
    ensureLogDir()
    const text = formatEntry(entry)
    fs.appendFileSync(getLogFilePath(), text, 'utf-8')
  } catch {
    // Last resort: if even logging fails, swallow silently
  }
}

// ─── Public API ───

export function logError(
  source: LogEntry['source'],
  message: string,
  options?: { stack?: string; extra?: Record<string, unknown> }
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'error',
    source,
    message,
    stack: options?.stack,
    extra: options?.extra
  })
}

export function logWarn(
  source: LogEntry['source'],
  message: string,
  options?: { stack?: string; extra?: Record<string, unknown> }
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'warn',
    source,
    message,
    stack: options?.stack,
    extra: options?.extra
  })
}

export function logInfo(
  source: LogEntry['source'],
  message: string,
  options?: { extra?: Record<string, unknown> }
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'info',
    source,
    message,
    extra: options?.extra
  })
}

export function logDebug(
  source: LogEntry['source'],
  message: string,
  options?: { extra?: Record<string, unknown> }
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'debug',
    source,
    message,
    extra: options?.extra
  })
}

/**
 * Extract a stack trace from an unknown error value.
 */
export function extractStack(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.stack || err.message
  }
  if (typeof err === 'string') {
    return err
  }
  if (err && typeof err === 'object' && 'stack' in err) {
    return String((err as { stack: unknown }).stack)
  }
  return undefined
}

export function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// ─── Global exception handlers ───

let handlersInstalled = false

export function installGlobalExceptionHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true

  process.on('uncaughtException', (err: Error) => {
    logError('main', 'Uncaught Exception: ' + err.message, {
      stack: err.stack,
      extra: { name: err.name }
    })
  })

  process.on('unhandledRejection', (reason: unknown) => {
    logError('main', 'Unhandled Promise Rejection: ' + extractMessage(reason), {
      stack: extractStack(reason)
    })
  })
}

// ─── Log read API (for the UI to read recent logs) ───

export function readRecentLogs(maxLines = 500): string {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return ''
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    return lines.slice(-maxLines).join('\n')
  } catch {
    return ''
  }
}

export function getLogDirectory(): string {
  return getLogDir()
}
