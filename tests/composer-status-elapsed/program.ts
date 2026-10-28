// iter-39 S-197 — 状态栏「运行中动态耗时」口径。
//
// 这个需求本身只是一处派生显示，**风险全在口径**：
//   • 起点必须是「本轮 run 的开跑时刻」（= 流式 assistant 消息的 createdAt），
//     且必须与跑完后操作栏的 `updatedAt − createdAt` 同口径，否则末值会跳字；
//   • 跑完必须**立刻收起**，不能因为 activeTool / activeSubAgent 这些残留桶而继续走表；
//   • 历史回放（messagesOverride）不能走表。
//
// 这里把上述判据钉死成函数级断言。实机观感（走字不间断、不跳字）仍需老大验证，
// 但「什么情况下出数、出什么数」这一层不该再靠人肉回归。

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  formatDurationMs,
  resolveRunningElapsedLabel
} from '../../src/renderer/src/lib/format-duration'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// 用一个像样的 epoch 值，避免靠 0 附近的巧合过关。
const T0 = 1_700_000_000_000

// ── 1. 守门：三种必须「不出数」的情况 ──────────────────────────────────────────
// 宁可没有，不可报 0 或负数 —— 与操作栏 `elapsedMs === null` 的态度一致。

function testGuardClauses(): void {
  // ① 无起点：run 未开始，或已结束（streamingMessages[sessionId] 已被清）
  eq(
    resolveRunningElapsedLabel({ startedAt: null, now: T0 + 5_000 }),
    null,
    'startedAt 为 null ⇒ null（跑完立即收起，不保留）'
  )

  // ② 历史回放 / 只读态
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 5_000, disabled: true }),
    null,
    'disabled（messagesOverride 分支）⇒ null，回看旧会话不走表'
  )

  // ③ 首帧兜底：tick 还没落定
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: 0 }), null, 'now 尚未 tick ⇒ null（不报负数）')
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 }),
    null,
    'now === startedAt ⇒ null（零长不给 "0ms"，下一帧再说）'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 - 1 }),
    null,
    'now < startedAt ⇒ null（时钟回拨也不出负数）'
  )

  // ④ 非有限值：坏数据不许穿透成 "NaNms"
  eq(
    resolveRunningElapsedLabel({ startedAt: Number.NaN, now: T0 + 1_000 }),
    null,
    'startedAt = NaN ⇒ null'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: Number.NaN }),
    null,
    'now = NaN ⇒ null'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: Number.POSITIVE_INFINITY }),
    null,
    'now = Infinity ⇒ null'
  )
}

// ── 2. 与操作栏同口径 ────────────────────────────────────────────────────────
// 状态栏走 table 的每一步都必须等于 `formatDurationMs(now − startedAt)` ——
// 这正是操作栏算 `updatedAt − createdAt` 之后喂给 formatDurationMs 的同一个式子。
// 锁死这条 ⇒ 走字末值必然与跑完后亮出的数字衔接，不会跳字。
//
// S-254（2026-10-28）：亚秒段是**唯一**的分叉点 —— 操作栏照样出 `340ms`，
// 状态栏不出数（老大口径「输入框左上角状态栏不需要毫秒」）。1s 以上仍必须逐字相同。

function testSameScaleAsActionBar(): void {
  for (const delta of [1, 340, 999]) {
    eq(
      resolveRunningElapsedLabel({ startedAt: T0, now: T0 + delta }),
      null,
      `Δt=${delta}ms 亚秒段状态栏不出数（S-254），别闪 340ms`
    )
  }
  const cases = [1_000, 1_234, 12_000, 59_999, 60_000, 65_000, 599_000, 3_600_000, 3_725_000, 90_061_000]
  for (const delta of cases) {
    eq(
      resolveRunningElapsedLabel({ startedAt: T0, now: T0 + delta }),
      formatDurationMs(delta),
      `Δt=${delta}ms 必须与操作栏同口径（formatDurationMs）`
    )
  }
}

// ── 3. 单位阶梯（防止有人换掉 formatter 导致观感跳档） ────────────────────────

function testUnitLadder(): void {
  // 亚秒段：状态栏不出数，格式化函数本身仍保留 ms（工具调用要它）。
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 999 }), null, '亚秒段状态栏不出数')
  eq(formatDurationMs(999), '999ms', '亚秒段（工具调用档）仍出 ms')
  // S-245（2026-10-27）：秒段不再保留小数 —— 原来这里是 '1.2s'。
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 1_234 }), '1s', '秒段取整')
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 1_600 }), '2s', '秒段四舍五入')
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 12_000 }), '12s', '≥10s 转整数')
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 60_000 }), '1m', '整分不写秒')
  eq(resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 65_000 }), '1m5s', '分+秒')
  // S-254（2026-10-28）：小时档必须带秒 —— 老大的原话是「到1小时以后 出现的是时分 没有看到秒」。
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 3_725_000 }),
    '1h2m5s',
    '小时段带秒（3 725 000ms = 1h2m5s；原来只到 1h2m）'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 3_600_000 }),
    '1h',
    '整点不写分钟/秒'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 90_061_000 }),
    '1d1h1m1s',
    '天档（新增），25h 不写成 25h'
  )
  eq(
    resolveRunningElapsedLabel({ startedAt: T0, now: T0 + 172_800_000 }),
    '2d',
    '整天只写天'
  )
  // 取整只发生一次：59m59.6s 折上去是 1h，不该出 1h59m60s 这种怪读数。
  eq(formatDurationMs(3_599_600), '1h', '取整只在毫秒层做一次')
}

// ── 4. 口径只有一份实现，且只被状态栏消费 ─────────────────────────────────────
// 防止有人在别处把「怎么算运行中耗时」再抄一遍，导致两处口径分叉。

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function testSingleImplementation(): void {
  // `__dirname` 是打包产物目录（tests/composer-status-elapsed/out）—— 上溯三级即仓库根。
  const root = path.resolve(__dirname, '../../../src/renderer/src')
  const files = collectSourceFiles(root)

  const declaring: string[] = []
  const consuming: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (/export function resolveRunningElapsedLabel\(/.test(text)) declaring.push(file)
    else if (text.includes('resolveRunningElapsedLabel')) consuming.push(file)
  }

  eq(files.length > 0, true, `扫到源码文件（${files.length} 个）`)
  eq(
    declaring.length,
    1,
    `resolveRunningElapsedLabel 只能有一份实现，实际：${declaring.join(', ') || '（无）'}`
  )
  eq(
    declaring[0]?.endsWith(path.join('lib', 'format-duration.ts')),
    true,
    `实现应当在 lib/format-duration.ts（零依赖叶子模块，node 侧才测得了），实际：${declaring[0] ?? '（无）'}`
  )
  eq(
    consuming.length,
    1,
    `消费方只应有状态栏一处，实际：${consuming.join(', ') || '（无）'}`
  )
  eq(
    consuming[0]?.endsWith(path.join('InputArea', 'composer-status-indicator.tsx')),
    true,
    `消费方应当是 composer-status-indicator.tsx，实际：${consuming[0] ?? '（无）'}`
  )
}

const tests: Array<[string, () => void]> = [
  ['守门：无起点 / 历史回放 / 首帧 / 非有限值', testGuardClauses],
  ['与操作栏同口径（formatDurationMs(now − startedAt)）', testSameScaleAsActionBar],
  ['单位阶梯 ms / s / m / h', testUnitLadder],
  ['口径单一实现且只被状态栏消费', testSingleImplementation]
]

function main(): void {
  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }
  console.log(`composer-status-elapsed: ${checks} assertions passed`)
}

main()
