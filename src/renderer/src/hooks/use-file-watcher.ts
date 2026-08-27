/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

interface UseFileWatcherOptions {
  readContent?: boolean
}

interface UseFileWatcherResult {
  content: string
  setContent: Dispatch<SetStateAction<string>>
  loading: boolean
  /** Read failure message, or null. Distinguishes "read failed" from "empty file". */
  error: string | null
  reload: () => Promise<void>
  version: number
}

function getReadError(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error?: unknown }).error
    return typeof error === 'string' && error.length > 0 ? error : 'Failed to read file'
  }

  if (typeof result !== 'string' || !result.trim().startsWith('{')) return null

  try {
    const parsed = JSON.parse(result) as { error?: unknown }
    return typeof parsed.error === 'string' && parsed.error.length > 0 ? parsed.error : null
  } catch {
    return null
  }
}

function getChangedPath(args: unknown[]): string | null {
  const payload = args[0]
  if (!payload || typeof payload !== 'object' || !('path' in payload)) return null

  const path = (payload as { path?: unknown }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}

function normalizeWatchPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function getResolvedWatchPath(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('path' in result)) return null

  const path = (result as { path?: unknown }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}

export function useFileWatcher(
  filePath: string | null,
  sshConnectionId?: string,
  options: UseFileWatcherOptions = {}
): UseFileWatcherResult {
  const readContent = options.readContent ?? true
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const requestIdRef = useRef(0)
  const watchedPathRef = useRef<string | null>(null)

  const loadContent = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!filePath) {
      setContent('')
      setError(null)
      setLoading(false)
      return
    }
    if (!readContent) {
      setContent('')
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const channel = sshConnectionId ? IPC.SSH_FS_READ_FILE : IPC.FS_READ_FILE
      const args = sshConnectionId
        ? { connectionId: sshConnectionId, path: filePath }
        : { path: filePath }
      const result = await ipcClient.invoke(channel, args)
      const readError = getReadError(result)
      if (readError) {
        throw new Error(readError)
      }
      if (requestId === requestIdRef.current) {
        setContent(String(result))
        setError(null)
      }
    } catch (err) {
      console.error('[useFileWatcher] Failed to read file:', err)
      if (requestId === requestIdRef.current) {
        setContent('')
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [filePath, readContent, sshConnectionId])

  const reload = useCallback(async () => {
    setVersion((current) => current + 1)
    await loadContent()
  }, [loadContent])

  // Initial load
  useEffect(() => {
    loadContent()
  }, [loadContent])

  // Watch for changes
  useEffect(() => {
    if (!filePath || sshConnectionId) return

    let disposed = false
    const requestedWatchPath = normalizeWatchPath(filePath)
    watchedPathRef.current = requestedWatchPath

    ipcClient
      .invoke(IPC.FS_WATCH_FILE, { path: filePath })
      .then((result) => {
        if (disposed) return
        const resolvedWatchPath = getResolvedWatchPath(result)
        watchedPathRef.current = resolvedWatchPath
          ? normalizeWatchPath(resolvedWatchPath)
          : requestedWatchPath
      })
      .catch(() => {})

    const handler = (...args: unknown[]): void => {
      const changedPath = getChangedPath(args)
      const watchedPath = watchedPathRef.current ?? requestedWatchPath
      if (!changedPath || normalizeWatchPath(changedPath) !== watchedPath) return

      setVersion((current) => current + 1)
      if (readContent) void loadContent()
    }
    const cleanup = ipcClient.on(IPC.FS_FILE_CHANGED, handler)

    return () => {
      disposed = true
      cleanup()
      ipcClient.invoke(IPC.FS_UNWATCH_FILE, { path: filePath }).catch(() => {})
    }
  }, [filePath, loadContent, readContent, sshConnectionId])

  return { content, setContent, loading, error, reload, version }
}
