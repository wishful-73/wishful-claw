export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export type UpdateDistribution = 'installer' | 'green' | 'compat'

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

export interface UpdateStatus extends UpdateDistributionInfo {
  success: true
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  releaseNotes: string
  phase: UpdatePhase
}

export interface RendererUpdateState extends UpdateDistributionInfo {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  progress: number | null
  releaseNotes: string
  error: string | null
}
