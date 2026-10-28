/**
 * 会话概览面板的 Git 摘要读取：缓存、去重请求与 hook。
 *
 * S-250 从 `SessionSummaryPanel.tsx` 搬出，函数体与 `useEffect` 依赖数组逐字平移。
 * `findLatestSummary` / `compactPath` 一并放这里：主组件解析压缩摘要和渲染路径时都要用。
 */

import { useEffect, useState } from 'react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { IPC } from '@renderer/lib/ipc/channels'
import { invokeMessagePackBinary } from '@renderer/lib/ipc/messagepack-ipc-client'
import type { GitStatusDetailed } from '@renderer/stores/git-store'
import { isCompactSummaryLikeMessage } from '@renderer/lib/agent/context-compression'
import { toMessagePackChannel } from '../../../../../shared/messagepack/binary-ipc'
import type { GitLineSummaryResult, GitResultBase, GitSummary } from './types'

const GIT_SUMMARY_CACHE_MS = 5_000

const gitSummaryCache = new Map<string, { expiresAt: number; summary: GitSummary }>()
const gitSummaryRequests = new Map<string, Promise<GitSummary>>()

export function findLatestSummary(messages: UnifiedMessage[]): UnifiedMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCompactSummaryLikeMessage(messages[index])) return messages[index]
  }
  return null
}

export function compactPath(path: string | null): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return parts.slice(-2).join('/')
}

function uniqueChangedFileCount(status: GitStatusDetailed): number {
  return new Set(
    [...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicted].map(
      (item) => item.path
    )
  ).size
}

function createEmptyGitSummary(): GitSummary {
  return {
    loading: false,
    branch: null,
    ahead: 0,
    behind: 0,
    changedFileCount: 0,
    added: null,
    deleted: null,
    dirty: false,
    error: null
  }
}

async function loadGitSummary(
  workingFolder: string,
  sshConnectionId: string | null
): Promise<GitSummary> {
  const target = { cwd: workingFolder, sshConnectionId }
  const statusResult = await invokeMessagePackBinary<
    GitResultBase & { status?: GitStatusDetailed }
  >(toMessagePackChannel(IPC.GIT_GET_STATUS_DETAILED), target)

  if (!statusResult.success || !statusResult.status) {
    return {
      ...createEmptyGitSummary(),
      error: statusResult.error ?? 'Git status unavailable'
    }
  }

  const status = statusResult.status
  const dirty =
    status.staged.length > 0 ||
    status.unstaged.length > 0 ||
    status.untracked.length > 0 ||
    status.conflicted.length > 0
  const hasTrackedChanges =
    status.staged.length > 0 || status.unstaged.length > 0 || status.conflicted.length > 0
  let added: number | null = null
  let deleted: number | null = null

  if (hasTrackedChanges) {
    const lineSummary = await invokeMessagePackBinary<GitLineSummaryResult>(
      toMessagePackChannel(IPC.GIT_GET_LINE_SUMMARY),
      target
    )
    if (lineSummary.success) {
      added = lineSummary.added ?? 0
      deleted = lineSummary.deleted ?? 0
    }
  }

  return {
    loading: false,
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    changedFileCount: uniqueChangedFileCount(status),
    added,
    deleted,
    dirty,
    error: null
  }
}

export function useGitSummary(
  workingFolder: string | null,
  sshConnectionId: string | null
): GitSummary {
  const [summary, setSummary] = useState<GitSummary>(createEmptyGitSummary)

  useEffect(() => {
    if (!workingFolder) {
      setSummary(createEmptyGitSummary())
      return
    }

    let cancelled = false
    const cacheKey = `${sshConnectionId ?? 'local'}:${workingFolder}`
    const cached = gitSummaryCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      setSummary(cached.summary)
      return
    }

    setSummary((current) => ({ ...current, loading: true, error: null }))
    let request = gitSummaryRequests.get(cacheKey)
    if (!request) {
      request = loadGitSummary(workingFolder, sshConnectionId)
      gitSummaryRequests.set(cacheKey, request)
      const clearRequest = (): void => {
        if (gitSummaryRequests.get(cacheKey) === request) gitSummaryRequests.delete(cacheKey)
      }
      void request.then(clearRequest, clearRequest)
    }

    void request
      .then((nextSummary) => {
        gitSummaryCache.set(cacheKey, {
          expiresAt: Date.now() + GIT_SUMMARY_CACHE_MS,
          summary: nextSummary
        })
        if (!cancelled) setSummary(nextSummary)
      })
      .catch((error) => {
        console.error('[SessionSummaryPanel] Failed to load Git summary:', error)
        if (!cancelled) {
          setSummary({ ...createEmptyGitSummary(), error: 'Git status unavailable' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [sshConnectionId, workingFolder])

  return summary
}
