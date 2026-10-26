// S-222 — 聊天窗统一时刻格式。
//
// 起因：聊天窗里三处时刻各写各的 —— 用户消息与助手结束行用 `toLocaleTimeString`
// 只给 `HH:MM`（跨天看不出是哪天），压缩卡片却恒带日期（今天的消息也写 `10-23 09:55`）。
// 现在统一走这里：当天 `09:55`，非当天 `10-22 23:41`，跨年 `2025-12-31 23:41`。
//
// 两条硬约束：
//   1. **固定 24 小时制、手写补零**。`toLocaleString` 在英文面会吐 `2:41 PM`，
//      `month:'2-digit'` 的分隔符随 locale 变（`10/22` vs `10-22`）—— 一处宽一处窄。
//   2. **零依赖**（不 import、不读 `window`、不碰 i18n），好在 `tests/chat-time` 里
//      被 node 直接静态 import 跑断言。
//
// 判「同一自然日」用本地时区字段比较，不是滚动 24 小时：昨晚 23:50 的消息今早 08:00 看，
// 差 8 小时，按时间差判会仍写 `23:50`，而用户心智是「昨天」。
// 已知边角：比较的是本地墙钟，午夜切换的时区（如 America/Santiago）会把 00:00–01:00
// 的消息归到前一天。面向中英双语用户，接受。

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * 把毫秒时间戳格式化成聊天窗里的时刻。
 *
 * - 与 `now` 同一自然日 → `09:55`
 * - 同年其它日子 → `10-22 23:41`
 * - 跨年 → `2025-12-31 23:41`
 * - 无效值（`null` / `undefined` / `NaN` / `Infinity` / 越界有限值）→ `''`，调用方据此不渲染
 *
 * @param value 毫秒时间戳
 * @param now 参照时刻，缺省取当前时间；单测里显式传入以固定「今天」
 */
export function formatChatTime(value?: number | null, now?: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  const d = new Date(value)
  // `Number.isFinite(1e16)` 为 true，但 `new Date(1e16)` 是 Invalid Date（Date 上限 ±8.64e15）
  // —— 只靠 isFinite 拦不住，会吐出 `NaN-NaN NaN:NaN`。
  if (Number.isNaN(d.getTime())) return ''

  // 三处调用点都不传 now：漏掉这个缺省，`new Date(undefined)` 是 Invalid Date，
  // 比较恒为 false，今天的消息会一律带日期 —— 正是本需求要消除的形态。
  const nowDate = now == null ? new Date() : new Date(now)
  if (Number.isNaN(nowDate.getTime())) return ''

  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === nowDate.getFullYear() &&
    d.getMonth() === nowDate.getMonth() &&
    d.getDate() === nowDate.getDate()
  if (sameDay) return hm

  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === nowDate.getFullYear()
    ? `${md} ${hm}`
    : `${d.getFullYear()}-${md} ${hm}`
}
