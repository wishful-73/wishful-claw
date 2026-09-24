// T-15 (iter-29) — live-render catch-up contract.
//
// The pool used to mix a fixed typewriter rate with three stepped catch-up ratios. Both
// halves were the problem: the fixed rate made the lag scale with the amount of text
// (long reasoning kept rendering long after the backend moved on), and the stepped
// ratios switched the per-frame step hard at pool-size boundaries (visible stutter).
//
// These checks pin the replacement properties: continuous, monotonic, no rate cap, and
// a backlog that drains in a bounded number of frames.

import assert from 'node:assert/strict'
import {
  getCatchupStep,
  RENDER_POOL_CONFIG,
  resolveFrameIntervalMs
} from '../../src/renderer/src/hooks/use-typewriter'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

for (const [style, config] of Object.entries(RENDER_POOL_CONFIG)) {
  check(config.catchupFrames >= 1, `${style}: catchupFrames is at least 1`)
  check(config.frameIntervalMs > 0, `${style}: frame interval is positive`)

  // ── Empty pool: nothing to flush ───────────────────────────────────────
  eq(getCatchupStep(0, config), 0, `${style}: empty pool flushes nothing`)
  eq(getCatchupStep(1, config), 1, `${style}: a single pending char flushes at once`)

  // ── Never over-draw ────────────────────────────────────────────────────
  for (const pool of [2, 5, 17, 120, 720, 2400, 10_000, 100_000]) {
    check(
      getCatchupStep(pool, config) <= pool,
      `${style}: step never exceeds the backlog (pool=${pool})`
    )
    check(getCatchupStep(pool, config) >= 1, `${style}: progress every frame (pool=${pool})`)
  }

  // ── Continuous and monotonic: no stepped ratios ────────────────────────
  // ceil(pool / K) may only ever gain one character as the pool grows by one.
  let previous = getCatchupStep(1, config)
  for (let pool = 2; pool <= 5_000; pool += 1) {
    const step = getCatchupStep(pool, config)
    check(step >= previous, `${style}: step is monotonic (pool=${pool})`)
    check(step - previous <= 1, `${style}: step has no jump (pool=${pool})`)
    previous = step
  }

  // ── No fixed-rate floor, no step cap ───────────────────────────────────
  // The old implementation capped small pools at the typewriter rate (~8 chars/frame at
  // 220 chars/s) and large ones at maxStepChars (3600). Both must be gone.
  eq(
    getCatchupStep(1_000, config),
    Math.ceil(1_000 / config.catchupFrames),
    `${style}: a 1k backlog is drained proportionally, not rate-capped`
  )
  eq(
    getCatchupStep(1_000_000, config),
    Math.ceil(1_000_000 / config.catchupFrames),
    `${style}: a huge backlog is drained proportionally, not step-capped`
  )

  // ── Bounded drain: a 10k burst finishes in well under a second of frames ──
  let pool = 10_000
  let frames = 0
  while (pool > 0 && frames < 1_000) {
    pool -= getCatchupStep(pool, config)
    frames += 1
  }
  eq(pool, 0, `${style}: the backlog fully drains`)
  check(
    frames * config.frameIntervalMs <= 1_000,
    `${style}: 10k chars drain within a second (took ${frames} frames)`
  )
}

// ── The two styles still differ (agile is the punchier one) ──────────────
check(
  getCatchupStep(2_000, RENDER_POOL_CONFIG.elegant) < getCatchupStep(2_000, RENDER_POOL_CONFIG.agile),
  'elegant drains a backlog more gently than agile'
)

// ── S-149: the frame interval stretches under pool pressure ──────────────
// 池子小 ⇒ 与原来一字不差；池子大 ⇒ 放慢催帧，把主线程让给点击 / 滚动 / 停止。
// 「整页假死、停止几分钟才生效」就是固定 32ms 催帧 + 单帧渲染越来越贵撞出来的。
for (const [style, config] of Object.entries(RENDER_POOL_CONFIG)) {
  check(config.pressurePoolSize > 0, `${style}: pressure threshold is positive`)
  check(
    config.maxFrameIntervalMs >= config.frameIntervalMs,
    `${style}: the cap is not below the base interval`
  )
  check(
    config.maxFrameIntervalMs <= config.frameIntervalMs * 3,
    `${style}: the stretch stays bounded — still tracking, just calmer`
  )

  // 小池子 / 池子空：基准间隔，与 S-149 之前的行为一致
  for (const pool of [0, 1, 100, config.pressurePoolSize]) {
    eq(
      resolveFrameIntervalMs(pool, config),
      config.frameIntervalMs,
      `${style}: a small pool keeps the base interval (pool=${pool})`
    )
  }

  // 单调不减：池子变大，间隔只可能变长，绝不来回抖
  let previousInterval = resolveFrameIntervalMs(0, config)
  for (let pool = 0; pool <= config.pressurePoolSize * 4 + 500; pool += 25) {
    const interval = resolveFrameIntervalMs(pool, config)
    check(interval >= previousInterval, `${style}: interval is monotonic (pool=${pool})`)
    previousInterval = interval
  }

  // 4 倍压力拉满，之后不再增长 —— 有上界才不会变成「不跟了」
  eq(
    resolveFrameIntervalMs(config.pressurePoolSize * 4, config),
    config.maxFrameIntervalMs,
    `${style}: pressure fully absorbs at 4x the threshold`
  )
  eq(
    resolveFrameIntervalMs(1_000_000, config),
    config.maxFrameIntervalMs,
    `${style}: a huge pool stays at the cap`
  )

  // 中间档必须落在两端之间（线性，不是跳变）
  const mid = resolveFrameIntervalMs(config.pressurePoolSize * 2, config)
  check(mid > config.frameIntervalMs, `${style}: mid pressure is already slower`)
  check(mid < config.maxFrameIntervalMs, `${style}: mid pressure is not yet saturated`)

  // 步长公式不受 S-149 影响 —— 只放宽帧频，不动排空比例（iter-29 T-15 的结论保持）
  for (const pool of [10, 2_500, 100_000]) {
    eq(
      getCatchupStep(pool, config),
      Math.ceil(pool / config.catchupFrames),
      `${style}: the catch-up step is untouched by the interval stretch (pool=${pool})`
    )
  }
}

console.log(`render pool catch-up checks passed: ${checks}`)
