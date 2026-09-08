export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export type UpdateDistribution = 'installer' | 'green' | 'compat'

/** Operation ids count up from 1; 0 means no download operation has ever been started. */
export const NO_UPDATE_OPERATION_ID = 0

export interface UpdateDistributionInfo {
  distribution: UpdateDistribution
  supportsAutoInstall: boolean
  releaseUrl: string
}

export interface UpdateAvailablePayload extends UpdateDistributionInfo {
  currentVersion: string
  newVersion: string
  releaseNotes: string
}

/**
 * Byte-level download observations. `null` means electron-updater never reported the value,
 * which must stay distinguishable from a real `0` — a differential download legitimately
 * transfers far fewer bytes than `declaredInstallerSize`, and an unknown total must render as
 * "unknown" rather than as an empty progress bar.
 */
export interface UpdateProgressSnapshot {
  percent: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
  elapsedMs: number | null
  declaredInstallerSize: number | null
}

export interface UpdateStateSnapshot extends UpdateProgressSnapshot {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  releaseNotes: string
  operationId: number
  expectedVersion: string | null
  error: string | null
}

export interface UpdateDownloadProgressPayload {
  percent: number
}

export interface UpdateDownloadedPayload {
  version: string
}

export interface UpdateErrorPayload {
  error: string
}

export interface UpdateCheckSuccess extends UpdateDistributionInfo {
  success: true
  available: boolean
  currentVersion: string
  latestVersion: string | null
  skipped: boolean
}

export interface UpdateFailure {
  success: false
  error: string
}

export type UpdateCheckResult = UpdateCheckSuccess | UpdateFailure

export type UpdateActionResult = { success: true } | UpdateFailure

/**
 * `update:download` acknowledges the *start* of the download, not its completion — the native
 * promise keeps running in Main after the dialog closes. The operationId lets the renderer
 * correlate the progress events that follow.
 */
export type UpdateDownloadStartResult = { success: true; operationId: number } | UpdateFailure

/**
 * The whole snapshot is rebuilt from this one object on every renderer mount, so a remounted
 * window (dialog closed, main window hidden, renderer reloaded) never needs event history.
 */
export type RendererUpdateState = UpdateStateSnapshot & UpdateDistributionInfo

export type UpdateStatus = RendererUpdateState & { success: true }
