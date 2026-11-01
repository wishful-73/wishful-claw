// iter-v3-5 S-247 —— 转换层缓存的签名必须覆盖「原地改、不改长度」的字段。
//
// 背景：`e5a77e40` 为了砍掉每帧 `JSON.stringify` 的分配，把整数组序列化换成了逐条
// 轻量签名。砍的时候只取了 6 个字段，而 `convertOneMessage` 实际读 13 个 ——
// 漏掉的那几个全部是「原地赋值、不碰 updatedAt、也不改长度」的独立事件。
//
// 症状统一是「界面停止更新且不报错」：
//   1. `preToolPhase`     —— 工具执行前正文不变灰；
//   2. `memoryRecall`     —— 记忆回执横幅不出现；
//   3. `toolCalls.status` —— 工具卡片一直停在「运行中」（数组长度不变，只是字段变了）。
//
// 测法：缓存比较的就是签名（`convertChatMessagesToUnified` 里 `cached?.signature === signature`），
// 所以「签名必须变」就是「缓存必须失效」的等价判据。这里不 import `MessageList/utils.ts`，
// 那条链路会把 IPC 拖进 node（`window is not defined`）。
//
// ⚠️ 判据改了必须同步改这个文件，否则下次漏字段照样绿。

import assert from 'node:assert/strict'
import { getMessageSignature } from '../../src/renderer/src/lib/agent/message-conversion-signature'
import { normalizeStructuredBlocks } from '../../src/renderer/src/components/chat/AssistantMessage/think-parser'
import type { ContentBlock } from '../../src/renderer/src/lib/api/types'

/**
 * store 是**原地**改字段、不换对象引用（`msg.preToolPhase = true` 这种），
 * 所以测试也原地改同一个对象 —— 那正是缓存最容易出错的形状。
 */
function makeMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: '正在处理',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

