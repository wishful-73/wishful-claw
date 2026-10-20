// S-210 回归：结束原因落库后的展示映射 + 正文回填切分。
//
// 两件事都是纯函数，直接钉行为：
//   1. resolveRunEndLabel —— 数据（reason / errorType / statusCode）→ 文案键；
//   2. splitProcessAndFinal —— 以工具/思考收尾的一轮，尾部正文不能连人带话塞进折叠块。

import assert from 'node:assert/strict'
import type { ContentBlock, MessageRunEndMeta } from '../../src/renderer/src/lib/api/types'
import type { AssistantRenderItem } from '../../src/renderer/src/components/chat/AssistantMessage/types'
import { resolveRunEndLabel } from '../../src/renderer/src/lib/agent/run-end-label'
import { splitProcessAndFinal } from '../../src/renderer/src/components/chat/AssistantMessage/process-summary'

// ── 1. 结束原因 → 文案键 ──

const keyOf = (runEnd: MessageRunEndMeta | null | undefined): string | null =>
  resolveRunEndLabel(runEnd)?.key ?? null

// 正常跑完不显示任何结束语
assert.equal(keyOf({ reason: 'completed' }), null, 'completed 不该有结束语')
assert.equal(keyOf(undefined), null, '缺数据（老消息）不该编原因')
assert.equal(keyOf(null), null)

assert.equal(keyOf({ reason: 'user_cancelled' }), 'assistantMessage.runEnd.userCancelled')
assert.equal(keyOf({ reason: 'aborted' }), 'assistantMessage.runEnd.aborted')
assert.equal(keyOf({ reason: 'max_iterations' }), 'assistantMessage.runEnd.maxIterations')

// error 按成因细分：链路问题 ≠ 服务商说不行，用户要能分辨该找谁
assert.equal(
  keyOf({ reason: 'error', errorType: 'HttpRequestException' }),
  'assistantMessage.runEnd.network'
)
assert.equal(
  keyOf({ reason: 'error', errorType: 'SocketException' }),
  'assistantMessage.runEnd.network'
)
assert.equal(keyOf({ reason: 'error', errorType: 'TimeoutException' }), 'assistantMessage.runEnd.timeout')
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 401 }),
  'assistantMessage.runEnd.auth'
)
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 429 }),
  'assistantMessage.runEnd.rateLimited'
)
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 503 }),
  'assistantMessage.runEnd.providerError'
)
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 400 }),
  'assistantMessage.runEnd.rejected'
)
// 形态比状态码更先判：真抛上来的 HttpRequestException 就是链路断了，哪怕同时带了码
assert.equal(
  keyOf({ reason: 'error', errorType: 'HttpRequestException', statusCode: 500 }),
  'assistantMessage.runEnd.network'
)
// 502 / 504 也是链路问题（provider 把连接失败转成 retryable 502 走的就是这条）
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 502 }),
  'assistantMessage.runEnd.network'
)
assert.equal(
  keyOf({ reason: 'error', errorType: 'ProviderHttpException', statusCode: 504 }),
  'assistantMessage.runEnd.network'
)
// 什么成因都没有也不能装懂
assert.equal(keyOf({ reason: 'error' }), 'assistantMessage.runEnd.error')

// Worker 以后加的新原因：照实报出原值
const unknown = resolveRunEndLabel({ reason: 'quota_exhausted' } as unknown as MessageRunEndMeta)
assert.equal(unknown?.key, 'assistantMessage.runEnd.stopped')
assert.equal(unknown?.params?.reason, 'quota_exhausted')

// 每个键都得有兜底文案，语言包缺键时不能露出裸 key
for (const runEnd of [
  { reason: 'user_cancelled' },
  { reason: 'aborted' },
  { reason: 'max_iterations' },
  { reason: 'error' },
  { reason: 'error', errorType: 'TimeoutException' }
] as MessageRunEndMeta[]) {
  const label = resolveRunEndLabel(runEnd)
  assert.ok(label && label.fallback.length > 0, `${runEnd.reason} 缺 fallback`)
}

// ── 2. 正文回填 ──

const blocks = (types: string[]): ContentBlock[] =>
  types.map((type, index) => {
    if (type === 'text') return { type: 'text', text: `t${index}` } as ContentBlock
    if (type === 'thinking') return { type: 'thinking', thinking: `k${index}` } as ContentBlock
    return { type: 'tool_use', id: `tool${index}`, name: 'Read', input: {} } as ContentBlock
  })

const items = (types: string[]): AssistantRenderItem[] => types.map((_, index) => ({ kind: 'block', index }))

const split = (types: string[]) => splitProcessAndFinal(items(types), blocks(types))

// 以文字收尾（正常收尾）：文字在正文里，不重复
{
  const { processItems, finalItems, hasProcessContent } = split(['text', 'tool_use', 'text'])
  assert.equal(hasProcessContent, true)
  assert.deepEqual(processItems.map((i) => i.kind === 'block' && i.index), [0, 1])
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [2])
}

// 以工具收尾：尾部那段文字必须认回正文（S-210 的 83/83 场景）
{
  const { processItems, finalItems, hasProcessContent } = split(['text', 'tool_use', 'tool_use'])
  assert.equal(hasProcessContent, true)
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [0])
  assert.deepEqual(processItems.map((i) => i.kind === 'block' && i.index), [1, 2])
}

// 以思考收尾：同上
{
  const { finalItems } = split(['text', 'tool_use', 'text', 'thinking'])
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [2])
}

// 纯工具轮：一个字都没说，正文为空（交给结束原因文案）
{
  const { finalItems, hasProcessContent } = split(['tool_use', 'tool_use'])
  assert.deepEqual(finalItems, [])
  assert.equal(hasProcessContent, true)
}

// 只有思考：没有工具就不折叠，也不该回填出正文
{
  const { finalItems, hasProcessContent } = split(['thinking', 'thinking'])
  assert.equal(hasProcessContent, false)
  assert.deepEqual(finalItems, [])
}

// 回填只取尾部连续 text，从中间断开
{
  const { finalItems } = split(['text', 'tool_use', 'text', 'tool_use', 'text'])
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [4])
}

console.log('run-end display regression passed')
