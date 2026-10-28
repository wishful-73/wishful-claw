// updater-state 套件公共 harness：计数器、时钟假体、版本常量、快照字段表、状态机驱动辅助。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移。
import assert from 'node:assert/strict'
import { NO_UPDATE_OPERATION_ID } from '../../src/shared/updater/types'
import {
  createUpdaterStateCoordinator,
  type UpdaterStateCoordinator
} from '../../src/main/updater-state'

export let checks = 0

export function check(description: string, run: () => void): void {
  checks += 1
  try {
    run()
  } catch (error) {
    console.error(`FAIL: ${description}`)
    throw error
  }
}

export interface AsyncCheck {
  description: string
  run: () => Promise<void>
}

export const asyncChecks: AsyncCheck[] = []

// The bundle is CJS, so top-level await is unavailable; async checks are queued here and run
// sequentially at the end, where a rejection still exits non-zero.
export function checkAsync(description: string, run: () => Promise<void>): void {
  asyncChecks.push({ description, run })
}

export function deferred(): {
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
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export const CURRENT_VERSION = '0.2.25'
export const NEXT_VERSION = '0.2.26'

/** The §3.1 fixed field set — a snapshot must carry exactly these and nothing else. */
export const SNAPSHOT_FIELDS = [
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

export function createHarness(startMs = 1_000): {
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

export function reachAvailable(
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

export function startDownload(
  coordinator: UpdaterStateCoordinator,
  version: string = NEXT_VERSION
): number {
  const operationId = coordinator.beginDownload(version)
  assert.notEqual(operationId, NO_UPDATE_OPERATION_ID, 'beginDownload should be accepted')
  return operationId
}

/** Drives a coordinator to the only state an install may legally start from. */
export function reachDownloaded(coordinator: UpdaterStateCoordinator, version: string = NEXT_VERSION): void {
  reachAvailable(coordinator, version)
  assert.equal(
    coordinator.applyDownloaded(startDownload(coordinator, version), version),
    true,
    'the download should complete'
  )
}

export async function runAsyncChecks(): Promise<void> {
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
