import assert from 'node:assert/strict'
import { NO_UPDATE_OPERATION_ID } from '../../src/shared/updater/types'
import type { UpdatePhase, UpdateProgressSnapshot, UpdateStateSnapshot } from '../../src/shared/updater/types'
import {
  canTransitionPhase,
  createUpdateDownloadGate,
  createUpdaterStateCoordinator,
  type UpdaterStateCoordinator
} from '../../src/main/updater-state'

let checks = 0

function check(description: string, run: () => void): void {
  checks += 1
  try {
    run()
  } catch (error) {
    console.error(`FAIL: ${description}`)
    throw error
  }
}

interface AsyncCheck {
  description: string
  run: () => Promise<void>
}

const asyncChecks: AsyncCheck[] = []

// The bundle is CJS, so top-level await is unavailable; async checks are queued here and run
// sequentially at the end, where a rejection still exits non-zero.
function checkAsync(description: string, run: () => Promise<void>): void {
  asyncChecks.push({ description, run })
}

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
} {
  let resolve = (): void => {}
  let reject = (_error: unknown): void => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Flushes every microtask queued by the gate's background promise. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const CURRENT_VERSION = '0.2.25'
const NEXT_VERSION = '0.2.26'

/** The §3.1 fixed field set — a snapshot must carry exactly these and nothing else. */
const SNAPSHOT_FIELDS = [
  'availableVersion',
  'bytesPerSecond',
  'currentVersion',
  'declaredInstallerSize',
  'downloadedVersion',
  'elapsedMs',
  'error',
  'expectedVersion',
  'operationId',
  'percent',
  'phase',
  'releaseNotes',
  'total',
  'transferred'
]

function createHarness(startMs = 1_000): {
  coordinator: UpdaterStateCoordinator
  advance: (ms: number) => void
} {
  let clock = startMs
  const coordinator = createUpdaterStateCoordinator({
    currentVersion: CURRENT_VERSION,
    now: () => clock
  })
  return {
    coordinator,
    advance: (ms) => {
      clock += ms
    }
  }
}

function reachAvailable(
  coordinator: UpdaterStateCoordinator,
  version: string = NEXT_VERSION
): void {
  assert.equal(coordinator.beginCheck(), true, 'beginCheck should be accepted from idle')
  assert.equal(
    coordinator.applyAvailable({ newVersion: version, releaseNotes: '## Notes' }),
    true,
    'applyAvailable should be accepted from checking'
  )
}

function startDownload(
  coordinator: UpdaterStateCoordinator,
  version: string = NEXT_VERSION
): number {
  const operationId = coordinator.beginDownload(version)
  assert.notEqual(operationId, NO_UPDATE_OPERATION_ID, 'beginDownload should be accepted')
  return operationId
}

function numericSnapshot(snapshot: UpdateStateSnapshot): UpdateProgressSnapshot {
  return {
    percent: snapshot.percent,
    transferred: snapshot.transferred,
    total: snapshot.total,
    bytesPerSecond: snapshot.bytesPerSecond,
    elapsedMs: snapshot.elapsedMs,
    declaredInstallerSize: snapshot.declaredInstallerSize
  }
}

// ---------------------------------------------------------------- transition table

check('same phase is always a legal transition', () => {
  const phases: UpdatePhase[] = [
    'idle',
    'checking',
    'available',
    'downloading',
    'downloaded',
    'installing',
    'error'
  ]
  for (const phase of phases) {
    assert.equal(canTransitionPhase(phase, phase), true, `${phase} → ${phase}`)
  }
})

check('the documented forward flow is legal', () => {
  assert.equal(canTransitionPhase('idle', 'checking'), true)
  assert.equal(canTransitionPhase('checking', 'available'), true)
  assert.equal(canTransitionPhase('available', 'downloading'), true)
  assert.equal(canTransitionPhase('downloading', 'downloaded'), true)
  assert.equal(canTransitionPhase('downloaded', 'installing'), true)
})

check('recovery paths are legal', () => {
  assert.equal(canTransitionPhase('checking', 'idle'), true, 'a failed check returns to idle')
  assert.equal(canTransitionPhase('downloading', 'error'), true)
  assert.equal(canTransitionPhase('error', 'downloading'), true, 'retry')
  assert.equal(canTransitionPhase('error', 'installing'), true, 'retry a failed install')
})

check('an active download cannot be hijacked', () => {
  assert.equal(canTransitionPhase('downloading', 'checking'), false)
  assert.equal(canTransitionPhase('downloading', 'available'), false)
  assert.equal(canTransitionPhase('downloading', 'idle'), false)
  assert.equal(canTransitionPhase('downloading', 'installing'), false)
})

check('a finished download cannot be erased by a stray error', () => {
  assert.equal(canTransitionPhase('downloaded', 'error'), false)
  assert.equal(canTransitionPhase('downloaded', 'downloading'), false)
})

check('installing only ever ends in error', () => {
  assert.equal(canTransitionPhase('installing', 'idle'), false)
  assert.equal(canTransitionPhase('installing', 'downloaded'), false)
  assert.equal(canTransitionPhase('installing', 'error'), true)
})

// ---------------------------------------------------------------- initial snapshot

check('a fresh snapshot carries exactly the fixed field set', () => {
  const { coordinator } = createHarness()
  assert.deepEqual(Object.keys(coordinator.snapshot()).sort(), SNAPSHOT_FIELDS)
})

check('unknown numerics are null, never a fabricated 0 or 100', () => {
  const { coordinator } = createHarness()
  assert.deepEqual(numericSnapshot(coordinator.snapshot()), {
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    elapsedMs: null,
    declaredInstallerSize: null
  })
})

check('a fresh snapshot starts idle with no operation and no version', () => {
  const { coordinator } = createHarness()
  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.currentVersion, CURRENT_VERSION)
  assert.equal(snapshot.availableVersion, null)
  assert.equal(snapshot.downloadedVersion, null)
  assert.equal(snapshot.releaseNotes, '')
  assert.equal(snapshot.operationId, NO_UPDATE_OPERATION_ID)
  assert.equal(snapshot.expectedVersion, null)
  assert.equal(snapshot.error, null)
})

