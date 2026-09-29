// S-150 — 高度回收冷却锁契约。
//
// 抖动不是出在「单次回收」上（iter-30 S-32 已经把它做成单向、一次到位），而是出在
// **同一瞬间连着收几次**：折叠动画 0.2s、虚拟行重测、水位线撤销各报一次高度回缩，
// 每次都把 scrollTop 往小推一把，于是来回拉锯。
//
// 这些检查钉的就是「一串收缩被合并成一次位移」：冷却窗口内不许再收、窗口一过立刻放行、
// 时钟异常不许把视口永久锁死。

import assert from 'node:assert/strict'
import {
  admitCollapse,
  COLLAPSE_GATE_CONFIG,
  createCollapseGate,
  isCollapseCoolingDown,
  trackContentBottom
} from '../../src/renderer/src/components/chat/MessageList/scroll-collapse-gate'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

const { cooldownMs } = COLLAPSE_GATE_CONFIG

// ── 冷却时长本身：要比折叠动画（200ms）长 ─────────────────────────────────
check(cooldownMs > 200, `冷却要盖住折叠动画（${cooldownMs}ms）`)
check(cooldownMs <= 500, `冷却不能长到看起来像「不跟了」（${cooldownMs}ms）`)

// ── 从未回收过：不冷却，第一次回收立刻放行 ───────────────────────────────
const fresh = createCollapseGate()
check(!isCollapseCoolingDown(fresh, 0), '未曾回收时不冷却')
check(!isCollapseCoolingDown(fresh, 12_345.6), '未曾回收时（任意时刻）都不冷却')

// ── 受理之后窗口内一律冷却，窗口一过立刻放行 ─────────────────────────────
const admitted = admitCollapse(fresh, 1_000)
check(isCollapseCoolingDown(admitted, 1_000), '刚受理的同一时刻仍在冷却')
check(isCollapseCoolingDown(admitted, 1_000 + cooldownMs - 1), '窗口内差 1ms 仍冷却')
check(!isCollapseCoolingDown(admitted, 1_000 + cooldownMs), '窗口恰好到期即放行')
check(!isCollapseCoolingDown(admitted, 1_000 + cooldownMs * 10), '窗口之后一直放行')

// ── 纯度：受理不改入参，返回新状态 ───────────────────────────────────────
const before = createCollapseGate()
const beforeSnapshot = { ...before }
const after = admitCollapse(before, 2_000)
eq(before.lastCollapseAt, beforeSnapshot.lastCollapseAt, 'admitCollapse 不修改入参')
eq(after.lastCollapseAt, 2_000, 'admitCollapse 返回新的时间戳')

// 同一时刻重复受理不再产生新对象（同帧多处回收只记一次）
check(admitCollapse(after, 2_000) === after, '同一时刻重复受理复用同一状态')
check(admitCollapse(after, 2_001) !== after, '不同时刻受理产生新状态')

// ── 时钟异常按「不冷却」处理，绝不永久锁死 ───────────────────────────────
check(!isCollapseCoolingDown(admitted, 999), '时钟回拨（now < last）不冷却')
check(!isCollapseCoolingDown(admitted, Number.NaN), 'now 为 NaN 不冷却')
check(
  !isCollapseCoolingDown({ lastCollapseAt: Number.NaN }, 5_000),
  '时间戳为 NaN 不冷却'
)
check(
  !isCollapseCoolingDown({ lastCollapseAt: Number.POSITIVE_INFINITY }, 5_000),
  '时间戳为 +Infinity 不冷却'
)

// ── 自定义窗口 ──────────────────────────────────────────────────────────
const tight = { cooldownMs: 50 }
check(isCollapseCoolingDown(fresh, 10, tight) === false, '自定义窗口下未经手仍不冷却')
const tightAdmitted = admitCollapse(fresh, 10)
check(isCollapseCoolingDown(tightAdmitted, 59, tight), '自定义窗口内冷却')
check(!isCollapseCoolingDown(tightAdmitted, 60, tight), '自定义窗口到期即放行')

