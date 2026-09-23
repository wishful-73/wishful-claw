/*
 * 流式段的落位规则（iter-35 S-142 重开）。
 *
 * 存在理由：一条 assistant 消息跨多轮 iteration，`segments` 是它在气泡里的时序骨架。
 * 段的身份必须按 (iteration, type) 定位，不能按到达顺序 push —— 上游把思考与正文当
 * 两条独立通道发，分片交错到达（思考 1_1 / 正文 2_1 / 思考 1_2 …）。按到达顺序建段会
 * 把一段思考或正文劈开；伤害不止「多一条空思考」—— 劈开后末段变成 thinking，
 * `splitProcessAndFinal` 从末尾倒扫第一项就停，正文会被整段折进「执行过程」折叠收起。
 *
 * 锁住五条：
 *   1. 交错到达归并成「一段思考 + 一段正文」，且思考段在正文段之前；
 *   2. 正文先到时，后到的思考段插到正文段之前（不追加到末尾）；
 *   3. tool_use 按到达顺序排在正文之后，后到的正文/思考仍并回各自的槽；
 *   4. 跨 iteration 不合并，轮序不乱；
 *   5. 正文开始给本轮思考段打 completedAt，思考续写撤回；且只认本 iteration。
 */

import assert from 'node:assert/strict'
import type { ContentSegment } from '../../src/renderer/src/stores/chat-store/types'
import {
  applyStreamDelta,
  closeThinkingSegmentOfIteration,
  insertSegment
} from '../../src/renderer/src/stores/chat-store/stream-segments'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

const NOW = 1_700_000_000_000

type Delta = { kind: 'text' | 'thinking'; value: string }

const text = (value: string): Delta => ({ kind: 'text', value })
const think = (value: string): Delta => ({ kind: 'thinking', value })

function apply(segments: ContentSegment[], iteration: number, deltas: Delta[]): ContentSegment[] {
  for (const delta of deltas) applyStreamDelta(segments, iteration, delta, NOW)
  return segments
}

const shape = (segments: ContentSegment[]): string =>
  segments.map((s) => `${s.type}@${s.iteration}`).join(',')

// ── 1. 交错到达：归并成一段思考 + 一段正文，思考在前 ─────────────────────────
{
  const segments = apply([], 1, [
    think('1_1'),
    text('2_1'),
    text('2_2'),
    think('1_2'),
    text('2_3'),
    think('1_3')
  ])

  check(segments.length === 2, `交错分片归并成两段（实得 ${segments.length}）`)
  check(shape(segments) === 'thinking@1,text@1', `段序是「思考 → 正文」（实得 ${shape(segments)}）`)
  check(segments[0].thinking === '1_11_21_3', '思考分片按到达顺序拼进同一槽')
  check(segments[1].text === '2_12_22_3', '正文分片按到达顺序拼进同一槽')
}

// ── 2. 正文先到：思考段前插，不追加到末尾 ────────────────────────────────────
{
  const segments = apply([], 1, [text('2_1'), think('1_1')])

  check(shape(segments) === 'thinking@1,text@1', `正文先到时思考仍排在前面（实得 ${shape(segments)}）`)
  check(segments[1].text === '2_1', '正文内容不被挪动')
}

// ── 3. tool_use 落位：按到达序排在正文后；后到的正文/思考仍并回各自的槽 ──────
{
  const segments = apply([], 1, [think('想'), text('正文1')])
  insertSegment(segments, { type: 'tool_use', iteration: 1, toolCallId: 'a' })
  insertSegment(segments, { type: 'tool_use', iteration: 1, toolCallId: 'b' })
  apply(segments, 1, [text('正文2'), think('续想')])

  check(segments.length === 4, `两卡两段共四段（实得 ${segments.length}）`)
  check(
    shape(segments) === 'thinking@1,text@1,tool_use@1,tool_use@1',
    `段序 thinking → text → tool_use（实得 ${shape(segments)}）`
  )
  check(segments[2].toolCallId === 'a' && segments[3].toolCallId === 'b', '并行工具卡保持到达顺序')
  check(segments[1].text === '正文1正文2', '正文没被工具卡劈开')
  check(segments[0].thinking === '想续想', '思考没被工具卡劈开')
}

// ── 4. 跨 iteration：不合并，轮序不乱 ───────────────────────────────────────
{
  const segments = apply([], 1, [think('r1思'), text('r1文')])
  apply(segments, 2, [think('r2思'), text('r2文')])
  apply(segments, 1, [think('r1续')])

  check(segments.length === 4, `两轮各两段（实得 ${segments.length}）`)
  check(
    shape(segments) === 'thinking@1,text@1,thinking@2,text@2',
    `轮序 1 → 2 不变（实得 ${shape(segments)}）`
  )
  check(segments[0].thinking === 'r1思r1续', '回到第 1 轮时并回它自己的槽')
  check(segments[2].thinking === 'r2思', '第 2 轮不受影响')
}

// ── 5. completedAt：正文开始即完结、思考续写撤回、只认本 iteration ──────────
{
  const segments = apply([], 1, [think('想'), text('文')])
  check(typeof segments[0].completedAt === 'number', '正文开始 ⇒ 本轮思考段打上 completedAt')

  apply(segments, 1, [think('续想')])
  check(segments[0].completedAt === undefined, '思考续写 ⇒ 撤回 completedAt')

  const twoRounds: ContentSegment[] = [
    { type: 'thinking', iteration: 1, thinking: 'r1', completedAt: 7 },
    { type: 'thinking', iteration: 2, thinking: 'r2' }
  ]
  closeThinkingSegmentOfIteration(twoRounds, 2, 1234)
  check(twoRounds[0].completedAt === 7, '已盖章的段不会被改写')
  check(twoRounds[1].completedAt === 1234, '只给本 iteration 的思考段盖章')

  const noThinking: ContentSegment[] = [{ type: 'text', iteration: 1, text: 'x' }]
  closeThinkingSegmentOfIteration(noThinking, 1, 99)
  check(noThinking[0].completedAt === undefined, '没有思考段时不误伤正文段')
}

console.log(`stream segments checks passed: ${checks}`)
