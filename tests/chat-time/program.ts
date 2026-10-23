// iter-v3-1 S-222 — 聊天窗时刻格式化（`formatChatTime`）。
//
// 锁三件事：
//   1. 当天只给 `HH:MM`，非当天补 `MM-DD`，跨年补 `YYYY-MM-DD` —— 分隔符固定，不随 locale 变；
//   2. 判「同一自然日」按本地墙钟字段，不是滚动 24 小时（昨晚 23:50 今早看必须是「昨天」）；
//   3. 无效值一律空串，绝不吐 `NaN-NaN`。
//
// `chat-time.ts` 是零依赖纯模块，可静态 import。
// 注意：`tests/**` 不在任何 tsconfig 的 include 里，`npm run typecheck` 覆盖不到本文件，
// 正确性全靠下面的运行时断言 —— 所以用例要 greedy 一点。

import assert from 'node:assert/strict'
import { formatChatTime } from '../../src/renderer/src/lib/utils/chat-time'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// 本地时间构造器。月份用 1-based（与 `Date` 的 0-based 区分开），全文件只在这里做转换。
const at = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

// 固定「现在」= 2026-10-23 08:00 本地时间。所有用例显式传它，
// 免得用 Date.now() 现算在 00:00 前后跑出间歇失败。
const NOW = at(2026, 10, 23, 8, 0)

// ── 1. 当天：只给时分 ────────────────────────────────────────────────────

function testSameDay(): void {
  eq(formatChatTime(at(2026, 10, 23, 9, 55), NOW), '09:55', '当天上午补零')
  eq(formatChatTime(at(2026, 10, 23, 7, 5), NOW), '07:05', '当天早于 now 也是时分')
  eq(formatChatTime(at(2026, 10, 23, 0, 0), NOW), '00:00', '当天零点')
  eq(formatChatTime(at(2026, 10, 23, 23, 59), NOW), '23:59', '当天 23:59 仍不带日期')
  eq(formatChatTime(at(2026, 10, 23, 13, 0), NOW), '13:00', '下午是 24 小时制，不写 1:00 PM')
}

// ── 2. 非当天：补 MM-DD ──────────────────────────────────────────────────

function testOtherDaySameYear(): void {
  eq(formatChatTime(at(2026, 10, 22, 23, 41), NOW), '10-22 23:41', '昨天补月日')
  eq(formatChatTime(at(2026, 10, 1, 0, 0), NOW), '10-01 00:00', '月与日都补零')
  eq(formatChatTime(at(2026, 3, 9, 15, 7), NOW), '03-09 15:07', '异地月也补零')
  eq(formatChatTime(at(2026, 1, 1, 0, 0), NOW), '01-01 00:00', '同年元旦')
  // 年份维度必须参与比较：少了它，「去年同月同日」会被写成今天的时刻。
  // 这条是变异测出来的 —— 删掉 getFullYear() 那一项，其余 22 条断言全绿。
  eq(formatChatTime(at(2025, 10, 23, 9, 55), NOW), '2025-10-23 09:55', '去年同月同日不能漏年份')
}

function testCrossYear(): void {
  eq(formatChatTime(at(2025, 12, 31, 23, 41), NOW), '2025-12-31 23:41', '跨年补年份')
  eq(formatChatTime(at(2024, 2, 29, 12, 0), NOW), '2024-02-29 12:00', '闰日')
}

// ── 3. 自然日边界：跨午夜必须换日期，不能按 24 小时差 ────────────────────

function testMidnightBoundary(): void {
  // 23:50 与 08:00 只差 8.4 小时，按 `now - value < 86400000` 会判成同一天 —— 这里必须带日期。
  eq(
    formatChatTime(at(2026, 10, 22, 23, 50), NOW),
    '10-22 23:50',
    '昨晚 23:50 今早看是「昨天」，不是「23:50」'
  )
  // 反向：刚刚过午夜，同一 24 小时内但已是新的一天。
  const justAfterMidnight = at(2026, 10, 23, 0, 10)
  eq(
    formatChatTime(at(2026, 10, 22, 23, 59), justAfterMidnight),
    '10-22 23:59',
    '差 11 分钟但跨日 ⇒ 带日期'
  )
  eq(formatChatTime(justAfterMidnight, justAfterMidnight), '00:10', '同一时刻 ⇒ 时分')
}

// ── 4. 无效值：一律空串，绝不吐 NaN ──────────────────────────────────────

function testInvalidValues(): void {
  eq(formatChatTime(undefined, NOW), '', 'undefined')
  eq(formatChatTime(null, NOW), '', 'null')
  eq(formatChatTime(Number.NaN, NOW), '', 'NaN')
  eq(formatChatTime(Number.POSITIVE_INFINITY, NOW), '', 'Infinity')
  // isFinite 为 true 但 Date 装不下（上限 ±8.64e15）⇒ 必须靠 isNaN(getTime()) 拦。
  eq(formatChatTime(1e16, NOW), '', '越界有限值不能吐 NaN-NaN')
  eq(formatChatTime(-1e16, NOW), '', '负向越界同理')
  // 参照时刻坏掉时宁可静默不渲染，也不能凭空猜一个时刻。写错（返回 hm 或抛错）此前无断言可拦。
  eq(formatChatTime(at(2026, 10, 23, 9, 55), Number.NaN), '', 'now 非法时静默不渲染')
}

// ── 5. now 缺省走当前时间（不传 now 时今天必须仍只给时分） ───────────────

function testNowDefaultsToCurrentTime(): void {
  const before = Date.now()
  const label = formatChatTime(before) // 只取一次时：函数内部再取一次，两次跨午夜就会假红
  const after = Date.now()
  // 0.01% 的跨日窗口直接跳过 —— 宁可少测一次，也不要一条偶发变红的断言。
  if (new Date(before).getDate() !== new Date(after).getDate()) return

  const d = new Date(before)
  const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  eq(label, expected, '不传 now 时按当前时间判，今天只给时分')
  // 关键回归：若 now 缺省写错成 `new Date(undefined)`，比较恒 false，这里会带日期。
  eq(label.includes('-'), false, 'now 缺省时结果不得含日期分隔符')
}

const tests: Array<[string, () => void]> = [
  ['当天只给时分', testSameDay],
  ['同年其它日子补 MM-DD', testOtherDaySameYear],
  ['跨年补年份', testCrossYear],
  ['跨午夜按自然日换日期', testMidnightBoundary],
  ['无效值返回空串', testInvalidValues],
  ['now 缺省取当前时间', testNowDefaultsToCurrentTime]
]

for (const [name, run] of tests) {
  run()
  console.log(`PASS: ${name}`)
}

console.log(`chat-time: ${checks} assertions passed`)
