/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    // S-245（2026-10-27 老大：「耗时里面 s 出现了 7.3s 这种格式 1.1s 这种 我希望不要有小数」）：
    // 秒档一律取整。小数读数对「这件事做了多久」没有任何价值，只让人多看一眼小数点。
    // ms 档保留整数毫秒 —— 1s 以下仍有精度，`340ms` 不会被吞成 `0s`。
    // 取整用四舍五入（不是截断），与原有 `toFixed(0)` 语义一致。
    return `${Math.round(totalSeconds)}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - totalMinutes * 60

  // 小时档：超过 60 分钟改写成 1h30m，避免出现 90m0s 这种读数。
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes - hours * 60
    // 整点不写分钟：1h，而不是 1h0m。
    return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`
  }

  // 分钟档的秒部分同样取整（S-245）：1m23s，不出 1m23.4s。
  const secondsText = String(Math.round(seconds))
  // 整分不写秒：1m，而不是 1m0s。
  return secondsText === '0' ? `${totalMinutes}m` : `${totalMinutes}m${secondsText}s`
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
  return formatDurationMs(now - startedAt)
}
