// 更新器状态机断言：迁移表、初始快照、check/available、operationId、progress。
// 拆分自 program.ts（S-252，2026-10-28），断言本体逐字平移。
import assert from 'node:assert/strict'
import { NO_UPDATE_OPERATION_ID, type UpdatePhase } from '../../../src/shared/updater/types'
import {
  canTransitionPhase,
  pickProgressSnapshot
} from '../../../src/main/updater-state'
import {
  check,
  CURRENT_VERSION,
  NEXT_VERSION,
  SNAPSHOT_FIELDS,
  createHarness,
  reachAvailable,
  startDownload
} from '../harness'

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

// S-175 ④：「盘上有包」这个事实存在 downloadedVersion 里，而相位会因手工重查 / 空结果重查 /
// 静默失败合法地离开 downloaded。闸门必须能在这三个落脚点装上，否则界面亮着「立即重启安装」、
// 点下去报 noDownloadedUpdate。
check('a package on disk stays installable from every settled phase', () => {
  assert.equal(canTransitionPhase('idle', 'installing'), true)
  assert.equal(canTransitionPhase('checking', 'installing'), true)
  assert.equal(canTransitionPhase('available', 'installing'), true)
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
  assert.deepEqual(pickProgressSnapshot(coordinator.snapshot()), {
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
  assert.deepEqual(pickProgressSnapshot(snapshot), {
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
