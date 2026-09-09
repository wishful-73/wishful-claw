import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NO_UPDATE_OPERATION_ID } from '../../src/shared/updater/types'
import type { UpdateStateSnapshot } from '../../src/shared/updater/types'
import {
  createUpdaterStateCoordinator,
  observeDownload,
  pickProgressSnapshot,
  type UpdaterStateCoordinator
} from '../../src/main/updater-state'
import { createUpdateProgressFormatter } from '../../src/renderer/src/components/updater/update-progress'

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

const CURRENT_VERSION = '0.2.25'
const NEXT_VERSION = '0.2.26'
const UNKNOWN = '未知'
const format = createUpdateProgressFormatter(UNKNOWN)

const KIB = 1024
const MIB = 1024 * KIB
const GIB = 1024 * MIB
const TIB = 1024 * GIB

const DECLARED_SIZE = 90 * MIB

/** The fields every progress event, completion event and structured log line must agree on. */
const PROGRESS_FIELDS = [
  'bytesPerSecond',
  'declaredInstallerSize',
  'elapsedMs',
  'percent',
  'total',
  'transferred'
]

const OBSERVATION_FIELDS = [
  'bytesPerSecond',
  'currentVersion',
  'declaredInstallerSize',
  'downloadedVersion',
  'elapsedMs',
  'expectedVersion',
  'operationId',
  'percent',
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
  declaredInstallerSize: number | null = DECLARED_SIZE
): void {
  assert.equal(coordinator.beginCheck(), true, 'beginCheck should be accepted from idle')
  assert.equal(
    coordinator.applyAvailable({
      newVersion: NEXT_VERSION,
      releaseNotes: '',
      declaredInstallerSize
    }),
    true,
    'applyAvailable should be accepted from checking'
  )
}

function startDownload(coordinator: UpdaterStateCoordinator): number {
  const operationId = coordinator.beginDownload(NEXT_VERSION)
  assert.notEqual(operationId, NO_UPDATE_OPERATION_ID, 'beginDownload should be accepted')
  return operationId
}

function reachDownloading(
  declaredInstallerSize: number | null = DECLARED_SIZE
): { coordinator: UpdaterStateCoordinator; advance: (ms: number) => void; operationId: number } {
  const harness = createHarness()
  reachAvailable(harness.coordinator, declaredInstallerSize)
  return { ...harness, operationId: startDownload(harness.coordinator) }
}

// ------------------------------------------------------------------ unknown

check('nothing is measured before a download starts', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  const snapshot = coordinator.snapshot()

  assert.equal(snapshot.percent, null)
  assert.equal(snapshot.transferred, null)
  assert.equal(snapshot.total, null)
  assert.equal(snapshot.bytesPerSecond, null)
  assert.equal(snapshot.elapsedMs, null)
  assert.equal(snapshot.declaredInstallerSize, DECLARED_SIZE)
})

check('an unmeasured download renders as unknown, never as zero', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, {}), true)

  const snapshot = coordinator.snapshot()
  assert.equal(format.percent(snapshot.percent), UNKNOWN)
  assert.equal(format.bytes(snapshot.transferred), UNKNOWN)
  assert.equal(format.bytes(snapshot.total), UNKNOWN)
  assert.equal(format.speed(snapshot.bytesPerSecond), UNKNOWN)
  assert.equal(format.transferredOfTotal(snapshot), UNKNOWN)
})

check('a partially measured download shows the side it does know', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { transferred: 1536 }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(format.transferredOfTotal(snapshot), `1.5 KiB / ${UNKNOWN}`)
  assert.equal(format.percent(snapshot.percent), UNKNOWN)
})

check('an unknown total reported later does not erase a known one', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { total: 2 * MIB }), true)
  assert.equal(coordinator.applyProgress(operationId, { transferred: MIB }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.total, 2 * MIB)
  assert.equal(format.transferredOfTotal(snapshot), '1 MiB / 2 MiB')
})

// --------------------------------------------------------------- zero bytes

check('a real zero stays distinguishable from unknown', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(
    coordinator.applyProgress(operationId, { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }),
    true
  )

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 0)
  assert.equal(snapshot.transferred, 0)
  assert.equal(format.percent(0), '0%')
  assert.equal(format.bytes(0), '0 B')
  assert.equal(format.speed(0), '0 B/s')
  assert.equal(format.elapsed(0), '0:00')
  assert.equal(format.transferredOfTotal(snapshot), '0 B / 0 B')
})

// ------------------------------------------------------------- monotonicity

check('percent and transferred never move backwards', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { percent: 40, transferred: 40 * MIB }), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: 20, transferred: 20 * MIB }), false)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 40)
  assert.equal(snapshot.transferred, 40 * MIB)
})

