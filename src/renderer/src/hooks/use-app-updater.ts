import { useCallback, useEffect, useState } from 'react'
import { NO_UPDATE_OPERATION_ID } from '@shared/updater/types'
import type {
  RendererUpdateState,
  UpdateAvailablePayload,
  UpdateCheckResult,
  UpdateDownloadedPayload,
  UpdateDownloadProgressPayload,
  UpdateDownloadStartResult,
  UpdateErrorPayload,
  UpdateStatus
} from '@shared/updater/types'

const INITIAL_STATE: RendererUpdateState = {
  phase: 'idle',
  currentVersion: '',
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: '',
  operationId: NO_UPDATE_OPERATION_ID,
  expectedVersion: null,
  error: null,
  percent: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
  elapsedMs: null,
  declaredInstallerSize: null,
  distribution: 'installer',
  supportsAutoInstall: false,
  releaseUrl: ''
}

function isFailure(value: unknown): value is { success: false; error: string } {
  return Boolean(value && typeof value === 'object' && (value as { success?: unknown }).success === false)
}

export function useAppUpdater(): {
  state: RendererUpdateState
  refreshStatus: () => Promise<void>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => Promise<void>
  openReleasePage: () => void
} {
  const [state, setState] = useState<RendererUpdateState>(INITIAL_STATE)

  // Main owns the whole snapshot, so a status reply replaces renderer state outright instead of
  // being merged field by field — merging is what let a stale value survive a remount.
  const applyStatus = useCallback((status: UpdateStatus): void => {
    const snapshot: RendererUpdateState = status
    setState(snapshot)
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.invoke<UpdateStatus>('update:status', {})
      if (!isFailure(status)) applyStatus(status)
    } catch {
      // The updater is optional in development and must not block the renderer.
    }
  }, [applyStatus])

  useEffect(() => {
    let disposed = false
    const unsubscribeAvailable = window.api.on<UpdateAvailablePayload>('update:available', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'available',
        currentVersion: payload.currentVersion,
        availableVersion: payload.newVersion,
        downloadedVersion: null,
        expectedVersion: null,
        releaseNotes: payload.releaseNotes,
        distribution: payload.distribution,
        supportsAutoInstall: payload.supportsAutoInstall,
        releaseUrl: payload.releaseUrl,
        error: null
      }))
    })
    const unsubscribeProgress = window.api.on<UpdateDownloadProgressPayload>('update:download-progress', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'downloading',
        percent: Math.max(0, Math.min(100, payload.percent)),
        error: null
      }))
    })
    const unsubscribeDownloaded = window.api.on<UpdateDownloadedPayload>('update:downloaded', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'downloaded',
        downloadedVersion: payload.version,
        percent: 100,
        error: null
      }))
    })
    const unsubscribeError = window.api.on<UpdateErrorPayload>('update:error', (payload) => {
      if (disposed) return
      setState((previous) => ({ ...previous, phase: 'error', error: payload.error, percent: null }))
    })

    void refreshStatus()

    return () => {
      disposed = true
      unsubscribeAvailable()
      unsubscribeProgress()
      unsubscribeDownloaded()
      unsubscribeError()
    }
  }, [refreshStatus])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }))
    try {
      const result = await window.api.invoke<UpdateCheckResult>('update:check', {})
      if (isFailure(result)) {
        setState((previous) => ({ ...previous, phase: 'error', error: result.error, percent: null }))
        return
      }
      setState((previous) => ({
        ...previous,
        phase: result.available ? 'available' : 'idle',
        currentVersion: result.currentVersion,
        availableVersion: result.available ? result.latestVersion : null,
        distribution: result.distribution,
        supportsAutoInstall: result.supportsAutoInstall,
        releaseUrl: result.releaseUrl,
        error: null
      }))
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'error', error: String(error), percent: null }))
    }
  }, [])

  const downloadUpdate = useCallback(async (): Promise<boolean> => {
    // No optimistic percent: the first real reading arrives with the first progress event, and
    // a fabricated 0 is indistinguishable from a stalled download.
    setState((previous) => ({ ...previous, phase: 'downloading', percent: null, error: null }))
    try {
      const result = await window.api.invoke<UpdateDownloadStartResult>('update:download', {})
      if (isFailure(result)) {
        setState((previous) => ({ ...previous, phase: 'error', error: result.error, percent: null }))
        return false
      }
      setState((previous) => ({ ...previous, operationId: result.operationId }))
      return true
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'error', error: String(error), percent: null }))
      return false
    }
  }, [])

  const installUpdate = useCallback(async (): Promise<void> => {
    setState((previous) => ({ ...previous, phase: 'installing', error: null }))
    try {
      const result = await window.api.invoke<{ success: true } | { success: false; error: string }>('update:install', {})
      if (isFailure(result)) {
        setState((previous) => ({ ...previous, phase: 'error', error: result.error }))
      }
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'error', error: String(error) }))
    }
  }, [])

  const openReleasePage = useCallback((): void => {
    if (state.releaseUrl) {
      void window.api.invoke<void>('shell:openExternal', state.releaseUrl)
    }
  }, [state.releaseUrl])

  return { state, refreshStatus, checkForUpdates, downloadUpdate, installUpdate, openReleasePage }
}
