/**
 * S-297：搜索框「最近会话」的派生逻辑（从 `search-dialog.tsx` 抽出来，可单测）。
 *
 * ## 为什么要抽
 *
 * `SearchDialog` 常驻应用壳，**对话框关着也照样每帧被 store 通知叫醒**。原来这里写的是
 * `useChatStore((s) => s.sessions)` + `useMemo(..., [sessions, activeSessionId])`：
 *
 * 1. 宽订阅 `s.sessions` ⇒ 流式每帧换数组引用 ⇒ 组件每帧重渲；
 * 2. `useMemo` 依赖那个引用 ⇒ 每帧对**全部会话**做 `filter + sort + slice`，纯浪费，
 *    而且跟对话框开没开完全无关（S-247 §21.3 实测：dev 下这一处占残量 58%）。
 *
 * ## 现在怎么算
 *
 * - `buildRecentSessionsSignature`：**单次遍历**取 top-N（不 sort、不 slice、不产数组），
 *   只拼一个字符串。选它而不是「过滤后再比数组」，是因为签名必须能区分
 *   「top-N 变了」与「top-N 之外的会话在流式 churn」—— 后者**不该**触发重算。
 * - `selectRecentSessions`：真正要渲染时才调，一次 sort + slice。
 *
 * 两者共用 `pickRecentSessions` 的排序口径，避免「签名算的 5 条」和「渲染的 5 条」错位。
 */

import type { Session } from '@renderer/stores/chat-store/types'

/** 最近会话列表项。字段就是 UI 真正读的那三个（id 作 key、title 显示、updatedAt 显示相对时间）。 */
export interface RecentSessionItem {
  id: string
  title: string
  updatedAt: number
}

export const RECENT_SESSIONS_LIMIT = 5

/**
 * 单次遍历取 top-N（updatedAt 倒序，同值按 id 升序保证确定性）。
 *
 * 不调 `Array.prototype.sort`：N 只有 5，插进小数组更便宜，且**不产生临时数组**——
 * 这个函数每帧都会被签名 selector 调一次，省的就是这层分配。
 */
function pickRecentSessions(
  sessions: readonly Session[],
  activeSessionId: string | null,
  limit: number
): RecentSessionItem[] {
  const picked: RecentSessionItem[] = []
  for (const session of sessions) {
    if (!session || session.id === activeSessionId) continue
    const item: RecentSessionItem = {
      id: session.id,
      title: session.title ?? '',
      updatedAt: session.updatedAt ?? 0
    }
    if (picked.length === limit && !isBetter(item, picked[picked.length - 1])) continue
    let at = picked.length
    while (at > 0 && isBetter(item, picked[at - 1])) at -= 1
    if (at === picked.length) {
      if (picked.length < limit) picked.push(item)
    } else {
      picked.splice(at, 0, item)
      if (picked.length > limit) picked.pop()
    }
  }
  return picked
}

function isBetter(a: RecentSessionItem, b: RecentSessionItem): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
  return a.id < b.id
}

/** 真正要渲染的那 5 条（只在对话框打开时才该调用）。 */
export function selectRecentSessions(
  sessions: readonly Session[],
  activeSessionId: string | null,
  limit: number = RECENT_SESSIONS_LIMIT
): RecentSessionItem[] {
  return pickRecentSessions(sessions, activeSessionId, limit)
}

/**
 * 订阅用的签名。**只要 top-N 的 id / title / updatedAt 没变，签名就不变** ⇒
 * 别的会话在流式追加时，本组件不会被叫醒重算。
 *
 * 分隔符用 `\u0001` / `\u0002`：title 里可能带 `:` 或 `|`，用可打印字符拼会撞车
 * （侧栏那条 S-247 签名踩过同款坑）。
 */
export function buildRecentSessionsSignature(
  sessions: readonly Session[],
  activeSessionId: string | null,
  limit: number = RECENT_SESSIONS_LIMIT
): string {
  const picked = pickRecentSessions(sessions, activeSessionId, limit)
  let signature = ''
  for (const item of picked) {
    signature += `${item.id}\u0001${item.updatedAt}\u0001${item.title}\u0002`
  }
  return signature
}