check('a percent above 100 is clamped rather than trusted', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { percent: 140 }), true)
  assert.equal(coordinator.snapshot().percent, 100)
})

check('an equal reading is accepted and changes nothing', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { percent: 40, transferred: 40 * MIB }), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: 40, transferred: 40 * MIB }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 40)
  assert.equal(snapshot.transferred, 40 * MIB)
})

check('a negative reading is ignored instead of being stored', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { percent: 30 }), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: -5, transferred: -1 }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 30)
  assert.equal(snapshot.transferred, null)
})

// ------------------------------------------------------- duplicate/stale

check('progress for a superseded operation is refused', () => {
  const { coordinator } = reachDownloading()
  const first = startDownload(coordinator)
  assert.equal(coordinator.fail('network down'), true)
  const second = coordinator.beginDownload(NEXT_VERSION)
  assert.equal(second, first + 1)

  assert.equal(coordinator.applyProgress(first, { percent: 99 }), false)
  assert.equal(coordinator.applyProgress(second, { percent: 10 }), true)
  assert.equal(coordinator.snapshot().percent, 10)
})

check('progress is refused once the download has completed', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyProgress(operationId, { percent: 100, transferred: DECLARED_SIZE }), true)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.applyProgress(operationId, { percent: 50, transferred: MIB }), false)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.percent, 100)
  assert.equal(snapshot.transferred, DECLARED_SIZE)
})

check('progress is refused outside a download entirely', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator)
  assert.equal(coordinator.applyProgress(NO_UPDATE_OPERATION_ID, { percent: 10 }), false)
  assert.equal(coordinator.snapshot().percent, null)
})

// ---------------------------------------------------------------- elapsedMs

check('elapsedMs starts at zero and grows with the clock', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  assert.equal(coordinator.snapshot().elapsedMs, 0)

  advance(1_500)
  assert.equal(coordinator.applyProgress(operationId, { percent: 10 }), true)
  assert.equal(coordinator.snapshot().elapsedMs, 1_500)
  assert.equal(format.elapsed(coordinator.snapshot().elapsedMs), '0:01')
})

check('elapsedMs freezes at completion and survives a later read', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  advance(72_000)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)

  assert.equal(coordinator.snapshot().elapsedMs, 72_000)
  advance(60_000)
  assert.equal(coordinator.snapshot().elapsedMs, 72_000)
  assert.equal(format.elapsed(72_000), '1:12')
})

check('a retry restarts the clock but keeps the declared size', () => {
  const { coordinator, advance } = reachDownloading()
  advance(5_000)
  assert.equal(coordinator.fail('network down'), true)

  advance(5_000)
  startDownload(coordinator)
  assert.equal(coordinator.snapshot().elapsedMs, 0)
  assert.equal(coordinator.snapshot().declaredInstallerSize, DECLARED_SIZE)
})

// --------------------------------------------------- declared installer size

check('a declared size of zero is not a usable baseline', () => {
  const { coordinator } = createHarness()
  reachAvailable(coordinator, 0)
  assert.equal(coordinator.snapshot().declaredInstallerSize, null)
})

check('a missing declared size stays unknown through the download', () => {
  const { coordinator, operationId } = reachDownloading(null)
  assert.equal(coordinator.applyProgress(operationId, { transferred: MIB }), true)

  const snapshot = coordinator.snapshot()
  assert.equal(snapshot.declaredInstallerSize, null)
  assert.equal(observeDownload(snapshot).declaredInstallerSize, null)
})

check('completion keeps the last observed values and the declared size', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: 42,
      transferred: 38 * MIB,
      total: DECLARED_SIZE,
      bytesPerSecond: 2 * MIB
    }),
    true
  )
  advance(19_000)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)

  const observation = observeDownload(coordinator.snapshot())
  assert.equal(observation.transferred, 38 * MIB)
  assert.equal(observation.total, DECLARED_SIZE)
  assert.equal(observation.bytesPerSecond, 2 * MIB)
  assert.equal(observation.elapsedMs, 19_000)
  assert.equal(observation.declaredInstallerSize, DECLARED_SIZE)
  assert.equal(observation.percent, 100)
})

// ------------------------------------------------------- shared field sets

check('the progress snapshot carries exactly the six observed fields', () => {
  const { coordinator } = reachDownloading()
  const picked = pickProgressSnapshot(coordinator.snapshot())
  assert.deepEqual(Object.keys(picked).sort(), PROGRESS_FIELDS)
})

