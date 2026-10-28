// 更新器生命周期断言：完成、失败、安装阶段推进、重挂载快照稳定。
// 拆分自 program.ts（S-252，2026-10-28），断言本体逐字平移。
import assert from 'node:assert/strict'
import { NO_UPDATE_OPERATION_ID } from '../../../src/shared/updater/types'
import {
  check,
  CURRENT_VERSION,
  NEXT_VERSION,
  SNAPSHOT_FIELDS,
  createHarness,
  reachAvailable,
  startDownload,
  reachDownloaded
} from '../harness'

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

check('install needs a package on disk, not a particular phase', () => {
  const { coordinator } = createHarness()
  assert.equal(coordinator.beginInstall(), false, 'nothing was ever downloaded')
  reachAvailable(coordinator)
  assert.equal(coordinator.beginInstall(), false, 'an offer is not a package')
  const operationId = startDownload(coordinator)
  assert.equal(coordinator.beginInstall(), false, 'the package is still being written')
  assert.equal(coordinator.applyDownloaded(operationId, NEXT_VERSION), true)
  assert.equal(coordinator.beginInstall(), true)
  assert.equal(coordinator.snapshot().phase, 'installing')
})

// S-175 ④ 的三条同族路：相位飘走了，包还在盘上 —— 三条都得能装。
check('a manual re-check after a download does not strand the package', () => {
  const { coordinator } = createHarness()
  reachDownloaded(coordinator)
  assert.equal(coordinator.beginCheck(), true, 'downloaded → checking is a legal phase move')
  assert.equal(coordinator.snapshot().downloadedVersion, NEXT_VERSION)
  assert.equal(coordinator.beginInstall(), true, 'the package is still on disk')
  assert.equal(coordinator.snapshot().phase, 'installing')
})

check('a re-check that finds nothing new does not strand the package', () => {
  const { coordinator } = createHarness()
  reachDownloaded(coordinator)
  assert.equal(coordinator.applyNotAvailable(), true, 'downloaded → idle is a legal phase move')
  assert.equal(coordinator.snapshot().downloadedVersion, NEXT_VERSION)
  assert.equal(coordinator.beginInstall(), true, 'the package is still on disk')
})

check('a silent failure does not strand the package', () => {
  const { coordinator } = createHarness()
  reachDownloaded(coordinator)
  assert.equal(coordinator.failSilently(), true)
  assert.equal(coordinator.snapshot().downloadedVersion, NEXT_VERSION)
  assert.equal(coordinator.beginInstall(), true, 'the package is still on disk')
})

check('a package left over from a superseded attempt is not installed', () => {
  const { coordinator } = createHarness()
  reachDownloaded(coordinator)
  // 重查没发现新的 ⇒ idle（包留着）；用户随后点了下载、目标是另一个版本，而这一轮失败了：
  // 盘上那份属于上一轮，expectedVersion 已经跟着换了。
  assert.equal(coordinator.applyNotAvailable(), true)
  assert.equal(coordinator.beginCheck(), true)
  assert.notEqual(coordinator.beginDownload('0.2.27'), NO_UPDATE_OPERATION_ID)
  assert.equal(coordinator.beginInstall(), false, 'an in-flight download is never installable')
  assert.equal(coordinator.fail('download failed'), true)
  assert.equal(
    coordinator.beginInstall(),
    false,
    'the package on disk is not the one this attempt wants'
  )
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
