import { ipcMain } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import {
  decodeMessagePackPayload,
  encodeMessagePackPayload,
  toMessagePackChannel
} from '../../shared/messagepack/binary-ipc'

// ── Cache configuration ──

export const DEFAULT_SCAN_DEPTH = 3
const GIT_QUERY_FAST_TTL_MS = 1_500
const GIT_QUERY_STABLE_TTL_MS = 5_000
const GIT_QUERY_MAX_CACHE_ENTRIES = 256

// ── Types ──

// ── Types ──

export interface GitTarget {
  cwd: string
}

export interface ScanRepositoriesArgs extends GitTarget {
  rootPath: string
  maxDepth?: number
  excludeDirs?: string[]
}

export interface GitRepositorySummary {
  name: string
  fullPath: string
  relativePath: string
  branch: string
  isRootRepo: boolean
}

export interface GitStatusFile {
  path: string
  stagedStatus: string
  unstagedStatus: string
  originalPath?: string
}

export interface GitStatusDetailed {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: GitStatusFile[]
  unstaged: GitStatusFile[]
  untracked: GitStatusFile[]
  conflicted: GitStatusFile[]
}

export interface GitCommitHistoryItem {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  subject: string
}

export interface GitBranchItem {
  name: string
  fullName: string
  type: 'local' | 'remote'
  isCurrent: boolean
}

export interface GitRepoSummary {
  branch: string
  upstream?: string
  ahead: number
  behind: number
}

export interface GitExecResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  errorType?: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

export type GitQueryResult =
  | ({
      success: true
      commitId?: string
      commits?: string[]
      files?: string[]
      dirty?: boolean
      diff?: string
      isBinary?: boolean
      content?: string
      exists?: boolean
      stat?: string
      patch?: string
      empty?: boolean
      history?: GitCommitHistoryItem[]
      branches?: GitBranchItem[]
      current?: string | null
      added?: number
      deleted?: number
      binary?: number
    } & Record<string, unknown>)
  | {
      success: false
      error: string
      errorType?: string
      exitCode?: number
      stdout?: string
      stderr?: string
    }

export type GitStatusDetailedResult =
  | ({ success: true } & { status: GitStatusDetailed })
  | { success: false; error: string; errorType?: string; exitCode?: number; stdout?: string; stderr?: string }

// ── Query cache (deduplication + TTL) ──

const gitQueryInflight = new Map<string, Promise<GitQueryResult>>()
const gitQueryCache = new Map<string, { expiresAt: number; result: GitQueryResult }>()
const gitQueryRevisionByTarget = new Map<string, number>()

export function gitTargetKey(target: GitTarget): string {
  return `local\u0000${target.cwd}`
}

export function stableQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableQueryValue)
  if (!value || typeof value !== 'object') return value
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const nested = (value as Record<string, unknown>)[key]
    if (nested !== undefined) normalized[key] = stableQueryValue(nested)
  }
  return normalized
}

export function gitQueryKey(target: GitTarget, params: Record<string, unknown>): string {
  return `${gitTargetKey(target)}\u0000${JSON.stringify(stableQueryValue(params))}`
}

export function gitQueryRevision(target: GitTarget): number {
  return gitQueryRevisionByTarget.get(gitTargetKey(target)) ?? 0
}

export function gitQueryTtl(params: Record<string, unknown>): number {
  switch (params.operation) {
    case 'get-file-diff':
    case 'get-file-diff-at-commit':
    case 'get-file-content-at-ref':
    case 'get-file-history':
    case 'get-commit-history':
    case 'list-branches':
      return GIT_QUERY_STABLE_TTL_MS
    default:
      return GIT_QUERY_FAST_TTL_MS
  }
}

export function pruneGitQueryCache(now = Date.now()): void {
  if (gitQueryCache.size <= GIT_QUERY_MAX_CACHE_ENTRIES) return
  for (const [key, entry] of gitQueryCache) {
    if (entry.expiresAt <= now) gitQueryCache.delete(key)
  }
  while (gitQueryCache.size > GIT_QUERY_MAX_CACHE_ENTRIES) {
    const oldestKey = gitQueryCache.keys().next().value
    if (!oldestKey) break
    gitQueryCache.delete(oldestKey)
  }
}

