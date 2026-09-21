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
  /**
   * 这次发现的更新来自后台巡检：只点亮顶栏图标，别主动弹窗打扰。
   * 刷新页面后回到 false —— 那是用户自己的操作，弹一次不算打扰。
   */
  silentAnnounce: boolean
  refreshStatus: () => Promise<void>
  checkForUpdates: (options?: { preserveOnSkipped?: boolean }) => Promise<void>
  /**
   * 用户点顶栏图标时的重查。与 `checkForUpdates` 的区别只有一个：跳过（dev / 不支持检查 / 远端
   * 没给结果）时什么都不改，见实现处的注释。
   */
  recheckLatest: () => Promise<void>
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => Promise<void>
  openReleasePage: () => void
} {
  const [state, setState] = useState<RendererUpdateState>(INITIAL_STATE)
  const [silentAnnounce, setSilentAnnounce] = useState(false)

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
      setSilentAnnounce(payload.silent === true)
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
      // Applied verbatim: Main has already clamped and monotonic-checked these, so quoting them
      // unchanged is what keeps the UI, the structured log and the report on one set of numbers.
      setState((previous) => ({
        ...previous,
        phase: 'downloading',
        percent: payload.percent,
        transferred: payload.transferred,
        total: payload.total,
        bytesPerSecond: payload.bytesPerSecond,
        elapsedMs: payload.elapsedMs,
        declaredInstallerSize: payload.declaredInstallerSize,
        error: null
      }))
    })
    const unsubscribeDownloaded = window.api.on<UpdateDownloadedPayload>('update:downloaded', (payload) => {
      if (disposed) return
      setState((previous) => ({
        ...previous,
        phase: 'downloaded',
        downloadedVersion: payload.version,
        percent: payload.percent,
        transferred: payload.transferred,
        total: payload.total,
        bytesPerSecond: payload.bytesPerSecond,
        elapsedMs: payload.elapsedMs,
        declaredInstallerSize: payload.declaredInstallerSize,
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

  const checkForUpdates = useCallback(
    async (options?: { preserveOnSkipped?: boolean }): Promise<void> => {
      const preserveOnSkipped = options?.preserveOnSkipped === true
      // 只有在「跳过也不许动状态」时才不预置 checking：预置会把上一相位盖掉，跳过时就再也还不回来。
      // 其余情况保持预置 —— 弹窗里的「重新检查」正是靠它来禁用按钮并转圈的。
      if (!preserveOnSkipped) {
        setState((previous) => ({ ...previous, phase: 'checking', error: null }))
      }
      try {
        const result = await window.api.invoke<UpdateCheckResult>('update:check', {})
        if (isFailure(result)) {
          setState((previous) => ({ ...previous, phase: 'error', error: result.error, percent: null }))
          return
        }
        // 跳过不是「没有更新」，是「这次没问到」。拿它去清 availableVersion 会让手上那个已经亮起来
        // 的更新信号凭空消失 —— 而调用方（点图标）本就是被那个信号引过来的。
        if (preserveOnSkipped && result.skipped) return
        setState((previous) => {
          // 已经下载好的那个包仍然是最新版本 ⇒ 停在「等安装」，别退回「发现新版本」：那会让用户手上
          // 那个下好的包看起来不存在了，只能重下一遍。
          const downloadedIsLatest =
            previous.downloadedVersion !== null && previous.downloadedVersion === result.latestVersion
          return {
            ...previous,
            phase: downloadedIsLatest ? 'downloaded' : result.available ? 'available' : 'idle',
            currentVersion: result.currentVersion,
            availableVersion: result.available ? result.latestVersion : null,
            distribution: result.distribution,
            supportsAutoInstall: result.supportsAutoInstall,
            releaseUrl: result.releaseUrl,
            error: null
          }
        })
      } catch (error) {
        setState((previous) => ({ ...previous, phase: 'error', error: String(error), percent: null }))
      }
    },
    []
  )

  /**
   * 点顶栏图标触发的重查。调用方不等它 —— 弹窗先按已有快照打开，这里在后台把远端版本刷到最新，
   * 内容随 state 自己刷新。这件事的意义在于：用户「发现有更新但一直没处理」时，最需要的正是这一次
   * 能直接跳到最新版，而不是从旧版本开始一级一级追。
   *
   * 不能当成巡检：这是用户主动发起的一次查询，`silentAnnounce` 留着会让 App 把随后发现的更新
   * 当作静默通报处理。
   */
  const recheckLatest = useCallback(async (): Promise<void> => {
    setSilentAnnounce(false)
    await checkForUpdates({ preserveOnSkipped: true })
  }, [checkForUpdates])

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

  return {
    state,
    silentAnnounce,
    refreshStatus,
    checkForUpdates,
    recheckLatest,
    downloadUpdate,
    installUpdate,
    openReleasePage
  }
}
