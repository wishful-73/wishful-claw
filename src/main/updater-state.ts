import {
  NO_UPDATE_OPERATION_ID,
  type UpdatePhase,
  type UpdateStateSnapshot
} from '../shared/updater/types'

/**
 * `downloaded → error` is deliberately absent: a stray electron-updater error must not erase a
 * finished download, otherwise the only "restart to install" affordance disappears and the user
 * has to re-download. `error → installing` is present so a failed install can be retried.
 */
const LEGAL_TRANSITIONS: Record<UpdatePhase, readonly UpdatePhase[]> = {
  idle: ['checking', 'error'],
  // A user clicking "download" outranks an in-flight check; once downloading starts, that
  // check's available/not-available events fail their own transition and are dropped.
  checking: ['available', 'downloading', 'idle', 'error'],
  available: ['checking', 'downloading', 'idle', 'error'],
  downloading: ['downloaded', 'error'],
  downloaded: ['checking', 'installing', 'idle'],
  installing: ['error'],
  error: ['checking', 'downloading', 'installing', 'idle']
}

export function canTransitionPhase(from: UpdatePhase, to: UpdatePhase): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to)
}

export interface UpdateProgressInput {
  percent?: number | null
  transferred?: number | null
  total?: number | null
  bytesPerSecond?: number | null
  declaredInstallerSize?: number | null
}

export interface UpdateAvailableInput {
  newVersion: string
  releaseNotes: string
}

export interface UpdaterStateOptions {
  currentVersion: string
  /** Injectable so tests can assert elapsedMs without waiting on a real clock. */
  now?: () => number
}

export interface UpdaterStateCoordinator {
  snapshot(): UpdateStateSnapshot
  beginCheck(): boolean
  applyAvailable(input: UpdateAvailableInput): boolean
  applyNotAvailable(): boolean
  beginDownload(expectedVersion: string): number
  applyProgress(operationId: number, input: UpdateProgressInput): boolean
  applyDownloaded(operationId: number, version: string): boolean
  beginInstall(): boolean
  fail(error: string): boolean
  failSilently(): boolean
}

interface CoordinatorState {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  releaseNotes: string
  operationId: number
  expectedVersion: string | null
  error: string | null
  percent: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
  declaredInstallerSize: number | null
  startedAt: number | null
  finishedAt: number | null
}

function isUsableMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function createUpdaterStateCoordinator(
  options: UpdaterStateOptions
): UpdaterStateCoordinator {
  const now = options.now ?? Date.now

  let state: CoordinatorState = {
    phase: 'idle',
    currentVersion: options.currentVersion,
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
    declaredInstallerSize: null,
    startedAt: null,
    finishedAt: null
  }

  function transition(to: UpdatePhase): boolean {
    if (!canTransitionPhase(state.phase, to)) return false
    state = { ...state, phase: to }
    return true
  }

  function elapsedMs(): number | null {
    if (state.startedAt === null) return null
    return Math.max(0, (state.finishedAt ?? now()) - state.startedAt)
  }

  function finish(): void {
    state = { ...state, finishedAt: state.finishedAt ?? now() }
  }

  return {
    snapshot(): UpdateStateSnapshot {
      return {
        phase: state.phase,
        currentVersion: state.currentVersion,
        availableVersion: state.availableVersion,
        downloadedVersion: state.downloadedVersion,
        releaseNotes: state.releaseNotes,
        operationId: state.operationId,
        expectedVersion: state.expectedVersion,
        error: state.error,
        percent: state.percent,
        transferred: state.transferred,
        total: state.total,
        bytesPerSecond: state.bytesPerSecond,
        elapsedMs: elapsedMs(),
        declaredInstallerSize: state.declaredInstallerSize
      }
    },

    beginCheck(): boolean {
      if (!transition('checking')) return false
      state = { ...state, error: null }
      return true
    },

    applyAvailable(input: UpdateAvailableInput): boolean {
      if (!input.newVersion) return false
      if (!transition('available')) return false
      state = {
        ...state,
        availableVersion: input.newVersion,
        downloadedVersion: null,
        releaseNotes: input.releaseNotes,
        expectedVersion: null,
        error: null,
        percent: null,
        transferred: null,
        total: null,
        bytesPerSecond: null,
        declaredInstallerSize: null,
        startedAt: null,
        finishedAt: null
      }
      return true
    },

    applyNotAvailable(): boolean {
      if (!transition('idle')) return false
      if (!state.downloadedVersion) {
        state = { ...state, availableVersion: null, releaseNotes: '', expectedVersion: null }
      }
      return true
    },

    beginDownload(expectedVersion: string): number {
      if (state.phase === 'downloading') {
        return state.expectedVersion === expectedVersion ? state.operationId : NO_UPDATE_OPERATION_ID
      }
      if (!expectedVersion) return NO_UPDATE_OPERATION_ID
      if (!transition('downloading')) return NO_UPDATE_OPERATION_ID

      state = {
        ...state,
        operationId: state.operationId + 1,
        expectedVersion,
        error: null,
        percent: null,
        transferred: null,
        total: null,
        bytesPerSecond: null,
        declaredInstallerSize: null,
        startedAt: now(),
        finishedAt: null
      }
      return state.operationId
    },

    applyProgress(operationId: number, input: UpdateProgressInput): boolean {
      if (state.phase !== 'downloading') return false
      if (operationId !== state.operationId) return false

      const percent = isUsableMetric(input.percent) ? Math.min(100, input.percent) : null
      const transferred = isUsableMetric(input.transferred) ? input.transferred : null
      // A backwards reading means the event belongs to a superseded operation, not that the
      // download rewound; applying it would make the visible bar jump back.
      if (percent !== null && state.percent !== null && percent < state.percent) return false
      if (transferred !== null && state.transferred !== null && transferred < state.transferred) {
        return false
      }

      state = {
        ...state,
        percent: percent ?? state.percent,
        transferred: transferred ?? state.transferred,
        total: isUsableMetric(input.total) ? input.total : state.total,
        bytesPerSecond: isUsableMetric(input.bytesPerSecond) ? input.bytesPerSecond : state.bytesPerSecond,
        declaredInstallerSize: isUsableMetric(input.declaredInstallerSize)
          ? input.declaredInstallerSize
          : state.declaredInstallerSize
      }
      return true
    },

    applyDownloaded(operationId: number, version: string): boolean {
      if (operationId !== state.operationId) return false
      if (version !== state.expectedVersion) return false
      if (!transition('downloaded')) return false
      finish()
      // Completion is an observation, not a guess: whatever the last progress event reported,
      // the package is now on disk.
      state = { ...state, downloadedVersion: version, percent: 100, error: null }
      return true
    },

    beginInstall(): boolean {
      if (state.phase === 'installing') return true
      // `error` is reachable from a failed check as well as a failed install; only the latter
      // has a package on disk, so retrying install requires a completed, version-matching download.
      const hasMatchingPackage =
        state.downloadedVersion !== null && state.downloadedVersion === state.expectedVersion
      if (state.phase === 'error' && !hasMatchingPackage) return false
      if (!transition('installing')) return false
      finish()
      state = { ...state, error: null }
      return true
    },

    fail(error: string): boolean {
      if (!transition('error')) return false
      finish()
      // availableVersion/expectedVersion survive so the user can retry the same download.
      state = { ...state, error }
      return true
    },

    failSilently(): boolean {
      if (!transition('idle')) return false
      finish()
      state = { ...state, error: null }
      return true
    }
  }
}

