// updater-state 下载进度套件的 harness：计数器、版本常量、时钟 harness、结构化日志断言、updater.ts 源码读取。
// 拆分自 download-progress.ts（S-252，2026-10-28），语句逐字平移。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NO_UPDATE_OPERATION_ID } from '../../src/shared/updater/types'
import {
  createUpdaterStateCoordinator,
  observeDownload,
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

export const CURRENT_VERSION = '0.2.25'
export const NEXT_VERSION = '0.2.26'
export const UNKNOWN = '未知'

export const KIB = 1024
export const MIB = 1024 * KIB
export const GIB = 1024 * MIB
export const TIB = 1024 * GIB

export const DECLARED_SIZE = 90 * MIB

export const OBSERVATION_FIELDS = [
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

export function startDownload(coordinator: UpdaterStateCoordinator): number {
  const operationId = coordinator.beginDownload(NEXT_VERSION)
  assert.notEqual(operationId, NO_UPDATE_OPERATION_ID, 'beginDownload should be accepted')
  return operationId
}

export function reachDownloading(
  declaredInstallerSize: number | null = DECLARED_SIZE
): { coordinator: UpdaterStateCoordinator; advance: (ms: number) => void; operationId: number } {
  const harness = createHarness()
  reachAvailable(harness.coordinator, declaredInstallerSize)
  return { ...harness, operationId: startDownload(harness.coordinator) }
}

/**
 * `undefined` is asserted against separately from `null` on purpose: a structured log serialiser
 * drops undefined keys entirely, so one missing field would silently remove a whole column from the
 * observability report, whereas `null` is the documented spelling of "not measured".
 */
export function assertComplete(observation: ReturnType<typeof observeDownload>, stage: string): void {
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

export const UPDATER_SOURCE = 'src/main/updater.ts'

/**
 * Comments are stripped first: the file legitimately discusses `autoDownload` and differential
 * downloads in prose, and prose must not be allowed to satisfy an assertion that a setting is
 * actually in force.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

export function updaterCode(): string {
  // npm runs scripts from the package root, so this is stable wherever esbuild put the bundle.
  return stripComments(readFileSync(resolve(UPDATER_SOURCE), 'utf8'))
}
