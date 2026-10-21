// S-207：沙箱临时关闭的倒计时 chip。
//
// 只在有未到期豁免时出现：显示还剩多少分钟 + 一个「恢复」按钮。
// 数据源是渲染端 sandbox-elevation-store（批准时写入到期时刻），本组件只负责刷新倒计时；
// 真正的放行判定在 Worker 侧（SandboxElevationStore），点「恢复」会同时清掉两边。
//
// 位置由调用方决定（className）：现在挂在聊天窗左上角，输入框上方只留真正需要动手的东西。

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { cn } from '@renderer/lib/utils'
import { useSandboxElevationStore } from '@renderer/stores/sandbox-elevation-store'

/**
 * className 只用来定位（绝对定位 + z-index），组件自己只负责胶囊外观 —— 与右上角
 * 会话操作块同一套视觉语言（半透明底 + 模糊 + 细边），看着是一族东西。
 */
export function SandboxElevationChip({ className }: { className?: string }): React.JSX.Element | null {
  const { t } = useTranslation('agent')
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
    toast.success(t('sandboxElevation.restoredToast', { defaultValue: '已恢复沙箱模式' }))
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm',
        className
      )}
    >
      <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
      <span className="tabular-nums">
        {t('sandboxElevation.chipRemaining', { defaultValue: '沙箱已临时关闭 · 剩 {{minutes}} 分钟', minutes })}
      </span>
      <button
        type="button"
        onClick={handleRestore}
        className="shrink-0 rounded px-1 font-medium text-foreground underline-offset-2 hover:underline"
      >
        {t('sandboxElevation.chipRestore', { defaultValue: '恢复' })}
      </button>
    </div>
  )
}