const cases: Array<[string, () => void]> = [
  [
    'preToolPhase 从无到有 ⇒ 签名必须变（否则正文不变灰）',
    () => {
      const msg = makeMessage()
      const before = getMessageSignature(msg)
      msg.preToolPhase = true
      assert.notEqual(getMessageSignature(msg), before, 'preToolPhase 变了但签名没变')
    }
  ],
  [
    'memoryRecall 从无到有 ⇒ 签名必须变（否则回执横幅不出现）',
    () => {
      const msg = makeMessage()
      const before = getMessageSignature(msg)
      msg.memoryRecall = { reason: 'hit', hits: ['a', 'b'] }
      assert.notEqual(getMessageSignature(msg), before, 'memoryRecall 变了但签名没变')
    }
  ],
  [
    'memoryRecall 命中条数变化 ⇒ 签名必须变',
    () => {
      const msg = makeMessage({ memoryRecall: { reason: 'hit', hits: ['a'] } })
      const before = getMessageSignature(msg)
      msg.memoryRecall = { reason: 'hit', hits: ['a', 'b', 'c'] }
      assert.notEqual(getMessageSignature(msg), before, 'hits 变多但签名没变')
    }
  ],
  [
    'toolCalls 状态 running → completed（长度不变）⇒ 签名必须变',
    () => {
      const msg = makeMessage({
        toolCalls: [{ id: 't1', name: 'Read', status: 'running', input: {} }]
      })
      const before = getMessageSignature(msg)

      // 这就是 `tool_call_result` 干的活：只改字段，不 push 新元素。
      const tc = (msg.toolCalls as Array<Record<string, unknown>>)[0]
      tc.status = 'completed'
      tc.output = '文件内容'

      assert.notEqual(
        getMessageSignature(msg),
        before,
        '工具结果回来了但签名没变 —— 卡片会一直停在「运行中」'
      )
    }
  ],
  [
    'toolCalls 只改 output 长度（status 不变）⇒ 签名必须变',
    () => {
      const msg = makeMessage({
        toolCalls: [{ id: 't1', name: 'Read', status: 'completed', output: 'ab' }]
      })
      const before = getMessageSignature(msg)
      ;(msg.toolCalls as Array<Record<string, unknown>>)[0].output = 'abcdef'
      assert.notEqual(getMessageSignature(msg), before, 'output 变长但签名没变')
    }
  ],
  [
    'toolCalls 错误状态（output 不变）⇒ 签名必须变',
    () => {
      const msg = makeMessage({
        toolCalls: [{ id: 't1', name: 'Read', status: 'running' }]
      })
      const before = getMessageSignature(msg)
      const tc = (msg.toolCalls as Array<Record<string, unknown>>)[0]
      tc.status = 'error'
      tc.error = 'boom'
      assert.notEqual(getMessageSignature(msg), before, '错误状态变了但签名没变')
    }
  ],
  [
    '什么都没改 ⇒ 签名必须稳定（否则每帧白重建）',
    () => {
      const msg = makeMessage({
        toolCalls: [{ id: 't1', name: 'Read', status: 'completed', output: 'ok' }],
        preToolPhase: true,
        memoryRecall: { reason: 'hit', hits: ['x'] }
      })
      assert.equal(getMessageSignature(msg), getMessageSignature(msg), '同样的输入产出不同签名')
    }
  ],
  [
    'text 追加 ⇒ 签名必须变（流式主路径）',
    () => {
      const msg = makeMessage({ text: 'ab' })
      const before = getMessageSignature(msg)
      msg.text = 'abcd'
      assert.notEqual(getMessageSignature(msg), before, '正文变长但签名没变')
    }
  ],
  [
    'thinking 追加 ⇒ 签名必须变',
    () => {
      const msg = makeMessage({ thinking: 'a' })
      const before = getMessageSignature(msg)
      msg.thinking = 'abc'
      assert.notEqual(getMessageSignature(msg), before, '思考变长但签名没变')
    }
  ],
  [
    'error 追加 ⇒ 签名必须变',
    () => {
      const msg = makeMessage()
      const before = getMessageSignature(msg)
      msg.error = '网络中断'
      assert.notEqual(getMessageSignature(msg), before, 'error 变了但签名没变')
    }
  ],
  [
    'updatedAt 盖章 ⇒ 签名必须变',
    () => {
      const msg = makeMessage()
      const before = getMessageSignature(msg)
      msg.updatedAt = 1_700_000_001_000
      assert.notEqual(getMessageSignature(msg), before, 'updatedAt 变了但签名没变')
    }
  ],
  [
    'normalizeStructuredBlocks：流式跳过清理后，结束态必须与直接非流式一致',
    () => {
      const raw: ContentBlock[] = [
        { type: 'thinking', thinking: '先想一下' },
        { type: 'text', text: '思考完了\n\n正文在这' }
      ]

      const straight = normalizeStructuredBlocks(raw)
      const streamed = normalizeStructuredBlocks(raw, { streaming: true })
      const settled = normalizeStructuredBlocks(raw, { streaming: false })

      // 流式期间允许不清理（省掉每帧 flatten）……
      assert.ok(streamed.length >= 1)
      // ……但结束态必须和一次到位的清理逐字段相同。
      assert.deepEqual(settled, straight, 'streaming 结束后没有回到与直接调用一致的结果')
    }
  ],
  [
    'normalizeStructuredBlocks：流式态不能丢块',
    () => {
      const raw: ContentBlock[] = [
        { type: 'thinking', thinking: 'x' },
        { type: 'text', text: '正文' },
        { type: 'tool_use', id: 't1', name: 'Read', input: {} }
      ]
      const streamed = normalizeStructuredBlocks(raw, { streaming: true })
      assert.equal(streamed.filter((b) => b.type === 'thinking').length, 1)
      assert.equal(streamed.filter((b) => b.type === 'text').length, 1)
      assert.equal(streamed.filter((b) => b.type === 'tool_use').length, 1)
    }
  ]
]

let passed = 0
const failures: string[] = []
for (const [name, fn] of cases) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`  FAIL ${name}`)
    console.error(`       ${(error as Error).message}`)
  }
}

console.log(`\n== 汇总 ==\n  ${passed}/${cases.length} 通过`)
if (failures.length > 0) {
  console.error(`\n失败项：\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
