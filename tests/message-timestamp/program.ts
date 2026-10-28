// iter-31 S-54 — agent 消息时间戳：两个时间戳的搬运 + 耗时格式化。
//
// 背景：`ChatMessage` → `UnifiedMessage` 的转换层（`MessageList/utils.ts` 的
// `convertChatMessagesToUnified`）是**白名单式重建** —— 逐字段搬运，唯独漏了
// `updatedAt`。于是消费方 `MessageItem` 的 `updatedAt ?? createdAt` 永远回落
// `createdAt`，聊天窗显示的永远是「开始时间」，而不是「这一轮跑完的时刻」。
//
// 这里锁两件事：
//   1. `convertChatMessagesToUnified` 必须把 `updatedAt` 搬过去；缺省/脏值时不能
//      凭空造一个出来（老消息 `updated_at` 是 NULL，本来就该回落 createdAt）。
//   2. `formatDurationMs` 的小时档（S-54 新增），且 60 分钟以内的输出一字不变 ——
//      这个函数被图片生成 loader / TTFT / 用量面板共用，补档不能动既有行为。
//
// `format-duration.ts` 是零依赖纯模块，可以静态 import；`MessageList/utils.ts`
// 的依赖链会拉到 Electron IPC client（模块顶层读 `window.electron`），所以要走
// 动态 import，并先按 `renderable-chat-items` 测试的既有做法把 window 补上。

import assert from 'node:assert/strict'
import { formatDurationMs } from '../../src/renderer/src/lib/format-duration'

let convertChatMessagesToUnified: typeof import('../../src/renderer/src/components/chat/MessageList/utils').convertChatMessagesToUnified

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

const T0 = 1_700_000_000_000

// ── 1. updatedAt 的搬运 ───────────────────────────────────────────────────

function testUpdatedAtCarried(): void {
  const converted = convertChatMessagesToUnified([
    { id: 'm1', role: 'assistant', text: 'hi', createdAt: T0, updatedAt: T0 + 30_000 }
  ])
  eq(converted[0].createdAt, T0, 'createdAt 照搬')
  eq(converted[0].updatedAt, T0 + 30_000, 'updatedAt 必须搬过去（S-54 正题）')
}

function testMissingUpdatedAtStaysUndefined(): void {
  const converted = convertChatMessagesToUnified([
    { id: 'm2', role: 'assistant', text: 'legacy', createdAt: T0 }
  ])
  eq(
    converted[0].updatedAt,
    undefined,
    '缺 updatedAt 时保持 undefined，绝不回填成 createdAt'
  )
}

function testZeroUpdatedAtIsCarried(): void {
  const converted = convertChatMessagesToUnified([
    { id: 'm3', role: 'assistant', text: 'x', createdAt: T0, updatedAt: 0 }
  ])
  eq(converted[0].updatedAt, 0, 'updatedAt 为 0 也是合法数字，要搬')
}

function testJunkUpdatedAtIsDropped(): void {
  const converted = convertChatMessagesToUnified([
    { id: 'm4', role: 'assistant', text: 'x', createdAt: T0, updatedAt: 'nope' }
  ])
  eq(converted[0].updatedAt, undefined, 'updatedAt 非数字时不搬运')
}

// ── 2. formatDurationMs 档位 ──────────────────────────────────────────────

function testMillisecondBand(): void {
  eq(formatDurationMs(0), '0ms', '0ms')
  eq(formatDurationMs(1), '1ms', '1ms')
  eq(formatDurationMs(850), '850ms', '850ms')
  eq(formatDurationMs(999), '999ms', '999ms')
  eq(formatDurationMs(-100), '0ms', '负值钳到 0ms')
}

