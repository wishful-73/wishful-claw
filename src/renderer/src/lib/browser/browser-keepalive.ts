/*
 * 内置浏览器保活池（S-260）。
 *
 * 背景：webview 一直是「有 tab 就挂载、零上限」（`RightPanel.tsx` 全量 map）。每个
 * webview 是一个独立 renderer 进程，开过浏览器的会话越多，常驻内存越高 —— 这是
 * S-247 里最确定的一条可疑源。
 *
 * 这里只放**判据**，不碰 React、不碰 store —— 因为淘汰顺序错了后果很重（把正在跑
 * 任务的会话 webview 卸掉，agent 会拿到「Browser view is not attached」然后无脑重试），
 * 而这类错不会抛异常，只会让行为变得难以解释。所以它必须能测。
 *
 * 两条硬规矩（S-260 §4.2 级 0）：
 *   1. 用户当前正在看的那个作用域，绝不淘汰；
 *   2. agent 正持有 lease 的会话，绝不淘汰。
 * 一个都不许动时，**不许静默** —— 给 agent 一段能转述给用户的说明（§4.3）。
 */

/** 常驻上限：同时「活着」的会话浏览器最多两个（老大 2026-10-28 16:22 拍的）。 */
export const BROWSER_KEEPALIVE_LIMIT = 2
/** 不可见 + 无 lease + 空闲超过这个时长 ⇒ 自动回收，不提示（§4.4）。 */
export const BROWSER_IDLE_EVICT_MS = 5 * 60_000

/** 池里的一个会话。存在即「挂载 BrowserPanel」。 */
export interface BrowserKeepAliveSlot {
  /** sessionId ?? 'global'，与 tab 归属桶同源（right-panel-scope.ts） */
  scopeId: string
  lastAccessAt: number
}

/** 给 agent 看的占用者信息（§4.3「列出占用者」）。 */
export interface BrowserKeepAliveOccupant {
  scopeId: string
  title: string
  url: string
  lastAccessAt: number
  leased: boolean
}

export type BrowserKeepAlivePlan =
  | { action: 'attach' }
  /** 腾位置：卸载 evictScopeId 的 webview，再把 target 挂上 */
  | { action: 'reclaim'; evictScopeId: string; forced: boolean }
  /** 一个都不许动。reason 是给 agent 的结构化说明，不是给人看的日志 */
  | { action: 'reject'; reason: string }

function isEvictable(
  slot: BrowserKeepAliveSlot,
  leases: Record<string, number | undefined>,
  visibleScopeId: string | null
): boolean {
  if (slot.scopeId === visibleScopeId) return false
  return (leases[slot.scopeId] ?? 0) === 0
}

/**
 * 决定这次「要挂载 target」该怎么走。
 *
 * `explicit` 区分两类调用方：
 * - **用户显式**（点开浏览器 tab / 手动输地址）：池满且一个都不许动时，**仍然腾位** ——
 *   淘汰最久未活跃的那个（`forced: true`）。用户自己要看页面，弹一句「等别人用完」是不可接受的。
 * - **agent 后台**（工具调用）：一个都不许动 ⇒ reject，理由写清楚，让 agent 决定等 / 换方案 / 请用户介入。
 *
 * 这个不对称是有意的：对用户来说「打不开」是功能障碍，对 agent 来说「说不清为什么」才是。
 */
