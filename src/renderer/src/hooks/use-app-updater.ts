import { useCallback, useEffect, useState } from 'react'
import type {
  RendererUpdateState,
  UpdateAvailablePayload,
  UpdateCheckResult,
  UpdateDownloadedPayload,
  UpdateDownloadProgressPayload,
  UpdateErrorPayload,
  UpdateStatus
} from '@shared/updater/types'

const INITIAL_STATE: RendererUpdateState = {
  phase: 'idle',
  currentVersion: '',
  availableVersion: null,
  downloadedVersion: null,
  progress: null,
  releaseNotes: '',
  error: null,
  distribution: 'installer',
  supportsAutoInstall: false,
  releaseUrl: ''
}

function isFailure(value: unknown): value is { success: false; error: string } {
  return Boolean(value && typeof value === 'object' && (value as { success?: unknown }).success === false)
}

export function useAppUpdater(): {
  state: RendererUpdateState
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openReleasePage: () => void
} {
  const [state, setState] = useState<RendererUpdateState>(INITIAL_STATE)

  const applyStatus = useCallback((status: UpdateStatus): void => {
    setState((previous) => ({
      ...previous,
      ...status,
      availableVersion: status.availableVersion ?? previous.availableVersion,
      downloadedVersion: status.downloadedVersion ?? previous.downloadedVersion,
      releaseNotes: status.releaseNotes || previous.releaseNotes,
      progress: status.phase === 'downloading' ? previous.progress : null,
      error: null
    }))
  }, [])

  useEffect(() => {
    let disposed = false
    const unsubscribeAvailable = window.api.on<UpdateAvailablePayload>('update:available', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'available',
        currentVersion: payload.currentVersion,
        availableVersion: payload.newVersion,
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
        progress: Math.max(0, Math.min(100, payload.percent)),
        error: null
      }))
    })
    const unsubscribeDownloaded = window.api.on<UpdateDownloadedPayload>('update:downloaded', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'downloaded',
        downloadedVersion: payload.version,
        progress: 100,
        error: null
      }))
    })
    const unsubscribeError = window.api.on<UpdateErrorPayload>('update:error', (payload) => {
      if (disposed) return
      setState((previous) => ({ ...previous, phase: 'error', error: payload.error, progress: null }))
    })

    void window.api.invoke<UpdateStatus>('update:status', {}).then((status) => {
      if (!disposed && !isFailure(status)) applyStatus(status)
    }).catch(() => {
      // The updater is optional in development and must not block the renderer.
    })

    return () => {
      disposed = true
      unsubscribeAvailable()
      unsubscribeProgress()
      unsubscribeDownloaded()
      unsubscribeError()
    }
  }, [applyStatus])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }))
    try {
      const result = await window.api.invoke<UpdateCheckResult>('update:check', {})
      if (isFailure(result)) {
        setState((previous) => ({ ...previous, phase: 'error', error: result.error, progress: null }))
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
      setState((previous) => ({ ...previous, phase: 'error', error: String(error), progress: null }))
    }
  }, [])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    setState((previous) => ({ ...previous, phase: 'downloading', progress: 0, error: null }))
    try {
      const result = await window.api.invoke<{ success: true } | { success: false; error: string }>('update:download', {})
      if (isFailure(result)) {
        setState((previous) => ({ ...previous, phase: 'error', error: result.error, progress: null }))
      }
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'error', error: String(error), progress: null }))
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

  return { state, checkForUpdates, downloadUpdate, installUpdate, openReleasePage }
}