// ── 核心契约：一串收缩被合并，而不是每报一次收一次 ───────────────────────
//
// 场景：内容从 t=0 起每 50ms 报一次高度回缩，持续 600ms（13 次）。跟随逻辑每帧都在跑，
// 没有锁就是 13 次回收 —— 视口一路被往回拽。有锁则只在窗口到期的几个时刻收，其余全压掉。
let gate = createCollapseGate()
let admissions = 0
const admittedAt: number[] = []
for (let now = 0; now <= 600; now += 50) {
  if (isCollapseCoolingDown(gate, now)) continue
  if (!isCollapseCoolingDown(gate, now)) {
    gate = admitCollapse(gate, now)
    admissions++
    admittedAt.push(now)
  }
}
eq(admissions, 3, '600ms 里 13 次收缩被合并成 3 次回收')
eq(admittedAt.join(','), '0,250,500', '合并后的回收落在 0 / 250 / 500')
check(admissions < 13 / 2, '合并后次数不到无锁的一半')
for (let i = 1; i < admittedAt.length; i++) {
  check(
    admittedAt[i] - admittedAt[i - 1] >= cooldownMs,
    `相邻两次回收间隔不小于冷却窗口（${admittedAt[i - 1]} → ${admittedAt[i]}）`
  )
}

// 单次收缩不占用额外预算：窗口过后第一次判定就能收
let single = createCollapseGate()
single = admitCollapse(single, 10_000)
check(!isCollapseCoolingDown(single, 10_000 + cooldownMs), '单次收缩之后窗口一到就能再收')

// ── S-150 补充：内容底单调下界 ─────────────────────────────────────────────
//
// 冷却锁管的是「受理回收的节奏」，管不到「内容底本身在跳」。虚拟化下
// getRealContentBottom 遍历的是**当前挂载的行**，尾行在可见范围边界进出会让它骤降一整行，
// 跟随目标于是每帧一个值、每帧写一次 scrollTop —— 滚动条高频重定位。流式内容底只会增大，
// 取历史最大值即可把这类噪声滤掉。

// 增长必须透传，否则跟随就没了
eq(trackContentBottom(0, 500), 500, '首次实测直接采纳')
eq(trackContentBottom(500, 620), 620, '内容继续增大时透传新值')

// 骤降一律滤掉 —— 这就是抖动的直接来源
eq(trackContentBottom(620, 300), 620, '内容底骤降（尾行卸载）被滤掉')
eq(trackContentBottom(620, 619), 620, '哪怕只降 1px 也不采纳')
eq(trackContentBottom(620, 620), 620, '持平保持原值')

// 无挂载行 / 越界瞬间态：不参与比较，保留上次
eq(trackContentBottom(620, 0), 620, '0 视为无测量，保留上次')
eq(trackContentBottom(0, 0), 0, '从未测到过时保持 0')
eq(trackContentBottom(620, Number.NaN), 620, 'NaN 视为无测量，保留上次')
eq(trackContentBottom(620, -5), 620, '负值视为无测量，保留上次')

// 核心契约：尾行反复挂载/卸载（实测值一帧降一帧升），下界把它压成单调序列 ——
// 跟随目标不再每帧反转，写出的 scrollTop 也就不再来回。
let floor = 0
let reversals = 0
const targetAt: number[] = []
for (let frame = 0; frame < 20; frame += 1) {
  const measured = frame % 2 === 0 ? 400 : 900
  const next = trackContentBottom(floor, measured)
  if (next < floor) reversals += 1
  floor = next
  targetAt.push(next)
}
eq(reversals, 0, '20 帧往复之后，下界从未反向')
eq(targetAt[0], 400, '首帧采纳 400')
eq(targetAt[19], 900, '末帧停在 900')
eq(new Set(targetAt).size, 2, '20 帧只出现 2 个不同目标值（400 → 900），不是逐帧翻转')

console.log(`collapse gate checks passed: ${checks}`)