check('the snapshot is a copy, so callers cannot mutate coordinator state', () => {
  const { coordinator } = createHarness()
  const snapshot = coordinator.snapshot()
  snapshot.phase = 'installing'
  snapshot.percent = 100
  assert.equal(coordinator.snapshot().phase, 'idle')
  assert.equal(coordinator.snapshot().percent, null)
})

// ---------------------------------------------------------------- check / available

check('beginCheck is refused while a download is in flight', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  startDownload(coordinator)
  assert.equal(coordinator.beginCheck(), false)
  assert.equal(coordinator.snapshot().phase, 'downloading')
})

check('applyAvailable rejects an empty version', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(coordinator.applyAvailable({ newVersion: '', releaseNotes: 'x' }), false)
  assert.equal(coordinator.snapshot().phase, 'checking')
})

check('applyAvailable clears a previous download and its progress readings', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(
    coordinator.applyProgress(operationId, { percent: 40, transferred: 400, total: 1000 }),
    true
  )
  assert.equal(coordinator.fail('network down'), true)
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(
    coordinator.applyAvailable({ newVersion: '0.2.27', releaseNotes: 'newer' }),
    true
  )

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.availableVersion, '0.2.27')
  assert.equal(snapshot.downloadedVersion, null)
  assert.equal(snapshot.expectedVersion, null)
  assert.equal(snapshot.releaseNotes, 'newer')
  assert.equal(snapshot.error, null)
  assert.deepEqual(numericSnapshot(snapshot), {
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    elapsedMs: null,
    declaredInstallerSize: null
  })
})

check('update-not-available clears the offer but protects an active download', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  assert.equal(coordinator.applyNotAvailable(), true)
  let snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.availableVersion, null)
  assert.equal(snapshot.releaseNotes, '')

  reachAvailable(coordinator)
  startDownload(coordinator)
  assert.equal(coordinator.applyNotAvailable(), false)
  snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'downloading')
  assert.equal(snapshot.availableVersion, NEXT_VERSION)
})

check('update-not-available keeps a downloaded update reachable', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(coordinator.applyNotAvailable(), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.downloadedVersion, NEXT_VERSION)
  assert.equal(snapshot.availableVersion, NEXT_VERSION)
  assert.equal(snapshot.releaseNotes, '## Notes')
})

// ---------------------------------------------------------------- operationId

check('the first download mints operationId 1 and fixes expectedVersion', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(operationId, 1)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.operationId, 1)
  assert.equal(snapshot.expectedVersion, NEXT_VERSION)
  assert.equal(snapshot.phase, 'downloading')
  assert.equal(snapshot.error, null)
})

