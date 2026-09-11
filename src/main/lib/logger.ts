// Logs go to ~/.wishful-claw/logs/. The minimum level is driven by the
// unified settings store (settings/general.json → state.logLevel); error
// entries are the filtering floor and are always written.
import { join, resolve as resolvePath, sep } from 'path'
import { resolveDataPath } from './data-dir'
import * as fs from 'fs'
import {
  DEFAULT_LOG_LEVEL,
  isValidLogLevel,
  normalizeLogLevel,
  type LogCleanupResult,
  type LogFileContent,
  type LogFileInfo,
  type LogLevel
} from '../../shared/logging'

export type { LogLevel, LogFileInfo, LogFileContent, LogCleanupResult }

// ─── Types ───

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 3,
  warn: 2,
  info: 1,
  debug: 0
}

/**
 * Minimum level that gets written to disk. Initialized from the env override
 * (dev escape hatch); the persisted settings value is applied at startup and
 * on every settings write. Default: error (exceptions only).
 */
function resolveInitialMinLevel(): LogLevel {
  const override = process.env['WISHFUL_CLAW_LOG_LEVEL']
  if (isValidLogLevel(override)) return override
  return DEFAULT_LOG_LEVEL
}

let minLevel: LogLevel = resolveInitialMinLevel()

export function getLogMinLevel(): LogLevel {
  return minLevel
}

/** True when WISHFUL_CLAW_LOG_LEVEL pins the level for this session. */
export function hasEnvLogLevelOverride(): boolean {
  return isValidLogLevel(process.env['WISHFUL_CLAW_LOG_LEVEL'])
}

/** Apply a new minimum level (invalid values fall back to the default). */
export function setLogMinLevel(level: unknown): LogLevel {
  minLevel = normalizeLogLevel(level)
  return minLevel
}

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
    logDir = resolveDataPath('logs')
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
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[minLevel]) return
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

// ─── Log file management (settings → Logs page) ───

/** Strict daily log file name: YYYY-MM-DD.log (calendar-valid dates only). */
const LOG_FILE_NAME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.log$/

/** Preview cap: larger files return only their tail, flagged as truncated. */
const LOG_PREVIEW_MAX_BYTES = 1_048_576

/** Cleanup bound: keep at most this many days of daily files. */
const LOG_CLEANUP_MAX_DAYS = 3650

function parseLogFileName(name: string): Date | null {
  const match = LOG_FILE_NAME_PATTERN.exec(name)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

/**
 * Resolve a renderer-supplied file name to a path inside the log directory.
 * Returns null for anything that is not a strict daily log file name.
 */
function resolveLogFilePath(name: string): string | null {
  if (!LOG_FILE_NAME_PATTERN.test(name)) return null
  const dir = resolvePath(getLogDir())
  const full = resolvePath(dir, name)
  if (!full.startsWith(dir + sep)) return null
  return full
}

/** List daily log files, newest first. */
export function listLogFiles(): LogFileInfo[] {
  try {
    const dir = getLogDir()
    if (!fs.existsSync(dir)) return []
    const files: LogFileInfo[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!LOG_FILE_NAME_PATTERN.test(entry.name)) continue
      try {
        const stat = fs.statSync(join(dir, entry.name))
        files.push({ name: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs })
      } catch {
        // File vanished between readdir and stat — skip it
      }
    }
    // Names are ISO dates, so lexicographic order is chronological.
    files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
    return files
  } catch {
    return []
  }
}

/** Read one log file for preview. Returns null when missing or unreadable. */
export function readLogFile(name: string): LogFileContent | null {
  const filePath = resolveLogFilePath(name)
  if (!filePath) return null
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    if (stat.size <= LOG_PREVIEW_MAX_BYTES) {
      return {
        name,
        sizeBytes: stat.size,
        truncated: false,
        content: fs.readFileSync(filePath, 'utf-8')
      }
    }
    const handle = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(LOG_PREVIEW_MAX_BYTES)
      fs.readSync(handle, buffer, 0, LOG_PREVIEW_MAX_BYTES, stat.size - LOG_PREVIEW_MAX_BYTES)
      let text = buffer.toString('utf-8')
      // The tail likely starts mid-line; drop the partial first line.
      const firstNewline = text.indexOf('\n')
      if (firstNewline >= 0) text = text.slice(firstNewline + 1)
      return { name, sizeBytes: stat.size, truncated: true, content: text }
    } finally {
      fs.closeSync(handle)
    }
  } catch {
    return null
  }
}

/**
 * Delete daily log files older than the kept window. `days` counts today as
 * day 1 (days=7 keeps today plus the previous 6 days). Files that do not
 * parse as strict daily log names are never touched.
 */
export function cleanupOldLogFiles(days: number): LogCleanupResult {
  const keptDays = Math.max(1, Math.min(LOG_CLEANUP_MAX_DAYS, Math.floor(days)))
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (keptDays - 1))
  const deletedNames: string[] = []
  try {
    const dir = getLogDir()
    if (!fs.existsSync(dir)) return { deletedCount: 0, deletedNames: [] }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const fileDate = parseLogFileName(entry.name)
      if (!fileDate) continue
      if (fileDate < cutoff) {
        try {
          fs.rmSync(join(dir, entry.name), { force: true })
          deletedNames.push(entry.name)
        } catch {
          // Locked or in-use file — leave it, report the rest
        }
      }
    }
  } catch {
    // Best effort — report whatever was deleted so far
  }
  return { deletedCount: deletedNames.length, deletedNames }
}
