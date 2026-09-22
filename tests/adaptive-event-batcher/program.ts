/*
 * AdaptiveEventBatcher（iter-34 S-135）。
 *
 * 存在理由：模型和工具都快的时侯，逐条 delta 直推渲染层会把主线程压死，
 * 表现出来就是「整页像截图一样静止」。这里锁住三条不能破的规矩：
 *
 *   1. 可加事件在一个窗口内合并成一条 —— 降频真的生效；
 *   2. 控制类事件立即直通，且不越过已经攒着的 delta —— 降频不许改事件顺序；
 *   3. 缓冲体积超上限就立刻 flush，不等定时器 —— 防一次性推太大的一坨。
 */

import assert from 'node:assert/strict'
import type { AgentStreamEnvelope, AgentStreamEvent } from '../../src/shared/agent-stream-protocol'
import { AdaptiveEventBatcher } from '../../src/main/ipc/batcher/adaptive-event-batcher'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

const text = (value: string): AgentStreamEvent => ({ type: 'text_delta', text: value })
const thinking = (value: string): AgentStreamEvent => ({ type: 'thinking_delta', thinking: value })
const toolArgs = (toolCallId: string, partialInput: Record<string, unknown>): AgentStreamEvent => ({
  type: 'tool_use_args_delta',
  toolCallId,
  partialInput
})
const loopEnd = (): AgentStreamEvent => ({ type: 'loop_end', reason: 'completed' })

/** flushMs 调到足够大，让定时器不会在同步断言期间插进来。 */
function makeBatcher(overrides: { flushMs?: number; maxBufferSize?: number } = {}): {
  batcher: AdaptiveEventBatcher
  envelopes: AgentStreamEnvelope[]
} {
  const batcher = new AdaptiveEventBatcher({ flushMs: 1_000, ...overrides })
  const envelopes: AgentStreamEnvelope[] = []
  batcher.setHandler((envelope) => envelopes.push(envelope))
  return { batcher, envelopes }
}

// ── 1. 同一 run 的多个 delta 在窗口内合并成一条 ──────────────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', text('你'))
  batcher.push('run-1', 'sess-1', text('好'))
  batcher.push('run-1', 'sess-1', text('啊'))
  check(envelopes.length === 0, 'deltas stay buffered until the frame timer fires')

  batcher.flushRun('run-1')
  check(envelopes.length === 1, 'three deltas collapse into a single envelope')
  check(envelopes[0].events.length === 1, 'which carries a single event')
  const merged = envelopes[0].events[0]
  check(
    merged.type === 'text_delta' && merged.text === '你好啊',
    'text is concatenated in arrival order'
  )

  batcher.stop()
}

// ── 正文与思考分开累加，不会串到一条里去 ────────────────────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', thinking('想'))
  batcher.push('run-1', 'sess-1', text('说'))
  batcher.push('run-1', 'sess-1', thinking('完'))
  batcher.flushRun('run-1')

  const events = envelopes[0].events
  check(events.length === 2, 'text and thinking stay in separate events')
  check(
    events[0].type === 'text_delta' && events[1].type === 'thinking_delta',
    'flush order is text first, then thinking'
  )

  batcher.stop()
}

// ── 同一工具的多次快照只留最后一次（partialInput 是累计快照，不是片段） ──────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', toolArgs('tool-1', { a: 1 }))
  batcher.push('run-1', 'sess-1', toolArgs('tool-1', { a: 1, b: 2 }))
  batcher.flushRun('run-1')

  check(envelopes[0].events.length === 1, 'repeated snapshots for one tool call collapse to one')
  const event = envelopes[0].events[0]
  check(
    event.type === 'tool_use_args_delta' && event.partialInput.b === 2,
    'the latest snapshot wins'
  )

  batcher.stop()
}

// ── 2. 控制类事件：先把攒着的推出去，再直通（保序） ─────────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', text('正文'))
  batcher.push('run-1', 'sess-1', loopEnd())

  check(envelopes.length === 2, 'the control event flushes pending deltas, then passes through')
  check(envelopes[0].events[0].type === 'text_delta', 'the buffered text goes out first')
  check(envelopes[1].events[0].type === 'loop_end', 'the control event follows — order preserved')
  check(envelopes[0].seq + 1 === envelopes[1].seq, 'sequence numbers stay contiguous')

  batcher.stop()
}

// ── 没有待推内容时，控制类事件照样立即出去（不等一帧） ──────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', { type: 'tool_call_start', toolCall: { id: 't1' } } as AgentStreamEvent)
  check(envelopes.length === 1, 'a control event never waits for the frame timer')

  batcher.stop()
}

// ── 3. 缓冲超上限立即 flush，不等定时器 ─────────────────────────────────────
{
  const { batcher, envelopes } = makeBatcher({ maxBufferSize: 10 })

  batcher.push('run-1', 'sess-1', text('123456789'))
  check(envelopes.length === 0, 'below the cap nothing is flushed early')

  batcher.push('run-1', 'sess-1', text('0123456789'))
  check(envelopes.length === 1, 'crossing maxBufferSize flushes immediately')
  check(
    envelopes[0].events[0].type === 'text_delta' &&
      envelopes[0].events[0].text === '1234567890123456789',
    'and the whole buffer goes out in one piece'
  )

  batcher.stop()
}

// ── run 之间互不干扰，各自维护自己的序号 ────────────────────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-a', 'sess-1', text('A'))
  batcher.push('run-b', 'sess-2', text('B'))
  batcher.flushAll()

  check(envelopes.length === 2, 'each run flushes its own envelope')
  const a = envelopes.find((e) => e.runId === 'run-a')
  const b = envelopes.find((e) => e.runId === 'run-b')
  check(a?.sessionId === 'sess-1' && a?.events[0].type === 'text_delta', 'run-a keeps its session')
  check(b?.sessionId === 'sess-2' && b?.events[0].type === 'text_delta', 'run-b keeps its session')
  check(a?.seq === 0 && b?.seq === 0, 'each run numbers its envelopes independently')

  batcher.stop()
}

// ── loop_end 之后这个 run 的缓冲被清掉，不会漏给下一个 run ──────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', loopEnd())
  batcher.flushRun('run-1')
  check(envelopes.length === 1, 'a run cleaned up by loop_end has nothing left to flush')

  batcher.stop()
}

// ── stop() 是收尾兜底：还没到点的事件也要推出去 ─────────────────────────────
{
  const { batcher, envelopes } = makeBatcher()

  batcher.push('run-1', 'sess-1', text('滞留'))
  batcher.stop()
  check(envelopes.length === 1, 'stop() flushes whatever is still buffered')

  batcher.stop()
  check(envelopes.length === 1, 'and a second stop() is harmless')
}

// ── 窗口到点后自动 flush，不需要人工调用 ────────────────────────────────────
async function verifyTimerFlush(): Promise<void> {
  const batcher = new AdaptiveEventBatcher({ flushMs: 10 })
  const envelopes: AgentStreamEnvelope[] = []
  batcher.setHandler((envelope) => envelopes.push(envelope))

  batcher.push('run-1', 'sess-1', text('hi'))
  check(envelopes.length === 0, 'nothing is pushed before the frame elapses')

  await new Promise<void>((resolve) => setTimeout(resolve, 60))
  check(envelopes.length === 1, 'the frame timer flushes on its own')
  check(envelopes[0].events[0].type === 'text_delta', 'with the buffered delta')

  batcher.stop()
}

void verifyTimerFlush().then(() => {
  console.log(`adaptive event batcher checks passed: ${checks}`)
})