check('a repeated download request returns the same operationId (single-flight)', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const first = startDownload(coordinator)
  assert.equal(coordinator.beginDownload(NEXT_VERSION), first)
  assert.equal(coordinator.beginDownload(NEXT_VERSION), first)
  assert.equal(coordinator.snapshot().operationId, first)
})

check('a different version cannot start a second concurrent operation', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const first = startDownload(coordinator)
  assert.equal(coordinator.beginDownload('0.2.27'), NO_UPDATE_OPERATION_ID)
  assert.equal(coordinator.snapshot().operationId, first)
  assert.equal(coordinator.snapshot().expectedVersion, NEXT_VERSION)
})

check('a download cannot start with no target version', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginDownload(''), NO_UPDATE_OPERATION_ID)
  reachAvailable(coordinator)
  assert.equal(coordinator.beginDownload(''), NO_UPDATE_OPERATION_ID)
  assert.equal(coordinator.snapshot().phase, 'available')
})

check('a download cannot start from idle', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginDownload(NEXT_VERSION), NO_UPDATE_OPERATION_ID)
  assert.equal(coordinator.snapshot().phase, 'idle')
  assert.equal(coordinator.snapshot().operationId, NO_UPDATE_OPERATION_ID)
})

check('a retry after failure mints a new, larger operationId', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const first = startDownload(coordinator)
  assert.equal(coordinator.fail('network down'), true)
  const second = coordinator.beginDownload(NEXT_VERSION)
  assert.equal(second, first + 1)
  assert.equal(coordinator.snapshot().phase, 'downloading')
  assert.equal(coordinator.snapshot().error, null)
})

// ---------------------------------------------------------------- progress

check('progress readings are recorded and elapsedMs ticks with the clock', () => {
  const { coordinator, advance } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  advance(1_500)

  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: 25,
      transferred: 2_500,
      total: 10_000,
      bytesPerSecond: 500,
      declaredInstallerSize: 80_000_000
    }),
    true
  )

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 25)
  assert.equal(snapshot.transferred, 2_500)
  assert.equal(snapshot.total, 10_000)
  assert.equal(snapshot.bytesPerSecond, 500)
  assert.equal(snapshot.declaredInstallerSize, 80_000_000)
  assert.equal(snapshot.elapsedMs, 1_500)

  advance(2_000)
  assert.equal(coordinator.applyProgress(operationId, { percent: 50 }), true)
  assert.equal(coordinator.snapshot().elapsedMs, 3_500)
  // Fields absent from an event keep their last observed value.
  assert.equal(coordinator.snapshot().total, 10_000)
  assert.equal(coordinator.snapshot().declaredInstallerSize, 80_000_000)
})

check('elapsedMs is null before any download and frozen after completion', () => {
  const { coordinator, advance } = createHarness()
  assert.equal(coordinator.snapshot().elapsedMs, null)
  reachAvailable(coordinator)
  assert.equal(coordinator.snapshot().elapsedMs, null)

  const operationId = startDownload(coordinator)
  advance(900)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  advance(10_000)
  assert.equal(coordinator.snapshot().elapsedMs, 900)
})

check('backwards percent is rejected and leaves the snapshot untouched', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyProgress(operationId, { percent: 60, transferred: 600 }), true)
  const before = coordinator.snapshot()

  assert.equal(coordinator.applyProgress(operationId, { percent: 20 }), false)
  assert.deepEqual(coordinator.snapshot(), before)
})

check('backwards transferred is rejected even when percent advances', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyProgress(operationId, { percent: 10, transferred: 1_000 }), true)

  assert.equal(coordinator.applyProgress(operationId, { percent: 20, transferred: 500 }), false)
  assert.equal(coordinator.snapshot().percent, 10)
  assert.equal(coordinator.snapshot().transferred, 1_000)
})

check('an equal reading is accepted so a stalled download still reports', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyProgress(operationId, { percent: 30, transferred: 300 }), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: 30, transferred: 300 }), true)
  assert.equal(coordinator.snapshot().percent, 30)
})

