import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import { toMessagePackChannel } from '../../../shared/messagepack/binary-ipc'
import { useChatStore } from './chat-store'

export interface GitRepositoryItem {
  name: string
  fullPath: string
  relativePath: string
  branch: string
  isRootRepo: boolean
  sshConnectionId?: string
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

export interface GitCommitGraphItem {
  hash: string
  shortHash: string
  /** Full parent hashes; the first entry is the lane the commit continues on. */
  parents: string[]
  author: string
  date: string
  subject: string
  /** Short ref names pointing at this commit, e.g. `HEAD -> main`, `origin/main`, `tag: v1`. */
  refs: string[]
}

export interface GitRepositoryDetails {
  status: GitStatusDetailed | null
  history: GitCommitHistoryItem[]
  fileHistoryByPath: Record<string, GitCommitHistoryItem[]>
  branches: GitBranchItem[]
  currentBranch: string | null
  /** `null` until the branch view asks for it — the graph is only fetched on demand. */
  graph: GitCommitGraphItem[] | null
  graphError: string | null
  diffByKey: Record<string, string>
  /** 缓存 `commitHash:filePath` → 该提交中此文件的 patch */
  historyFileDiffByKey: Record<string, string>
  loading: boolean
  error: string | null
}

export interface GitResultBase {
  success?: boolean
  error?: string
}

export interface RefreshRepositoryOptions {
  force?: boolean
}

export interface GitStore {
  repositories: GitRepositoryItem[]
  selectedRepoPath: string | null
  isScanning: boolean
  scanError: string | null
  repoDetailsByPath: Record<string, GitRepositoryDetails>
  activePollingTimer: number | null
  scanRepositories: (options?: { force?: boolean }) => Promise<void>
  selectRepository: (repoPath: string | null) => void
  refreshRepository: (repoPath: string, options?: RefreshRepositoryOptions) => Promise<void>
  loadMoreHistory: (repoPath: string) => Promise<void>
  loadCommitGraph: (repoPath: string, options?: { force?: boolean }) => Promise<void>
  loadFileHistory: (repoPath: string, filePath: string, append?: boolean) => Promise<void>
  loadFileDiff: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>
  loadHistoryFileDiff: (
    repoPath: string,
    filePath: string,
    commitHash: string
  ) => Promise<{ success: boolean }>
  fetchRepository: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  pullRebase: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  pushRepository: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  syncRepository: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  createBranch: (
    repoPath: string,
    name: string,
    startPoint?: string
  ) => Promise<{ success: boolean; error?: string }>
  checkoutBranch: (repoPath: string, name: string) => Promise<{ success: boolean; error?: string }>
  mergeBranch: (repoPath: string, ref: string) => Promise<{ success: boolean; error?: string }>
  rebaseBranch: (repoPath: string, ref: string) => Promise<{ success: boolean; error?: string }>
  deleteLocalBranch: (
    repoPath: string,
    name: string,
    force?: boolean
  ) => Promise<{ success: boolean; error?: string }>
  deleteRemoteBranch: (
    repoPath: string,
    remote: string,
    branchName: string
  ) => Promise<{ success: boolean; error?: string }>
  renameBranch: (
    repoPath: string,
    newName: string,
    oldName?: string
  ) => Promise<{ success: boolean; error?: string }>
  stageFiles: (repoPath: string, paths: string[]) => Promise<{ success: boolean; error?: string }>
  unstageFiles: (repoPath: string, paths: string[]) => Promise<{ success: boolean; error?: string }>
  stageAll: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  unstageAll: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  discardFiles: (
    repoPath: string,
    paths: string[],
    scope: 'worktree' | 'full' | 'untracked'
  ) => Promise<{ success: boolean; error?: string }>
  /** `amend` 为真时走 `git commit --amend`，改写当前 HEAD（只有显式要求时才用）。 */
  commit: (
    repoPath: string,
    message: string,
    options?: { amend?: boolean }
  ) => Promise<{ success: boolean; error?: string }>
  getStagedDiffBundle: (
    repoPath: string
  ) => Promise<
    | { success: true; stat: string; patch: string; empty: boolean }
    | { success: false; error: string }
  >
  getFileContentAtRef: (
    repoPath: string,
    filePath: string,
    ref: string
  ) => Promise<{ content: string; exists: boolean; isBinary: boolean }>
  invalidateFileDiff: (repoPath: string, filePath: string) => void
  startPolling: () => void
  stopPolling: () => void
  reset: () => void
}

export function getActiveProject(): ReturnType<typeof useChatStore.getState>['projects'][number] | null {
  const { activeProjectId, projects } = useChatStore.getState()
  return projects.find((project) => project.id === activeProjectId) ?? null
}

export function getGitTarget(repoPath?: string): { cwd: string; sshConnectionId: string | null } {
  const project = getActiveProject()
  return {
    cwd: repoPath ?? project?.workingFolder ?? '',
    sshConnectionId: project?.sshConnectionId ?? null
  }
}

export function getErrorMessage(result: unknown, fallback: string): string {
  if (!result || typeof result !== 'object') return fallback
  if ('error' in result && typeof (result as { error?: unknown }).error === 'string') {
    return (result as { error: string }).error
  }
  return fallback
}

export async function invokeGit<T>(channel: string, payload: Record<string, unknown>): Promise<T> {
  return await invokeMessagePackBinary<T>(toMessagePackChannel(channel), payload)
}

function createEmptyRepoDetails(): GitRepositoryDetails {
  return {
    status: null,
    history: [],
    fileHistoryByPath: {},
    branches: [],
    currentBranch: null,
    graph: null,
    graphError: null,
    diffByKey: {},
    historyFileDiffByKey: {},
    loading: false,
    error: null
  }
}

export function ensureRepoDetails(
  repoDetailsByPath: Record<string, GitRepositoryDetails>,
  repoPath: string
): GitRepositoryDetails {
  return repoDetailsByPath[repoPath] ?? createEmptyRepoDetails()
}

export const pendingFileDiffRequests = new Map<string, Promise<void>>()
export const pendingFileHistoryRequests = new Map<string, Promise<void>>()
export const pendingHistoryFileDiffRequests = new Map<string, Promise<{ success: boolean }>>()
export const pendingScanRequests = new Map<string, Promise<void>>()
export const pendingCommitGraphRequests = new Map<string, Promise<void>>()
export const pendingRepositoryRefreshRequests = new Map<string, Promise<void>>()
export const repositoryRefreshExpiresAtByKey = new Map<string, number>()
/** Depth of the branch-view commit graph. Deeper than this and the lanes get unreadable. */
export const COMMIT_GRAPH_LIMIT = 50
const repositoryRefreshRevisionByKey = new Map<string, number>()
export const REPOSITORY_SCAN_CACHE_TTL_MS = 5_000
export const REPOSITORY_REFRESH_CACHE_TTL_MS = 3_000
export const REPOSITORY_REFRESH_ERROR_TTL_MS = 1_000

export const _gitState = {
  lastAppliedScanKey: null as string | null,
  scanCacheExpiresAt: 0
}

export function fileDiffCacheKey(filePath: string, staged = false): string {
  return `${staged ? 'staged' : 'unstaged'}:${filePath}`
}

export function fileDiffRequestKey(repoPath: string, filePath: string, staged = false): string {
  return `${repoPath}:${fileDiffCacheKey(filePath, staged)}`
}

export function gitTargetCacheKey(target: { cwd: string; sshConnectionId: string | null }): string {
  return `${target.sshConnectionId ?? 'local'}:${target.cwd}`
}

export function projectScanKey(project: ReturnType<typeof getActiveProject>): string | null {
  if (!project?.workingFolder) return null
  return `${project.sshConnectionId ?? 'local'}:${project.workingFolder}`
}

export function repositoryRefreshRevision(key: string): number {
  return repositoryRefreshRevisionByKey.get(key) ?? 0
}

export function bumpRepositoryRefreshRevision(key: string): void {
  repositoryRefreshRevisionByKey.set(key, repositoryRefreshRevision(key) + 1)
  repositoryRefreshExpiresAtByKey.delete(key)
}

export function clearGitRequestCaches(): void {
  pendingFileDiffRequests.clear()
  pendingFileHistoryRequests.clear()
  pendingHistoryFileDiffRequests.clear()
  pendingScanRequests.clear()
  pendingCommitGraphRequests.clear()
  pendingRepositoryRefreshRequests.clear()
  repositoryRefreshExpiresAtByKey.clear()
  repositoryRefreshRevisionByKey.clear()
  _gitState.lastAppliedScanKey = null
  _gitState.scanCacheExpiresAt = 0
}