check('a download observation adds exactly the four correlating fields', () => {
  const { coordinator, operationId } = reachDownloading()
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)

  const observation = observeDownload(coordinator.snapshot())
  assert.deepEqual(Object.keys(observation).sort(), OBSERVATION_FIELDS)
  assert.equal(observation.operationId, operationId)
  assert.equal(observation.currentVersion, CURRENT_VERSION)
  assert.equal(observation.expectedVersion, NEXT_VERSION)
  assert.equal(observation.downloadedVersion, NEXT_VERSION)
})

check('the observation matches the state snapshot field for field', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  advance(2_500)
  assert.equal(
    coordinator.applyProgress(operationId, { percent: 7, transferred: 6 * MIB, bytesPerSecond: MIB }),
    true
  )

  const snapshot: UpdateStateSnapshot = coordinator.snapshot()
  const observation = observeDownload(snapshot)
  for (const field of PROGRESS_FIELDS) {
    assert.equal(
      observation[field as keyof typeof observation],
      snapshot[field as keyof UpdateStateSnapshot],
      `${field} must not drift between the log and the state`
    )
  }
})

// -------------------------------------------------------- format boundaries

check('byte units step at powers of 1024 and cap at TiB', () => {
  assert.equal(format.bytes(1023), '1023 B')
  assert.equal(format.bytes(KIB), '1 KiB')
  assert.equal(format.bytes(1536), '1.5 KiB')
  assert.equal(format.bytes(MIB), '1 MiB')
  assert.equal(format.bytes(GIB), '1 GiB')
  assert.equal(format.bytes(TIB), '1 TiB')
  assert.equal(format.bytes(5 * TIB), '5 TiB')
})

check('a value just under the next unit truncates instead of overflowing it', () => {
  assert.equal(format.bytes(MIB - 1), '1023.9 KiB')
  assert.equal(format.bytes(KIB - 1), '1023 B')
})

check('speed reuses the byte scale', () => {
  assert.equal(format.speed(1536), '1.5 KiB/s')
  assert.equal(format.speed(2 * MIB), '2 MiB/s')
  assert.equal(format.speed(null), UNKNOWN)
})

check('percent rounds to a whole number', () => {
  assert.equal(format.percent(0), '0%')
  assert.equal(format.percent(45.6), '46%')
  assert.equal(format.percent(100), '100%')
  assert.equal(format.percent(null), UNKNOWN)
})

check('elapsed switches to hours only once an hour has passed', () => {
  assert.equal(format.elapsed(0), '0:00')
  assert.equal(format.elapsed(999), '0:00')
  assert.equal(format.elapsed(65_000), '1:05')
  assert.equal(format.elapsed(3_599_000), '59:59')
  assert.equal(format.elapsed(3_600_000), '1:00:00')
  assert.equal(format.elapsed(3_725_000), '1:02:05')
  assert.equal(format.elapsed(null), UNKNOWN)
})

check('non-finite and negative values are unknown, not zero', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.equal(format.bytes(value), UNKNOWN, `bytes(${value})`)
    assert.equal(format.speed(value), UNKNOWN, `speed(${value})`)
    assert.equal(format.percent(value), UNKNOWN, `percent(${value})`)
    assert.equal(format.elapsed(value), UNKNOWN, `elapsed(${value})`)
  }
})

check('the unknown label is whatever the caller binds', () => {
  const english = createUpdateProgressFormatter('Unknown')
  assert.equal(english.bytes(null), 'Unknown')
  assert.equal(english.transferredOfTotal({ transferred: MIB, total: null }), '1 MiB / Unknown')
})

// ------------------------------------------- structured log completeness (C2)

/**
 * `undefined` is asserted against separately from `null` on purpose: a structured log serialiser
 * drops undefined keys entirely, so one missing field would silently remove a whole column from the
 * observability report, whereas `null` is the documented spelling of "not measured".
 */
function assertComplete(observation: ReturnType<typeof observeDownload>, stage: string): void {
  for (const field of OBSERVATION_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(observation, field),
      `${stage}: observation is missing ${field}`
    )
    assert.notEqual(
      observation[field as keyof typeof observation],
      undefined,
      `${stage}: ${field} must be null rather than undefined`
    )
  }
}