export function planBrowserKeepAlive(params: {
  slots: readonly BrowserKeepAliveSlot[]
  leases: Record<string, number | undefined>
  /** 用户当前正在看的作用域；null 表示拿不到，此时不保护任何会话 */
  visibleScopeId: string | null
  targetScopeId: string
  explicit: boolean
  limit?: number
  /**
   * reject 分支要写清「谁占着、占的什么页面」。池里只存 scopeId + 时间，
   * 标题和 URL 在别的 store 里 —— 所以由调用方给一个查询函数，纯函数这边不跨界取数。
   */
  describeScope?: (scopeId: string) => { title: string; url: string }
}): BrowserKeepAlivePlan {
  const limit = params.limit ?? BROWSER_KEEPALIVE_LIMIT
  const { slots, leases, visibleScopeId, targetScopeId } = params

  // 已在池里：不占新名额，直接复用（这也让「自愈重开」这条路天然幂等）
  if (slots.some((slot) => slot.scopeId === targetScopeId)) return { action: 'attach' }
  if (slots.length < limit) return { action: 'attach' }

  const candidates = slots.filter((slot) => isEvictable(slot, leases, visibleScopeId))
  if (candidates.length > 0) {
    // 空闲最久优先 —— 刻意不看「是否在调用中」：两次工具调用之间的思考间隙也算空闲
    const oldest = candidates.reduce((min, slot) => (slot.lastAccessAt < min.lastAccessAt ? slot : min))
    return { action: 'reclaim', evictScopeId: oldest.scopeId, forced: false }
  }

  if (params.explicit) {
    // 用户优先，但仍然先找**没被任务占着**的：顶掉一个正在跑任务的 webview，那边会拿到
    // 「detached」然后重试一轮，用户只是想看个页面，不值得让另一个会话返工。
    const unleased = slots.filter((slot) => (leases[slot.scopeId] ?? 0) === 0)
    const pool = unleased.length > 0 ? unleased : slots
    const oldest = pool.reduce((min, slot) => (slot.lastAccessAt < min.lastAccessAt ? slot : min))
    return { action: 'reclaim', evictScopeId: oldest.scopeId, forced: true }
  }

  const now = Date.now()
  const occupants: BrowserKeepAliveOccupant[] = slots.map((slot) => {
    const info = params.describeScope?.(slot.scopeId)
    return {
      scopeId: slot.scopeId,
      title: info?.title || slot.scopeId,
      url: info?.url ?? '',
      lastAccessAt: slot.lastAccessAt,
      leased: (leases[slot.scopeId] ?? 0) > 0
    }
  })
  return { action: 'reject', reason: describeKeepAliveOccupants(occupants, now, limit) }
}

/** 「N 分钟前」这种粗糙但够用的相对时间 —— 别为此引依赖。 */
export function describeIdle(lastAccessAt: number, now: number): string {
  const elapsed = Math.max(0, now - lastAccessAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/**
 * 池满且一个都不许动时给 agent 的话（§4.3）。要三样东西：**谁占着**、**占的什么页面**、
 * **能做什么**。少任何一样，agent 就只能瞎猜或者无脑重试。
 */
export function describeKeepAliveOccupants(
  occupants: readonly BrowserKeepAliveOccupant[],
  now: number,
  limit = BROWSER_KEEPALIVE_LIMIT
): string {
  const lines = occupants.map((occupant) => {
    const url = occupant.url || 'no page loaded'
    const busy = occupant.leased ? ', a task is using it right now' : ''
    return `- "${occupant.title}" ${url} (${describeIdle(occupant.lastAccessAt, now)}${busy})`
  })
  return [
    `Browser keep-alive limit reached (${limit} sessions). Sessions currently holding a slot:`,
    ...lines,
    'None of them can be evicted right now: the visible session and sessions with a running task are protected.',
    'Wait until one of those tasks finishes, ask the user to close one of those browser panels, or take another approach that does not need a browser.'
  ].join('\n')
}

/**
 * 空闲回收（§4.4）：不可见 + 无 lease + 空闲超时 ⇒ 该卸。
 * 单独一个函数是因为它和「腾位置」不是一回事：这条**不需要** pool 满，随时可以发生。
 */
export function shouldEvictIdle(params: {
  slot: BrowserKeepAliveSlot
  leases: Record<string, number | undefined>
  visibleScopeId: string | null
  now: number
  idleMs?: number
}): boolean {
  const idleMs = params.idleMs ?? BROWSER_IDLE_EVICT_MS
  if (params.slot.scopeId === params.visibleScopeId) return false
  if ((params.leases[params.slot.scopeId] ?? 0) > 0) return false
  return params.now - params.slot.lastAccessAt >= idleMs
}