check('progress tagged with a stale operationId is dropped', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const first = startDownload(coordinator)
  assert.equal(coordinator.applyProgress(first, { percent: 70, transferred: 7_000 }), true)
  assert.equal(coordinator.fail('network down'), true)

  const second = coordinator.beginDownload(NEXT_VERSION)
  assert.equal(coordinator.applyProgress(first, { percent: 99, transferred: 9_900 }), false)
  assert.equal(coordinator.applyProgress(second, { percent: 5, transferred: 500 }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 5)
  assert.equal(snapshot.transferred, 500)
  assert.equal(snapshot.operationId, second)
})

check('progress tagged with NO_UPDATE_OPERATION_ID is dropped', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  startDownload(coordinator)
  assert.equal(
    coordinator.applyProgress(NO_UPDATE_OPERATION_ID, { percent: 10 }),
    false
  )
  assert.equal(coordinator.snapshot().percent, null)
})

check('progress is dropped outside the downloading phase', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  assert.equal(coordinator.applyProgress(1, { percent: 10 }), false)

  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: 10 }), false)
  assert.equal(coordinator.snapshot().percent, 100)
})

check('percent is clamped to 100 and unusable metrics are ignored', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)

  assert.equal(coordinator.applyProgress(operationId, { percent: 150 }), true)
  assert.equal(coordinator.snapshot().percent, 100)

  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: Number.NaN,
      transferred: -1,
      total: Number.POSITIVE_INFINITY,
      bytesPerSecond: undefined,
      declaredInstallerSize: null
    }),
    true,
    'unusable readings are ignored rather than refusing the whole event'
  )
  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 100)
  assert.equal(snapshot.transferred, null)
  assert.equal(snapshot.total, null)
  assert.equal(snapshot.bytesPerSecond, null)
  assert.equal(snapshot.declaredInstallerSize, null)
})

check('unusable metrics alone do not invalidate a usable percent', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)

  assert.equal(
    coordinator.applyProgress(operationId, { percent: 12, transferred: -5, total: Number.NaN }),
    true
  )
  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 12)
  assert.equal(snapshot.transferred, null)
  assert.equal(snapshot.total, null)
})

// ---------------------------------------------------------------- completion

check('a completion event for the wrong version is dropped', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, '0.2.27'), false)
  assert.equal(coordinator.snapshot().phase, 'downloading')
  assert.equal(coordinator.snapshot().downloadedVersion, null)
})

check('a completion event from a superseded operation is dropped', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const first = startDownload(coordinator)
  assert.equal(coordinator.fail('network down'), true)
  const second = coordinator.beginDownload(NEXT_VERSION)

  assert.equal(coordinator.applyDownloaded(first, NEXT_VERSION), false)
  assert.equal(coordinator.snapshot().phase, 'downloading')
  assert.equal(coordinator.applyDownloaded(second, NEXT_VERSION), true)
  assert.equal(coordinator.snapshot().downloadedVersion, NEXT_VERSION)
})

check('completion records the version, pins percent and keeps the last observed bytes', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: 99.4,
      transferred: 79_500_000,
      total: 80_000_000,
      bytesPerSecond: 1_200_000,
      declaredInstallerSize: 80_000_000
    }),
    true
  )
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'downloaded')
  assert.equal(snapshot.downloadedVersion, NEXT_VERSION)
  assert.equal(snapshot.percent, 100)
  assert.equal(snapshot.transferred, 79_500_000)
  assert.equal(snapshot.total, 80_000_000)
  assert.equal(snapshot.bytesPerSecond, 1_200_000)
  assert.equal(snapshot.declaredInstallerSize, 80_000_000)
  assert.equal(snapshot.error, null)
})

// ---------------------------------------------------------------- failure

check('a download failure keeps the retryable version and expectedVersion', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyProgress(operationId, { percent: 33, transferred: 3_300 }), true)
  assert.equal(coordinator.fail('Cannot reach the update server.'), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'error')
  assert.equal(snapshot.error, 'Cannot reach the update server.')
  assert.equal(snapshot.availableVersion, NEXT_VERSION)
  assert.equal(snapshot.expectedVersion, NEXT_VERSION)
  assert.equal(snapshot.downloadedVersion, null)
  // Last observed values survive so the report can show where it stopped.
  assert.equal(snapshot.percent, 33)
  assert.equal(snapshot.transferred, 3_300)
})

check('a silent failure returns to idle without surfacing an error', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(coordinator.failSilently(), true)
  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.error, null)
})

check('a silent failure cannot cancel an active download', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  startDownload(coordinator)
  assert.equal(coordinator.failSilently(), false)
  assert.equal(coordinator.snapshot().phase, 'downloading')
})

