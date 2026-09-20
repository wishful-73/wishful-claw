/**
 * S-101 记忆库时间区间的边界计算（`src/renderer/src/lib/memory-time-range.ts`）。
 *
 * 钉住两件事：① 区间覆盖多少个自然日（含今天）；② 边界按**本地日**切，不走 UTC ——
 * UTC 日的「今天」在东八区要到早上 8 点才追上，在那之前筛「今天」会漏掉一整天的记忆。
 *
 * 期望值一律用本地时间构造（`new Date(y, m, d)` 即本地零点），因此在任何时区跑都成立；
 * 最后一条断言正面检查「起点落在本地零点」而不是「等于某个 UTC 常量」。
 */
import {
  MEMORY_TIME_RANGE_IDS,
  resolveMemoryTimeBounds
} from '@renderer/lib/memory-time-range'

let passed = 0
const failures: string[] = []

function check(condition: boolean, message: string): void {
  if (condition) passed += 1
  else failures.push(message)
}

const seconds = (date: Date): number => Math.floor(date.getTime() / 1000)

/** 本地某天 00:00:00.000 的 Unix 秒。 */
const localMidnight = (year: number, monthIndex: number, day: number): number =>
  seconds(new Date(year, monthIndex, day))

// 顺序即展示顺序。
check(
  MEMORY_TIME_RANGE_IDS.join(',') === 'all,today,week,month',
  'range ids keep their display order'
)

// all 不限。
const all = resolveMemoryTimeBounds('all', new Date(2026, 8, 20, 9, 30))
check(all.from === undefined && all.to === undefined, 'all carries no bounds')

// 固定时刻：本地 2026-09-20 09:30。
const now = new Date(2026, 8, 20, 9, 30)
const nowSeconds = seconds(now)

const today = resolveMemoryTimeBounds('today', now)
check(today.from === localMidnight(2026, 8, 20), 'today starts at local midnight')
check(today.to === nowSeconds, 'today ends at now')

const week = resolveMemoryTimeBounds('week', now)
check(
  week.from === localMidnight(2026, 8, 14),
  'week covers 7 local days including today'
)
check(week.to === nowSeconds, 'week ends at now')

const month = resolveMemoryTimeBounds('month', now)
check(
  month.from === localMidnight(2026, 7, 22),
  'month covers 30 local days including today'
)
check(month.to === nowSeconds, 'month ends at now')

// 跨月、跨年：起点用 Date 的日期减法，不能自己按月/年拆。
const acrossYear = resolveMemoryTimeBounds('week', new Date(2027, 0, 2, 0, 5))
check(
  acrossYear.from === localMidnight(2026, 11, 27),
  'week start crosses the year boundary'
)

// 2026-03-01 往前 29 天 = 2026-01-31（二月只有 28 天，跨过了整个二月）。
const acrossMonth = resolveMemoryTimeBounds('month', new Date(2026, 2, 1, 12, 0))
check(
  acrossMonth.from === localMidnight(2026, 0, 31),
  'month start crosses the month boundary'
)

// 正面检查本地日口径：起点落在本地 00:00:00.000，而不是 UTC 午夜。
const startDate = new Date((week.from ?? 0) * 1000)
check(
  startDate.getHours() === 0 && startDate.getMinutes() === 0 && startDate.getSeconds() === 0,
  'range start lands on a local midnight rather than a UTC one'
)
check(
  startDate.getDate() === 14 && startDate.getMonth() === 8 && startDate.getFullYear() === 2026,
  'range start lands on the expected local calendar day'
)

// 区间是闭区间，且起点早于终点。
check(
  (today.from ?? 0) < (today.to ?? 0) && (week.from ?? 0) < (week.to ?? 0),
  'bounds form a non-empty closed interval'
)

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  console.error(`memory time range checks failed: ${failures.length}`)
  process.exit(1)
}

console.log(`memory time range checks passed: ${passed}`)
