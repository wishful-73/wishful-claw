// S-276：会话内存窗口的收缩 —— 轮次只数「真实用户消息」。
//
// 从 stores/chat-store/session-slice.ts 搬出来的唯一理由是**可测**：那个 store 一 import
// 就把 zustand + IPC 拖进来，node 侧跑不了；而这里的逻辑是纯数组切片，S-276 的病症
// （摘要卡把真实消息挤出窗口）恰恰只能在「切片结果」上验证 —— 只测 isRealUserTurn
// 等于只测了一半。
//
// 口径与 worker 侧 DbMessageToolsQueries.cs 的 RealUserTurnPredicate 必须一致。

import { isRealUserTurn } from './context-compression-display'

/** 数轮次时只需要这三个字段 —— `ChatMessage` / `UnifiedMessage` 都满足。 */
export interface TurnCountableMessage {
  role: string
  content?: unknown
  meta?: { compactSummary?: unknown } | null
}

/**
 * 保留最近 `maxTurns` 轮，返回应保留的尾部切片与被裁掉的头部长度。
 * 不足 `maxTurns` 轮（或刚好从第 0 条开始）时原样返回，`removed` 为 0。
 *
 * 轮次只数**真实用户消息**（`isRealUserTurn`），压缩摘要卡不吃名额；卡本身仍留在
 * 切片里 —— 用户要看得见它们，只是不该把真实消息挤出窗口。
 */
export function trimMessagesToRecentTurns<T extends TurnCountableMessage>(
  messages: T[],
  maxTurns: number
): { messages: T[]; removed: number } {
  let userSeen = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !isRealUserTurn(message)) continue
    userSeen += 1
    if (userSeen < maxTurns) continue
    if (index === 0) return { messages, removed: 0 }
    return { messages: messages.slice(index), removed: index }
  }
  return { messages, removed: 0 }
}
