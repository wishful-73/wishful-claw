// 门控断言：下载门与安装门在并发、重复点击、失败重试下的行为。
// 拆分自 program.ts（S-252，2026-10-28），断言本体逐字平移。
import assert from 'node:assert/strict'
import { NO_UPDATE_OPERATION_ID } from '../../../src/shared/updater/types'
import {
  createUpdateDownloadGate,
  createUpdateInstallGate,
  type UpdaterStateCoordinator
} from '../../../src/main/updater-state'
import {
  check,
  checkAsync,
  settle,
  NEXT_VERSION,
  createHarness,
  reachAvailable,
  startDownload,
  reachDownloaded
} from '../harness'
import { createGateHarness } from '../gate-harness'
import { createInstallHarness } from '../install-harness'

// ---------------------------------------------------------------- download gate

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

// ---------------------------------------------------------------- install gate

interface InstallHarness {
  coordinator: UpdaterStateCoordinator
  gate: ReturnType<typeof createUpdateInstallGate>
  failures: unknown[]
  installCalls: () => number
}

/**
 * Mirrors the production wiring in `src/main/updater.ts`: `install` is the closure holding the only
 * `quitAndInstall` call, and `onFailure` routes through `setError`, which is why it ends in
 * `coordinator.fail` rather than just recording.
 */
function createInstallHarness(install?: () => void): InstallHarness {
  const { coordinator } = createHarness()
  const failures: unknown[] = []
  let installCalls = 0

  const gate = createUpdateInstallGate({
    coordinator,
    install: () => {
      installCalls += 1
      install?.()
    },
    onFailure: (error) => {
      failures.push(error)
      coordinator.fail(String(error))
    }
  })

  return { coordinator, gate, failures, installCalls: () => installCalls }
}

check('reaching downloaded installs nothing on its own', () => {
  const harness = createInstallHarness()
  reachDownloaded(harness.coordinator)

  assert.equal(harness.coordinator.snapshot().phase, 'downloaded')
  assert.equal(harness.installCalls(), 0, 'completion must never advance to installing')
})

check('reading the snapshot for a remount or a tray refresh installs nothing', () => {
  const harness = createInstallHarness()
  reachDownloaded(harness.coordinator)

  // A renderer reload, a tray "更新详情" click and reopening the dialog all end here: they only read.
  const first = harness.coordinator.snapshot()
  const second = harness.coordinator.snapshot()

  assert.deepEqual(first, second)
  assert.equal(first.phase, 'downloaded')
  assert.equal(harness.installCalls(), 0)
})

check('a single explicit request installs exactly once', () => {
  const harness = createInstallHarness()
  reachDownloaded(harness.coordinator)

  assert.equal(harness.gate.request(), 'started')
  assert.equal(harness.installCalls(), 1)
  assert.equal(harness.coordinator.snapshot().phase, 'installing')
})

check('repeated clicks still install exactly once', () => {
  const harness = createInstallHarness()
  reachDownloaded(harness.coordinator)

  assert.equal(harness.gate.request(), 'started')
  assert.equal(harness.gate.request(), 'already-installing')
  assert.equal(harness.gate.request(), 'already-installing')
  assert.equal(harness.installCalls(), 1, 'a second restart must never be scheduled')
})

check('the gate refuses everywhere except a completed matching download', () => {
  const idle = createInstallHarness()
  assert.equal(idle.gate.request(), 'refused')
  assert.equal(idle.installCalls(), 0)
  assert.equal(idle.coordinator.snapshot().phase, 'idle')

  const available = createInstallHarness()
  reachAvailable(available.coordinator)
  assert.equal(available.gate.request(), 'refused')
  assert.equal(available.installCalls(), 0)
  assert.equal(available.coordinator.snapshot().phase, 'available')

  const downloading = createInstallHarness()
  reachAvailable(downloading.coordinator)
  startDownload(downloading.coordinator)
  assert.equal(downloading.gate.request(), 'refused')
  assert.equal(downloading.installCalls(), 0)
  assert.equal(downloading.coordinator.snapshot().phase, 'downloading')

  const failedCheck = createInstallHarness()
  reachAvailable(failedCheck.coordinator)
  assert.equal(failedCheck.coordinator.fail('network down'), true)
  assert.equal(failedCheck.gate.request(), 'refused', 'a failed check has no package to install')
  assert.equal(failedCheck.installCalls(), 0)
})

check('a failed download keeps the offer retryable but installs nothing', () => {
  const harness = createInstallHarness()
  reachAvailable(harness.coordinator)
  startDownload(harness.coordinator)
  assert.equal(harness.coordinator.fail('download interrupted'), true)

  assert.equal(harness.gate.request(), 'refused')
  assert.equal(harness.installCalls(), 0)
  assert.equal(harness.coordinator.snapshot().expectedVersion, NEXT_VERSION, 'still retryable')
})

check('a completion event for a superseded version installs nothing', () => {
  const harness = createInstallHarness()
  reachAvailable(harness.coordinator)
  const operationId = startDownload(harness.coordinator)

  assert.equal(harness.coordinator.applyDownloaded(operationId, '9.9.9'), false)
  assert.equal(harness.gate.request(), 'refused')
  assert.equal(harness.installCalls(), 0)
})

check('an install that throws synchronously recovers to error', () => {
  const boom = new Error('installer refused to launch')
  const harness = createInstallHarness(() => {
    throw boom
  })
  reachDownloaded(harness.coordinator)

  assert.equal(harness.gate.request(), 'started')
  assert.equal(harness.installCalls(), 1)
  assert.deepEqual(harness.failures, [boom])
  assert.equal(harness.coordinator.snapshot().phase, 'error')
  assert.equal(harness.coordinator.snapshot().error, String(boom))
})

check('a failed install can be retried through the gate', () => {
  let attempts = 0
  const harness = createInstallHarness(() => {
    attempts += 1
    if (attempts === 1) throw new Error('first launch failed')
  })
  reachDownloaded(harness.coordinator)

  assert.equal(harness.gate.request(), 'started')
  assert.equal(harness.coordinator.snapshot().phase, 'error')
  assert.equal(harness.gate.request(), 'started', 'the package is still on disk')
  assert.equal(harness.installCalls(), 2)
  assert.equal(harness.coordinator.snapshot().phase, 'installing')
})
