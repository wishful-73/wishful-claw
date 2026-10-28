// anchor 切分相关用例（工具调用与其结果的配对保持）。
// 拆分自 program.ts（S-252，2026-10-28），函数体逐字平移。

import assert from 'node:assert/strict'
import { message, boundary, summary, itemIds, itemKinds, text, toolUse, toolResult, buildRenderableChatItems } from './fixtures'

export function testAnchorSplitKeepsToolResultPair(): void {
  const blocks = [
    text('thinking-ish'),
    toolUse('t1'),
    toolResult('t1'),
    toolUse('t2'),
    toolResult('t2'),
    text('post-compression tail')
  ]
  const assistant = message('a1', 'assistant', blocks, 2)
  const items = buildRenderableChatItems([
    message('u1', 'user', 'hello', 1),
    assistant,
    boundary('b1', 3),
    summary('s1', 4, {
      operationId: 'op-tool',
      displayAnchor: {
        assistantMessageId: 'a1',
        afterContentBlockCount: blocks.length,
        afterToolUseId: 't2'
      }
    })
  ])

  assert.deepEqual(itemKinds(items), ['message', 'message', 'context-compression', 'message'])
  const before = items[1]
  const after = items[3]
  assert.ok(before.kind === 'message' && after.kind === 'message')
  // The split follows the anchored tool call and its inline result, not the
  // stale block count, so the result never renders detached from its call.
  assert.deepEqual(before.message.content, blocks.slice(0, 5))
  assert.deepEqual(after.message.content, blocks.slice(5))
}

export function testAnchorFallsBackWhenToolUseGone(): void {
  const blocks = [text('one'), text('two'), text('three')]
  const assistant = message('a1', 'assistant', blocks, 2)
  const items = buildRenderableChatItems([
    assistant,
    boundary('b1', 3),
    summary('s1', 4, {
      operationId: 'op-stale',
      displayAnchor: {
        assistantMessageId: 'a1',
        afterContentBlockCount: 2,
        afterToolUseId: 't-removed'
      }
    })
  ])

  const before = items[0]
  assert.ok(before.kind === 'message')
  assert.deepEqual(before.message.content, blocks.slice(0, 2))
}

export function testLiveAnchorInlinesLikeCompletedDivider(): void {
  const assistant = message('a1', 'assistant', [text('before'), text('after')], 2)
  const liveState = {
    sessionId: 's1',
    draft: 'summarizing…',
    attempt: 1,
    maxAttempts: 1,
    startedAt: 3,
    trigger: 'auto' as const,
    displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
  }
  const items = buildRenderableChatItems(
    [message('u1', 'user', 'hello', 1), assistant],
    undefined,
    liveState
  )

  // The live card sits between the split fragments of the anchored assistant
  // message — the exact position the completed divider takes over — so
  // completion swaps it in place instead of relocating it.
  assert.deepEqual(itemKinds(items), ['message', 'message', 'live-compression', 'message'])
  assert.deepEqual(itemIds(items), [
    'u1',
    'a1:compression-before:live',
    's1:live-compression:3',
    'a1:compression-after:live'
  ])
  const before = items[1]
  const live = items[2]
  assert.ok(before.kind === 'message' && before.fragment?.position === 'before')
  assert.ok(live.kind === 'live-compression')
  assert.equal(live.draft, 'summarizing…')
}
