// S-210 回归：结束原因落库后的展示映射 + 过程/正文切分。
//
// 两件事都是纯函数，直接钉行为：
//   1. resolveRunEndLabel —— 数据（reason / errorType / statusCode）→ 文案键；
//   2. splitProcessAndFinal —— 只做切分；切完没正文就交给结束原因文案，不回填。

import assert from 'node:assert/strict'
import type { TFunction } from 'i18next'
import type { ContentBlock, MessageRunEndMeta } from '../../src/renderer/src/lib/api/types'
import type { AssistantRenderItem } from '../../src/renderer/src/components/chat/AssistantMessage/types'
import type { ToolExecutionOutline } from '../../src/renderer/src/components/chat/execution-outline'
import { resolveFragmentRunEnd, resolveRunEndLabel } from '../../src/renderer/src/lib/agent/run-end-label'
import {
  buildProcessSummary,
  splitProcessAndFinal
} from '../../src/renderer/src/components/chat/AssistantMessage/process-summary'

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

// ── 1.5 压缩劈开的前半截不读整条消息的收尾 ──
//
// 压缩分片共用同一份 meta.runEnd（它记的是整条消息怎么收尾的），只有末段能读。
// 前半截那轮并没结束 —— 读它就是错报：中断那轮两段都会说「你中止了这一轮」。

const cancelled: MessageRunEndMeta = { reason: 'user_cancelled', at: 1_700_000_000_000 }

assert.equal(
  resolveFragmentRunEnd(cancelled, 'before'),
  null,
  '前半截（压缩卡片之前）不许读收尾 —— 它没结束'
)
assert.equal(resolveFragmentRunEnd(cancelled, 'after'), cancelled, '末段照旧读真实收尾')
assert.equal(
  resolveFragmentRunEnd(cancelled, undefined),
  cancelled,
  '没被压缩劈开的消息不受影响'
)
assert.equal(resolveFragmentRunEnd(undefined, 'before'), null, '前半截 + 无数据同样是 null')
assert.equal(resolveFragmentRunEnd(null, 'after'), null, '无数据不编')

// ── 2. 过程 / 正文切分 ──
//
// 纯切分，不回填（iter-40 S-210 验证期裁定）：切完 finalItems 为空 = 这一轮没说完，
// 据实显示结束原因即可，不能把过程里的文字提出来假装成正文。

const blocks = (types: string[]): ContentBlock[] =>
  types.map((type, index) => {
    if (type === 'text') return { type: 'text', text: `t${index}` } as ContentBlock
    if (type === 'thinking') return { type: 'thinking', thinking: `k${index}` } as ContentBlock
    return { type: 'tool_use', id: `tool${index}`, name: 'Read', input: {} } as ContentBlock
  })

const items = (types: string[]): AssistantRenderItem[] => types.map((_, index) => ({ kind: 'block', index }))

const split = (types: string[]) => splitProcessAndFinal(items(types), blocks(types))

// 以文字收尾（正常收尾）：文字在正文里
{
  const { processItems, finalItems, hasProcessContent } = split(['text', 'tool_use', 'text'])
  assert.equal(hasProcessContent, true)
  assert.deepEqual(processItems.map((i) => i.kind === 'block' && i.index), [0, 1])
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [2])
}

// 以工具收尾：正文为空，整轮全进折叠块 —— 尾部由结束原因文案交代
{
  const { processItems, finalItems, hasProcessContent } = split(['text', 'tool_use', 'tool_use'])
  assert.equal(hasProcessContent, true)
  assert.deepEqual(finalItems, [], '不回填：过程里的文字不许冒充正文')
  assert.deepEqual(
    processItems.map((i) => i.kind === 'block' && i.index),
    [0, 1, 2]
  )
}

// 以思考收尾：同上
{
  const { finalItems } = split(['text', 'tool_use', 'text', 'thinking'])
  assert.deepEqual(finalItems, [])
}

// 纯工具轮：一个字都没说，正文为空
{
  const { finalItems, hasProcessContent } = split(['tool_use', 'tool_use'])
  assert.deepEqual(finalItems, [])
  assert.equal(hasProcessContent, true)
}

// 只有思考：没有工具就不折叠
{
  const { finalItems, hasProcessContent } = split(['thinking', 'thinking'])
  assert.equal(hasProcessContent, false)
  assert.deepEqual(finalItems, [])
}

// 多段文字：只有最后一段连续 text 是正文，前面那几段留在过程里
{
  const { processItems, finalItems } = split(['text', 'tool_use', 'text', 'tool_use', 'text'])
  assert.deepEqual(processItems.map((i) => i.kind === 'block' && i.index), [0, 1, 2, 3])
  assert.deepEqual(finalItems.map((i) => i.kind === 'block' && i.index), [4])
}

// ── 4. 折叠块摘要只统计工具，不掺耗时 ──
//
// 耗时只有一个显示位：消息底部操作栏（S-215 纠偏）。摘要里再拼一份就是重复开位置。

const fakeT = ((_key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? _key)) as unknown as TFunction

const oneCommand = {
  items: [
    {
      toolUseId: 't1',
      name: 'Bash',
      blockIndex: 0,
      input: {},
      status: 'completed',
      summary: '',
      category: 'command',
      visibility: 'visible',
      forceExpanded: false,
      hasError: false,
      isActive: false,
      requiresApproval: false
    }
  ]
} as unknown as ToolExecutionOutline

assert.equal(
  buildProcessSummary(oneCommand, 0, fakeT),
  '运行了1个命令',
  '摘要只统计工具，不掺耗时（耗时归操作栏）'
)
assert.equal(buildProcessSummary(null, 0, fakeT), null, '既无工具也无内容时不编')

console.log('run-end display regression passed')