check('a failure is refused once the download already completed', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.fail('late error'), false)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.phase, 'downloaded')
  assert.equal(snapshot.error, null)
})

// ---------------------------------------------------------------- install

check('install is only reachable from downloaded', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginInstall(), false)
  reachAvailable(coordinator)
  assert.equal(coordinator.beginInstall(), false)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.beginInstall(), false)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.snapshot().phase, 'installing')
})

check('repeated install requests are idempotent', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.snapshot().phase, 'installing')
})

check('a failed install can be retried, a failed check cannot', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.fail('installer exited with 1'), true)
  assert.equal(coordinator.beginInstall(), true, 'the package is still on disk')

  const other = createHarness().coordinator
  reachAvailable(other)
  assert.equal(other.fail('network down'), true)
  assert.equal(other.beginInstall(), false, 'nothing was ever downloaded')
})

// ---------------------------------------------------------------- remount snapshot

check('a remounted renderer can rebuild everything from one in-flight snapshot', () => {
  const { coordinator, advance } = createHarness()
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  advance(2_400)
  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: 62.4,
      transferred: 49_920_000,
      total: 80_000_000,
      bytesPerSecond: 20_800_000,
      declaredInstallerSize: 80_000_000
    }),
    true
  )

  const snapshot = coordinator.snapshot()
  assert.deepEqual(Object.keys(snapshot).sort(), SNAPSHOT_FIELDS)
  assert.deepEqual(snapshot, {
    phase: 'downloading',
    currentVersion: CURRENT_VERSION,
    availableVersion: NEXT_VERSION,
    downloadedVersion: null,
    releaseNotes: '## Notes',
    operationId,
    expectedVersion: NEXT_VERSION,
    error: null,
    percent: 62.4,
    transferred: 49_920_000,
    total: 80_000_000,
    bytesPerSecond: 20_800_000,
    elapsedMs: 2_400,
    declaredInstallerSize: 80_000_000
  })

  // Reading the snapshot twice in the same instant is stable, so two remounts agree.
  assert.deepEqual(coordinator.snapshot(), snapshot)
})

// ---------------------------------------------------------------- download gate

interface GateHarness {
  coordinator: UpdaterStateCoordinator
  gate: ReturnType<typeof createUpdateDownloadGate>
  order: string[]
  failures: unknown[]
  startCalls: () => number
  /** The deferred controlling the most recent native start. */
  pending: () => ReturnType<typeof deferred>
}

function createGateHarness(onFailure?: (error: unknown) => void): GateHarness {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)

  const order: string[] = []
  const failures: unknown[] = []
  let startCalls = 0
  let download = deferred()

  const gate = createUpdateDownloadGate({
    coordinator,
    start: () => {
      startCalls += 1
      order.push('start')
      download = deferred()
      return download.promise.then(
        () => {
          order.push('native-completed')
        },
        (error: unknown) => {
          order.push('native-failed')
          throw error
        }
      )
    },
    onFailure: (error) => {
      failures.push(error)
      onFailure?.(error)
    }
  })

  return { coordinator, gate, order, failures, startCalls: () => startCalls, pending: () => download }
}

checkAsync('the start acknowledgement is returned before the download completes', async () => {
  const harness = createGateHarness()

  const ack = harness.gate.request(NEXT_VERSION)
  harness.order.push('ack')

  assert.deepEqual(ack, { accepted: true, operationId: 1 })
  assert.deepEqual(harness.order, ['start', 'ack'], 'ack must precede the native completion')
  assert.equal(harness.startCalls(), 1)
  assert.equal(harness.gate.isInFlight(), true)
  assert.equal(harness.coordinator.snapshot().phase, 'downloading')
  assert.equal(harness.coordinator.snapshot().expectedVersion, NEXT_VERSION)

  harness.pending().resolve()
  await settle()

  assert.deepEqual(harness.order, ['start', 'ack', 'native-completed'])
  assert.equal(harness.gate.isInFlight(), false)
  assert.equal(harness.failures.length, 0)
  // Completion is still reported by the native event, not by the ack.
  assert.equal(harness.coordinator.applyDownloaded(ack.operationId, NEXT_VERSION), true)
  assert.equal(harness.coordinator.snapshot().phase, 'downloaded')
})