export function invalidateGitQueryCache(target?: GitTarget): void {
  if (!target) {
    gitQueryCache.clear()
    gitQueryInflight.clear()
    gitQueryRevisionByTarget.clear()
    return
  }
  const targetKey = gitTargetKey(target)
  gitQueryRevisionByTarget.set(targetKey, gitQueryRevision(target) + 1)
  const prefix = `${targetKey}\u0000`
  for (const key of gitQueryCache.keys()) {
    if (key.startsWith(prefix)) gitQueryCache.delete(key)
  }
  for (const key of gitQueryInflight.keys()) {
    if (key.startsWith(prefix)) gitQueryInflight.delete(key)
  }
}

// ── Helpers ──

export function failFromError(error: unknown): { success: false; error: string; errorType: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    errorType: 'UNKNOWN'
  }
}

export function ok<T extends object>(data: T): { success: true } & T {
  return { success: true, ...data }
}

export function fail(
  result: GitExecResult,
  fallback: string
): {
  success: false
  error: string
  errorType: string
  exitCode: number
  stdout: string
  stderr: string
} {
  return {
    success: false,
    error: result.stderr || fallback,
    errorType: result.errorType ?? 'UNKNOWN',
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

export function okMutation(
  target: GitTarget,
  result: GitExecResult
): { success: true; stdout: string; stderr: string } {
  invalidateGitQueryCache(target)
  return ok({ stdout: result.stdout, stderr: result.stderr })
}

export async function nativeGitRequest<T>(
  method: string,
  target: GitTarget,
  params: Record<string, unknown> = {},
  timeoutMs?: number
): Promise<T> {
  return await getNativeWorker().request<T>(method, { ...target, ...params }, timeoutMs)
}

export function queryGit(
  target: GitTarget,
  params: Record<string, unknown>
): Promise<GitQueryResult> {
  const cacheKey = gitQueryKey(target, params)
  const now = Date.now()
  const cached = gitQueryCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.result)
  }
  if (cached) gitQueryCache.delete(cacheKey)

  const pending = gitQueryInflight.get(cacheKey)
  if (pending) return pending

  const requestRevision = gitQueryRevision(target)
  const request = nativeGitRequest<GitQueryResult>('git/query', target, params)
    .then((result) => {
      const ttl = gitQueryTtl(params)
      // Only cache successful results — caching a failure would mask the
      // transient error for the whole TTL window.
      if (result.success && gitQueryRevision(target) === requestRevision) {
        gitQueryCache.set(cacheKey, { expiresAt: Date.now() + ttl, result })
        pruneGitQueryCache()
      }
      return result
    })
    .catch((error) => failFromError(error) as GitQueryResult)
    .finally(() => {
      if (gitQueryInflight.get(cacheKey) === request) {
        gitQueryInflight.delete(cacheKey)
      }
    })

  gitQueryInflight.set(cacheKey, request)
  return request
}

export async function execGit(args: string[], target: GitTarget): Promise<GitExecResult> {
  return await nativeGitRequest<GitExecResult>(
    'git/exec-local',
    target,
    {
      args,
      timeoutMs: 60_000,
      maxStdoutChars: 2 * 1024 * 1024,
      maxStderrChars: 64 * 1024
    },
    90_000
  )
}

// ── Handler registration ──

export function registerGitMessagePackHandler<TArgs>(
  channel: string,
  handler: (args: TArgs) => Promise<unknown> | unknown
): void {
  ipcMain.handle(toMessagePackChannel(channel), async (_event, bytes: Uint8Array) => {
    try {
      const args = decodeMessagePackPayload<TArgs>(bytes)
      return encodeMessagePackPayload(await handler(args))
    } catch (error) {
      return encodeMessagePackPayload(failFromError(error))
    }
  })
}

