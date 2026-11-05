// S-309 §4.3：执行中的工具要能自证「在等」还是「卡住」。
//
// 背景：生产实例曾有一次工具调用冻结了十六小时，界面上只有一个一直在转的「执行中」，
// 用户看不出到底等了多久 —— 因为耗时只在 `completedAt` 落地后才算得出来。这里补一条
// 按秒走的实时耗时，并给出「超过阈值」的判定，供卡片档（`ToolCallCard`）与纯文本档
// （`ProcessTextLine`）共用同一份口径。
//
// 只在运行中且已知起点时走表：一结束立刻清掉定时器，不留常驻 tick，也不落任何状态。

import * as React from 'react'
import { formatDurationMs } from '@renderer/lib/format-duration'

/**
 * 默认的「可能已卡住」提示阈值。
 *
 * 2 分钟是**提示**阈值，不是超时阈值 —— 各工具的兜底上限由 `ToolCallTimeout` 分档
 * 决定（只读 60 s / shell 600 s + 30 s / 等人 300 s）。这里只负责让用户分得清
 * 「在等」和「卡住」，不参与任何判定，也不影响工具本身。
 */
export const DEFAULT_STALL_HINT_MS = 120_000

export interface LiveElapsedState {
  /** 实时毫秒数；不在运行中或拿不到起点时为 null */
  elapsedMs: number | null
  /** 实时耗时文本；不在运行中或不足 1 秒时为 null */
  elapsed: string | null
  /** 已超出卡住提示阈值（只在运行中可能为 true） */
  stalled: boolean
}

export function useLiveElapsed(params: {
  running: boolean
  startedAt?: number | null
  stalledAfterMs?: number
}): LiveElapsedState {
  const { running, startedAt, stalledAfterMs = DEFAULT_STALL_HINT_MS } = params
  // 起点只在「运行中」才有意义 —— 跑完之后即使 startedAt 还在，也不该继续走表。
  const from = running && startedAt != null ? startedAt : null
  const [now, setNow] = React.useState(0)

  React.useEffect(() => {
    if (from == null) return
    // 先对一次表，别让首帧空一秒才出数。
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [from])

  return React.useMemo(() => {
    const elapsedMs = from != null && now > from ? now - from : null
    return {
      elapsedMs,
      // 不足 1 秒不出数 —— 与输入框状态栏同口径（共用同一份格式化函数）：宁可没有，不报 0。
      elapsed: elapsedMs != null && elapsedMs >= 1000 ? formatDurationMs(elapsedMs) : null,
      stalled: elapsedMs != null && elapsedMs >= stalledAfterMs
    }
  }, [from, now, stalledAfterMs])
}