check('a simulated progress/complete sequence logs a complete record at every stage', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  assertComplete(observeDownload(coordinator.snapshot()), 'start')

  advance(2_000)
  assert.equal(coordinator.applyProgress(operationId, { percent: 12, transferred: 11 * MIB }), true)
  assertComplete(observeDownload(coordinator.snapshot()), 'first progress')

  advance(30_000)
  assert.equal(
    coordinator.applyProgress(operationId, {
      percent: 88,
      transferred: 79 * MIB,
      total: DECLARED_SIZE,
      bytesPerSecond: 2 * MIB
    }),
    true
  )
  const midDownload = observeDownload(coordinator.snapshot())
  assertComplete(midDownload, 'second progress')
  // The correlating keys must hold mid-download, before any completion event confirms them.
  assert.equal(midDownload.operationId, operationId)
  assert.equal(midDownload.currentVersion, CURRENT_VERSION)
  assert.equal(midDownload.expectedVersion, NEXT_VERSION)
  assert.equal(midDownload.downloadedVersion, null)
  assert.equal(midDownload.elapsedMs, 32_000)

  advance(4_000)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  const completed = observeDownload(coordinator.snapshot())
  assertComplete(completed, 'completion')
  assert.equal(completed.downloadedVersion, NEXT_VERSION)
  // Completion keeps the last observed values rather than resetting them to the finished state.
  assert.equal(completed.transferred, 79 * MIB)
  assert.equal(completed.total, DECLARED_SIZE)
  assert.equal(completed.bytesPerSecond, 2 * MIB)
  assert.equal(completed.declaredInstallerSize, DECLARED_SIZE)
  assert.equal(completed.elapsedMs, 36_000)
})

check('a simulated progress/error sequence keeps the correlation and the last bytes', () => {
  const { coordinator, advance, operationId } = reachDownloading()
  advance(9_000)
  assert.equal(
    coordinator.applyProgress(operationId, { percent: 55, transferred: 49 * MIB, bytesPerSecond: MIB }),
    true
  )

  // Read before failing, exactly as the production error paths do: `fail` moves the phase on but
  // must not cost us the measurement of how far the attempt got.
  const beforeFailure = observeDownload(coordinator.snapshot())
  assertComplete(beforeFailure, 'pre-failure')
  assert.equal(beforeFailure.operationId, operationId)
  assert.equal(beforeFailure.expectedVersion, NEXT_VERSION)
  assert.equal(beforeFailure.downloadedVersion, null)

  assert.equal(coordinator.fail('network down'), true)
  const afterFailure = observeDownload(coordinator.snapshot())
  assertComplete(afterFailure, 'post-failure')
  assert.equal(afterFailure.operationId, operationId)
  assert.equal(afterFailure.expectedVersion, NEXT_VERSION, 'a retry must target the same version')
  assert.equal(afterFailure.transferred, 49 * MIB)
  assert.equal(afterFailure.elapsedMs, 9_000, 'failure freezes the clock too')
})

check('a sequence with no measurements at all still logs every field', () => {
  const { coordinator, operationId } = reachDownloading(null)
  assert.equal(coordinator.applyProgress(operationId, {}), true)
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)

  const observation = observeDownload(coordinator.snapshot())
  assertComplete(observation, 'unmeasured completion')
  assert.equal(observation.percent, 100, 'completion is the one value that is known for certain')
  assert.equal(observation.transferred, null)
  assert.equal(observation.total, null)
  assert.equal(observation.bytesPerSecond, null)
  assert.equal(observation.declaredInstallerSize, null)
})

// ------------------------------------------------ native log preservation (C2)

const UPDATER_SOURCE = 'src/main/updater.ts'

/**
 * Comments are stripped first: the file legitimately discusses `autoDownload` and differential
 * downloads in prose, and prose must not be allowed to satisfy an assertion that a setting is
 * actually in force.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function updaterCode(): string {
  // npm runs scripts from the package root, so this is stable wherever esbuild put the bundle.
  return stripComments(readFileSync(resolve(UPDATER_SOURCE), 'utf8'))
}

check('autoDownload stays off, so a found update is never fetched unasked', () => {
  assert.match(updaterCode(), /instance\.autoDownload = false/)
})

check('autoInstallOnAppQuit stays off, so quitting can never install', () => {
  assert.match(updaterCode(), /instance\.autoInstallOnAppQuit = false/)
})

check('differential download is never switched off', () => {
  // The whole point of this iteration is to observe differential downloads; disabling the
  // capability would make every future measurement a full download and silently invalidate the
  // report's decision rules.
  assert.doesNotMatch(updaterCode(), /disableDifferentialDownload/)
})

check('every native log level is forwarded, so no evidence is dropped', () => {
  const logger = updaterCode().match(/instance\.logger = \{[\s\S]*?\n {2}\}/)?.[0]
  assert.ok(logger, `${UPDATER_SOURCE} must assign instance.logger`)
  // `Full: …, To download: …` arrives on info and the differential fallback on error, so a
  // partial forwarding would lose exactly one half of the evidence the report needs.
  for (const level of ['info', 'warn', 'error', 'debug']) {
    assert.match(logger, new RegExp(`\\b${level}:`), `logger.${level} must be forwarded`)
  }
  assert.match(logger, /\[updater\]/, 'native lines must stay greppable under one prefix')
})

console.log(`updater-progress: ${checks} checks passed`)
