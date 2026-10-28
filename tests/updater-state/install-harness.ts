// 安装门 harness：镜像 `src/main/updater.ts` 的真实装配（install 闭包 + onFailure 落 fail）。
// 拆分自 program.ts（S-252，2026-10-28），语句逐字平移。
import {
  createUpdateInstallGate,
  type UpdaterStateCoordinator
} from '../../src/main/updater-state'
import { createHarness } from './harness'
import { createInstallHarness } from './install-harness'

export interface InstallHarness {
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
export function createInstallHarness(install?: () => void): InstallHarness {
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
