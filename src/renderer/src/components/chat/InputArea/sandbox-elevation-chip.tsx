// S-207：沙箱临时关闭的倒计时 chip（输入框上方一条）。
//
// 只在有未到期豁免时出现：显示还剩多少分钟 + 一个「恢复」按钮。
// 数据源是渲染端 sandbox-elevation-store（批准时写入到期时刻），本组件只负责刷新倒计时；
// 真正的放行判定在 Worker 侧（SandboxElevationStore），点「恢复」会同时清掉两边。

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useSandboxElevationStore } from '@renderer/stores/sandbox-elevation-store'

export function SandboxElevationChip(): React.JSX.Element | null {
  const untilMs = useSandboxElevationStore((s) => s.untilMs)
  const clear = useSandboxElevationStore((s) => s.clear)

  // 每秒 tick 一次刷新剩余分钟数；没豁免时不挂定时器。
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (untilMs === null) return
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [untilMs])

  if (untilMs === null) return null

  const remainingMs = untilMs - Date.now()
  // 到期即不再渲染（Worker 侧同步到期，无需在此清理状态）。
  if (remainingMs <= 0) return null

  const minutes = Math.max(1, Math.ceil(remainingMs / 60000))

  const handleRestore = (): void => {
    clear()
    void ipcClient.invoke(IPC.SANDBOX_CLEAR_ELEVATION, {}).catch((error) => {
      console.error('[SandboxElevation] Failed to clear worker elevation:', error)
    })
    toast.success('已恢复沙箱模式')
  }

  return (
    <div className="mx-5 mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
      <ShieldAlert className="size-3 shrink-0" />
      <span className="tabular-nums">沙箱已临时关闭 · 剩 {minutes} 分钟</span>
      <button
        type="button"
        onClick={handleRestore}
        className="shrink-0 rounded px-1 font-medium text-foreground underline-offset-2 hover:underline"
      >
        恢复
      </button>
    </div>
  )
}
