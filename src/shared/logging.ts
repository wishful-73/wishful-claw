/*
 * Shared log level contract between the main-process logger and the
 * renderer settings store. Keep in sync with nothing else — this file is
 * the single source of truth for the persisted level value.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/** Default level: only exceptions are recorded until the user opts in to more. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'error'

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>([
  'error',
  'warn',
  'info',
  'debug'
])

export function isValidLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && VALID_LOG_LEVELS.has(value)
}

export function normalizeLogLevel(value: unknown): LogLevel {
  return isValidLogLevel(value) ? value : DEFAULT_LOG_LEVEL
}

export interface LogFileInfo {
  name: string
  sizeBytes: number
  modifiedAt: number
}

export interface LogFileContent {
  name: string
  sizeBytes: number
  /** True when the file exceeded the preview cap and only its tail is returned. */
  truncated: boolean
  content: string
}

export interface LogCleanupResult {
  deletedCount: number
  deletedNames: string[]
}