export interface UpdateDownloadStartAck {
  accepted: boolean
  operationId: number
}

export interface UpdateDownloadGateOptions {
  coordinator: UpdaterStateCoordinator
  /** Kicks off the native download. Its promise outlives the caller's request. */
  start: () => Promise<unknown>
  /** Where a late native rejection is reported, since the caller has long since been answered. */
  onFailure: (error: unknown) => void
}

export interface UpdateDownloadGate {
  request(expectedVersion: string): UpdateDownloadStartAck
  isInFlight(): boolean
}

/**
 * Decouples the download from the request that started it. `request` answers as soon as the
 * native download is under way, so closing the dialog or hiding the window cannot cancel it,
 * and a failure that surfaces minutes later is broadcast instead of being lost in an already
 * resolved IPC call.
 */
export function createUpdateDownloadGate(options: UpdateDownloadGateOptions): UpdateDownloadGate {
  let inFlight: Promise<void> | null = null

  return {
    request(expectedVersion: string): UpdateDownloadStartAck {
      const snapshot = options.coordinator.snapshot()
      if (inFlight) {
        // A second click reuses the live operation instead of starting a second native download.
        return snapshot.phase === 'downloading'
          ? { accepted: true, operationId: snapshot.operationId }
          : { accepted: false, operationId: NO_UPDATE_OPERATION_ID }
      }

      const operationId = options.coordinator.beginDownload(expectedVersion)
      if (operationId === NO_UPDATE_OPERATION_ID) return { accepted: false, operationId }

      inFlight = (async () => {
        try {
          await options.start()
        } catch (error) {
          options.onFailure(error)
        } finally {
          inFlight = null
        }
      })()
      return { accepted: true, operationId }
    },

    isInFlight(): boolean {
      return inFlight !== null
    }
  }
}

export type UpdateInstallOutcome = 'started' | 'already-installing' | 'refused'

export interface UpdateInstallGateOptions {
  coordinator: UpdaterStateCoordinator
  /** The only path permitted to reach electron-updater's `quitAndInstall`. */
  install: () => void
  /** Where a synchronous throw from `install` is reported, so the phase recovers to `error`. */
  onFailure: (error: unknown) => void
}

export interface UpdateInstallGate {
  request(): UpdateInstallOutcome
}

/**
 * Makes the install contract countable instead of merely documented. `install()` runs at most once
 * per explicit user request and never unless the coordinator agrees a version-matching package is on
 * disk — so completion, closing the dialog, hiding to tray, a renderer reload and a normal quit all
 * provably produce zero calls. `already-installing` is kept distinct from `started` so a repeated
 * click still answers success without scheduling a second restart.
 */
export function createUpdateInstallGate(options: UpdateInstallGateOptions): UpdateInstallGate {
  return {
    request(): UpdateInstallOutcome {
      if (options.coordinator.snapshot().phase === 'installing') return 'already-installing'
      if (!options.coordinator.beginInstall()) return 'refused'
      try {
        options.install()
      } catch (error) {
        // Reported rather than rethrown: the caller has already been answered, and a phase stuck in
        // `installing` would leave the user no way to retry.
        options.onFailure(error)
      }
      return 'started'
    }
  }
}