checkAsync('a repeated request reuses the live operation and starts no second download', async () => {
  const harness = createGateHarness()

  const first = harness.gate.request(NEXT_VERSION)
  const second = harness.gate.request(NEXT_VERSION)
  const third = harness.gate.request(NEXT_VERSION)

  assert.deepEqual(second, first)
  assert.deepEqual(third, first)
  assert.equal(harness.startCalls(), 1)
  assert.equal(harness.coordinator.snapshot().operationId, first.operationId)

  harness.pending().resolve()
  await settle()
  assert.equal(harness.coordinator.applyDownloaded(first.operationId, NEXT_VERSION), true)

  // Once the package is on disk a further request is refused rather than re-downloading.
  assert.deepEqual(harness.gate.request(NEXT_VERSION), {
    accepted: false,
    operationId: NO_UPDATE_OPERATION_ID
  })
  assert.equal(harness.startCalls(), 1)
})

checkAsync('a background failure is broadcast and a retry starts a fresh operation', async () => {
  const harness = createGateHarness((error) => {
    harness.coordinator.fail(String(error))
  })

  const first = harness.gate.request(NEXT_VERSION)
  assert.equal(first.accepted, true)
  assert.equal(harness.coordinator.snapshot().phase, 'downloading')

  harness.pending().reject(new Error('network down'))
  await settle()

  assert.deepEqual(harness.order, ['start', 'native-failed'])
  assert.equal(harness.failures.length, 1)
  assert.equal(harness.gate.isInFlight(), false, 'the gate must free itself after a failure')
  assert.equal(harness.coordinator.snapshot().phase, 'error')
  assert.equal(harness.coordinator.snapshot().expectedVersion, NEXT_VERSION)

  const retry = harness.gate.request(NEXT_VERSION)
  assert.deepEqual(retry, { accepted: true, operationId: first.operationId + 1 })
  assert.equal(harness.startCalls(), 2)
  assert.equal(harness.coordinator.snapshot().phase, 'downloading')
  assert.equal(harness.coordinator.snapshot().error, null)

  harness.pending().resolve()
  await settle()
  assert.equal(harness.coordinator.applyDownloaded(retry.operationId, NEXT_VERSION), true)
  // The first operation's late completion must not touch the retried one.
  assert.equal(harness.coordinator.applyDownloaded(first.operationId, NEXT_VERSION), false)
  assert.equal(harness.coordinator.snapshot().phase, 'downloaded')
})

checkAsync('the gate refuses without touching the native downloader when the coordinator refuses', async () => {
  const { coordinator } = createHarness()
  let startCalls = 0
  const gate = createUpdateDownloadGate({
    coordinator,
    start: () => {
      startCalls += 1
      return Promise.resolve()
    },
    onFailure: () => {}
  })

  assert.deepEqual(gate.request(NEXT_VERSION), {
    accepted: false,
    operationId: NO_UPDATE_OPERATION_ID
  })
  assert.equal(startCalls, 0)
  assert.equal(gate.isInFlight(), false)
  assert.equal(coordinator.snapshot().phase, 'idle')
})

checkAsync('a hidden window neither cancels the download nor installs it', async () => {
  const harness = createGateHarness()
  const ack = harness.gate.request(NEXT_VERSION)

  // Closing the dialog, hiding the main window and reloading the renderer reach no updater code
  // path at all; the only thing that may happen is that the download keeps running.
  assert.equal(harness.gate.isInFlight(), true)
  assert.equal(harness.coordinator.snapshot().phase, 'downloading')
  assert.equal(harness.coordinator.beginInstall(), false, 'nothing may install mid-download')

  await settle()
  assert.equal(harness.gate.isInFlight(), true, 'a tick of inactivity must not cancel it')

  harness.pending().resolve()
  await settle()
  assert.equal(harness.coordinator.applyDownloaded(ack.operationId, NEXT_VERSION), true)
  assert.equal(
    harness.coordinator.snapshot().phase,
    'downloaded',
    'completion stops at downloaded and never advances to installing on its own'
  )
  assert.equal(harness.startCalls(), 1)
})

async function runAsyncChecks(): Promise<void> {
  for (const asyncCheck of asyncChecks) {
    checks += 1
    try {
      await asyncCheck.run()
    } catch (error) {
      console.error(`FAIL: ${asyncCheck.description}`)
      throw error
    }
  }
}

void runAsyncChecks().then(() => {
  console.log(`updater-state: ${checks} checks passed`)
})
