// S-307 — 分支视图提交行的时间格式。
//
// 起因：后端 `--date=iso` 早就把 `%ad` 取回来了（`GitQueryTools.cs:244/248`），
// 前端类型也声明了 `date`（`git-store-types.ts:54`），但 `CommitGraphList` 一次没用 ——
// 提交行只剩备注 + 短 hash。本模块只做格式化，取数与渲染各归各位。
//
// 两条硬约束：
//   1. **不解析成 `Date`**。git `--date=iso` 给的是 `2026-11-03 15:41:07 +0800`，
//      不是标准 ISO 8601（缺 `T`），`new Date()` 对它的解释依引擎而异 —— 有的当本地、
//      有的当 UTC，跨时区用户会看到偏移过的时刻。既然是定长文本，就按定长切。
//   2. **零依赖**（不 import、不读 `window`、不碰 i18n），好在 `tests/commit-time`
//      里被 node 直接静态 import 跑断言。
//
// 行内只给 `MM-DD`（跨年 `YY-MM-DD`）：右侧面板一行还要放提交说明、refs 徽标、短 hash，
// 多两个字符就把提交说明挤没。精确到秒的需求走 HoverCard。
//
// **不做相对时间**（`3 天前`）：它不会随时间自动重算，除非加一个常驻定时器反复重渲染；
// 不重算就是假精确 —— 半小时后仍写「5 分钟前」，比不显示更糟。收益不抵成本。

/**
 * git `--date=iso` 的定长前缀：`YYYY-MM-DD HH:mm:ss`。
 * 尾随时区（`+0800`）可缺 —— 本模块不消费它，也不做时区换算。
 */
const GIT_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/

interface GitIsoParts {
  year: number
  month: string
  day: string
  time: string
}

function parseGitIso(iso?: string | null): GitIsoParts | null {
  if (!iso) return null
  const matched = GIT_ISO_RE.exec(iso)
  if (!matched) return null
  return {
    year: Number(matched[1]),
    month: matched[2],
    day: matched[3],
    time: `${matched[4]}:${matched[5]}:${matched[6]}`
  }
}

/**
 * 提交行内显示的日期。
 *
 * - 与 `now` 同一年 → `11-03`
 * - 跨年 → `25-12-31`（补两位年份，否则两年之间无法区分）
 * - 无效值 → `''`，调用方据此不渲染（绝不出 `NaN-NaN`）
 *
 * @param iso git `--date=iso` 原始字符串
 * @param now 参照时刻，缺省取当前时间；单测里显式传入以固定「今年」
 */
export function formatCommitDay(iso?: string | null, now?: number): string {
  const parts = parseGitIso(iso)
  if (!parts) return ''

  const nowDate = now == null ? new Date() : new Date(now)
  // 参照时刻本身无效时退回「按提交自己的年份算」，至少显示 `MM-DD` 而不是空。
  const currentYear = Number.isNaN(nowDate.getTime()) ? parts.year : nowDate.getFullYear()

  const monthDay = `${parts.month}-${parts.day}`
  return parts.year === currentYear ? monthDay : `${String(parts.year).slice(2)}-${monthDay}`
}

/**
 * HoverCard 里显示的完整提交时刻 —— `YYYY-MM-DD HH:mm:ss`。
 *
 * 不含时区后缀：面板窄，且这里回答的是「这条提交是什么时候的」，
 * 精确到秒已经够定位，时区对单机用户没有信息量。
 */
export function formatCommitTime(iso?: string | null): string {
  const parts = parseGitIso(iso)
  if (!parts) return ''
  return `${parts.year}-${parts.month}-${parts.day} ${parts.time}`
}