function testSecondBand(): void {
  // S-245（2026-10-27 老大：「s 出现了 7.3s 这种格式 1.1s 这种 我希望不要有小数」）：
  // 秒档一律取整，四舍五入。**这几条是这次改动的主要断言** —— 原来的 1.5s / 6.2s 必须变成 2s / 6s。
  eq(formatDurationMs(1000), '1s', '整秒')
  eq(formatDurationMs(1100), '1s', '1.1s → 1s（老大点名的那个格式）')
  eq(formatDurationMs(1500), '2s', '1.5s → 2s（四舍五入，不是截断）')
  eq(formatDurationMs(6200), '6s', '6.2s → 6s')
  eq(formatDurationMs(7300), '7s', '7.3s → 7s（老大截图里那个）')
  eq(formatDurationMs(9999), '10s', '9.999s → 10s')
  eq(formatDurationMs(10_000), '10s', '10s')
  eq(formatDurationMs(15_000), '15s', '15s')
  eq(formatDurationMs(59_400), '59s', '秒档上沿')
  // 反向：秒档不许再出现小数点 —— 逐值扫一遍，漏一个就红。
  for (const ms of [1010, 1234, 1999, 2345, 5678, 6001, 12_345, 45_678]) {
    const out = formatDurationMs(ms)
    eq(out.includes('.'), false, `${ms}ms 的读数不许带小数点，实际：${out}`)
  }
}

function testMinuteBand(): void {
  // 秒为 0 的读数按老大要求收短（1m 而不是 1m0.0s），其余与补小时档之前一字不差。
  eq(formatDurationMs(60_000), '1m', '整分不写秒')
  eq(formatDurationMs(63_000), '1m3s', '秒 < 10 也不带 .0')
  eq(formatDurationMs(90_000), '1m30s', '1m30s')
  eq(formatDurationMs(514_000), '8m34s', '实测那轮 514s')
  eq(formatDurationMs(3_599_000), '59m59s', '分钟档上沿')
  // S-245：分钟档的秒部分同样取整（原来会出 1m23.4s）。
  eq(formatDurationMs(83_400), '1m23s', '1m23.4s → 1m23s')
  eq(formatDurationMs(61_600), '1m2s', '1m1.6s → 1m2s（四舍五入）')
  // S-254（2026-10-28）：取整只在毫秒层发生一次 ⇒ 119.6s 直接就是 2m。
  // 原来这里钉的是「1m60s」这个既有瑕疵（秒部分二次四舍五入），换个拆位算法顺手修掉了。
  eq(formatDurationMs(119_600), '2m', '119.6s → 2m（不再出 1m60s）')
  eq(formatDurationMs(83_400).includes('.'), false, '分钟档读数不许带小数点')
}

function testHourBand(): void {
  // S-54 新增：旧实现在这几行会吐出 60m0s / 90m0s / 24h0m。
  eq(formatDurationMs(3_600_000), '1h', '整点不写分钟')
  eq(formatDurationMs(5_400_000), '1h30m', '90 分钟不再读作 90m0s')
  eq(formatDurationMs(7_500_000), '2h5m', '125 分钟')
  // S-254（2026-10-28）：小时档补回秒，天档新增。
  eq(formatDurationMs(3_725_000), '1h2m5s', '小时档带秒（原来只到 1h2m）')
  eq(formatDurationMs(3_661_000), '1h1m1s', '时分秒全有')
  eq(formatDurationMs(86_400_000), '1d', '满 24 小时折成 1d（原来写 24h）')
  eq(formatDurationMs(90_061_000), '1d1h1m1s', '天档')
  eq(formatDurationMs(172_800_000), '2d', '整天只写天')
}

const tests: Array<[string, () => void]> = [
  ['updatedAt 被搬进 UnifiedMessage', testUpdatedAtCarried],
  ['缺 updatedAt 时保持 undefined', testMissingUpdatedAtStaysUndefined],
  ['updatedAt 为 0 时照搬', testZeroUpdatedAtIsCarried],
  ['updatedAt 非数字时丢弃', testJunkUpdatedAtIsDropped],
  ['耗时：毫秒档', testMillisecondBand],
  ['耗时：秒档', testSecondBand],
  ['耗时：分钟档', testMinuteBand],
  ['耗时：小时档（新增）', testHourBand]
]

async function main(): Promise<void> {
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async () => undefined,
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined
      }
    }
  }
  ;({ convertChatMessagesToUnified } = await import(
    '../../src/renderer/src/components/chat/MessageList/utils'
  ))

  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }

  console.log(`message-timestamp: ${checks} assertions passed`)
}

void main()
