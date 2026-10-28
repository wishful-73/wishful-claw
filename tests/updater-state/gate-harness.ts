// 下载门 harness：装配生产 `createUpdateDownloadGate`，记录调用顺序与失败。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移。
import {
  createUpdateDownloadGate,
  type UpdaterStateCoordinator
} from '../../src/main/updater-state'
import {
  deferred,
  createHarness,
  reachAvailable
} from './harness'
import { createGateHarness } from './gate-harness'

export interface GateHarness {
  coordinator: UpdaterStateCoordinator
  gate: ReturnType<typeof createUpdateDownloadGate>
  order: string[]
  failures: unknown[]
  startCalls: () => number
  /** The deferred controlling the most recent native start. */
  pending: () => ReturnType<typeof deferred>
}

export function createGateHarness(onFailure?: (error: unknown) => void): GateHarness {
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
