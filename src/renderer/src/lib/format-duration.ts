/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export function formatDurationMs(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0
  if (total < 1000) return `${total}ms`

  // S-254（2026-10-28）：先一次性取整到秒，再按 d/h/m/s 拆位。
  // 拆完再对秒取整会出 `1h59m60s` 这种怪读数 —— 取整只能发生一次。
  const totalSeconds = Math.round(total / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  // 「有值就显示」：某位是 0 就跳过（1h 不写 1h0m0s）。秒位同理 —— 走表每秒一跳，
  // 秒真是 0 的那一跳只持续一秒，下一跳就回来了，不值得为它补位。
  let text = ''
  if (days > 0) text += `${days}d`
  if (hours > 0) text += `${hours}h`
  if (minutes > 0) text += `${minutes}m`
  if (seconds > 0) text += `${seconds}s`
  return text
}

/**
 * iter-39 S-197：运行中状态栏的「动态耗时」标签。
 *
 * 口径与跑完后操作栏的 `updatedAt − createdAt`（`AssistantMessage/action-bar.tsx:61-65`）一致：
 * 起点取当前流式 assistant 消息的 `createdAt` = 本轮 run 的**开跑时刻**。
 * 会话忙时 `sendMessage` 会在前置分支里入队并直接 return，消息**不会创建**
 * （`stores/chat-store/index.ts:272-276`）⇒ 天然不含排队等待，与操作栏同起点、末值衔接不跳字。
 *
 * 放在本模块（而非 `components/chat/InputArea/utils.ts`）是**刻意的**：这里是零依赖叶子模块，
 * 而 InputArea/utils 的依赖链会经 chat-store 拉进 IPC（`window` 未定义）—— 纯函数落在那儿就没法
 * 在 node 侧单测，见 `tests/composer-status-elapsed`。
 *
 * 返回 `null` 的三种情况 —— **宁可没有，不可报 0 或负数**（与操作栏 `elapsedMs === null` 同态度）：
 *   1. `startedAt == null`：run 未开始，或已结束（`streamingMessages[sessionId]` 已被清掉）；
 *   2. `disabled`：历史回放 / 只读态，避免回看旧会话时看到「假走表」；
 *   3. `now <= startedAt`：首个 tick 尚未落定，等下一帧再显示。
 */
export function resolveRunningElapsedLabel(params: {
  startedAt: number | null
  now: number
  /** 历史回放 / 只读态（`messagesOverride` 分支）：不参与走表。 */
  disabled?: boolean
}): string | null {
  const { startedAt, now, disabled = false } = params
  if (disabled || startedAt == null) return null
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now <= startedAt) return null
  const elapsed = now - startedAt
  // S-254（2026-10-28 老大：「毫秒只在工具调用上有，输入框左上角状态栏不需要毫秒」）：
  // 不足 1 秒**不出数**，而不是报 `0s` —— 挂载首帧的 `42ms` 没有信息量还闪一下。
  // 与上面「宁可没有，不可报 0」是同一条线。
  if (elapsed < 1000) return null
  return formatDurationMs(elapsed)
}
