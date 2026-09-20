/**
 * 记忆库「按修改时间筛选」的区间计算（iter-33 S-101）。
 *
 * 边界按**本地日**算，不走 UTC：UTC 日的「今天」在东八区要到早上 8 点才追上，在那之前
 * 筛「今天」会漏掉整整一天。起点取本地 00:00:00.000。
 *
 * 输出是 Unix 秒 —— 与 `memory/entries` / `memory/search` 的 `from` / `to` 参数同口径；
 * `undefined` 表示不限（worker 侧把非正数也视为同义）。
 */
export type MemoryTimeRangeId = 'all' | 'today' | 'week' | 'month'

/** 展示顺序即此顺序。 */
export const MEMORY_TIME_RANGE_IDS: readonly MemoryTimeRangeId[] = [
  'all',
  'today',
  'week',
  'month'
]

/** 每个区间覆盖多少个自然日（**含今天**）。'all' 不限，故不在此表内。 */
const RANGE_DAYS: Record<Exclude<MemoryTimeRangeId, 'all'>, number> = {
  today: 1,
  week: 7,
  month: 30
}

export interface MemoryTimeBounds {
  from?: number
  to?: number
}

const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1000)

/**
 * 把区间 id 翻译成 Unix 秒的闭区间。`now` 可注入，套件因此不依赖「跑测试的那一刻」。
 *
 * 上界取 `now` 而不是省略：区间两侧都收口，语义与「今天 / 近 7 天」的字面一致；
 * 未来时间不会写进库，所以它实际不会砍掉任何一行。
 */
export function resolveMemoryTimeBounds(
  id: MemoryTimeRangeId,
  now: Date = new Date()
): MemoryTimeBounds {
  if (id === 'all') return {}

  const days = RANGE_DAYS[id]
  // 含今天在内的 days 个自然日 ⇒ 从今天往前数 days-1 天。
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: toUnixSeconds(start), to: toUnixSeconds(now) }
}
