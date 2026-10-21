/**
 * S-207：临时关闭沙箱的渲染端状态。
 *
 * 只放一个到期时刻，刻意不持久化 —— 沙箱豁免是「这次开着应用时的临时放行」，
 * 重启即失效（Worker 侧的 SandboxElevationStore 也是进程级、重启清零），两边语义一致。
 * 真正的判定在 Worker（PathBoundary.IsEnabled），这里只驱动输入框上那条倒计时 chip。
 */

import { create } from 'zustand'

/** 与服务端 SandboxElevationStore.DurationSeconds 保持一致：固定 1 小时。 */
export const SANDBOX_ELEVATION_DURATION_MS = 60 * 60 * 1000

interface SandboxElevationStore {
  /** 到期时刻（Unix 毫秒）；null 表示当前没有豁免。 */
  untilMs: number | null
  grant: (untilMs: number) => void
  clear: () => void
}

export const useSandboxElevationStore = create<SandboxElevationStore>((set) => ({
  untilMs: null,
  grant: (untilMs) => set({ untilMs }),
  clear: () => set({ untilMs: null })
}))
