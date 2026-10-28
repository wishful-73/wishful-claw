// 压缩切分相关用例（artifact 切段、时间戳链、边界与遗留状态过滤）。
// 拆分自 program.ts（S-252，2026-10-28），函数体逐字平移。

import assert from 'node:assert/strict'
import { message, boundary, summary, itemIds, itemKinds, text, assertCompressionOperation, buildRenderableChatItems } from './fixtures'
import type {
  UnifiedMessage
} from '../../src/renderer/src/lib/api/types'

export function testNoArtifacts(): void {
  const messages = [
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2)
  ]
  const snapshot = structuredClone(messages)
  const items = buildRenderableChatItems(messages)

  assert.deepEqual(itemKinds(items), ['message', 'message'])
  assert.deepEqual(itemIds(items), ['u1', 'a1'])
  assert.deepEqual(messages, snapshot)
}

export function testArrayMiddleSplit(): void {
  const assistant = message('a1', 'assistant', [text('before'), text('after')], 2)
  const items = buildRenderableChatItems([
    message('u1', 'user', 'hello', 1),
    assistant,
    boundary('b1', 3),
    summary('s1', 4, {
      operationId: 'op-middle',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
    })
  ])

  assert.deepEqual(itemKinds(items), ['message', 'message', 'context-compression', 'message'])
  assert.deepEqual(itemIds(items), [
    'u1',
    'a1:compression-before:op-middle',
    's1:context-compression:op-middle',
    'a1:compression-after:op-middle'
  ])
  const before = items[1]
  const after = items[3]
  assert.ok(before.kind === 'message' && after.kind === 'message')
  assert.equal(before.originMessageId, 'a1')
  assert.equal(after.originMessageId, 'a1')
  assert.deepEqual(before.message.content, [text('before')])
  assert.deepEqual(after.message.content, [text('after')])
  assertCompressionOperation(items, 'op-middle')
}

export function testFragmentTimestamps(): void {
  // 压缩切出来的每一段都没有自己的时间戳，得由切分点推出来：
  // 首尾相接（每段起点接上一刀的终点），末段再额外带上整轮总耗时。
  const assistant: UnifiedMessage = {
    ...message('a1', 'assistant', [text('before'), text('after')], 1000),
    updatedAt: 9000
  }
  const items = buildRenderableChatItems([
    message('u1', 'user', 'hello', 1),
    assistant,
    boundary('b1', 3000),
    summary('s1', 3000, {
      operationId: 'op-ts',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
    })
  ])

  const before = items[1]
  const after = items[3]
  assert.ok(before.kind === 'message' && after.kind === 'message')

  assert.equal(before.message.createdAt, 1000)
  assert.equal(before.message.updatedAt, 3000)
  assert.equal(after.message.createdAt, 3000)
  assert.equal(after.message.updatedAt, 9000)

  assert.equal(before.fragment?.totalElapsedMs, undefined)
  assert.equal(after.fragment?.totalElapsedMs, 8000)

  // 原消息不被片段覆写污染
  assert.equal(assistant.createdAt, 1000)
  assert.equal(assistant.updatedAt, 9000)

  // 老消息没有 updatedAt：末段回落，既不显示耗时也没有总耗时
  const legacyItems = buildRenderableChatItems([
    message('a2', 'assistant', [text('one'), text('two')], 1000),
    boundary('b2', 3000),
    summary('s2', 3000, {
      operationId: 'op-legacy',
      displayAnchor: { assistantMessageId: 'a2', afterContentBlockCount: 1 }
    })
  ])
  const legacyAfter = legacyItems.find(
    (item) => item.kind === 'message' && item.displayId.includes('compression-after')
  )
  assert.ok(legacyAfter && legacyAfter.kind === 'message')
  assert.equal(legacyAfter.message.updatedAt, undefined)
  assert.equal(legacyAfter.fragment?.totalElapsedMs, undefined)

  // 没有压缩的消息不产生片段，也就不会有总耗时
  const plain = buildRenderableChatItems([message('a3', 'assistant', 'plain', 1)])[0]
  assert.ok(plain.kind === 'message')
  assert.equal(plain.fragment, undefined)
}

export function testRelocatedArtifactCutTime(): void {
  // S-196：工件写进转写时 createdAt 会被 adjustCompactArtifactTimestamps 重定位到
  // 它的「归属位置」（可能早几十天），渲染层不能拿它当段起点 —— 否则段起点被拽回过去，
  // 末段耗时会虚增成整个跨度（线上实测 481h56m）。meta 里的 cutAt 才是真实落刀时刻。
  const messageStart = 1_000_000
  const messageEnd = 1_450_000
  const cutAt = 1_030_000
  const relocated = 1000 // 「归属位置」，比消息起点还早

  const withCutAt = buildRenderableChatItems([
    message('u1', 'user', 'hello', 900_000),
    { ...message('a1', 'assistant', [text('before'), text('after')], messageStart), updatedAt: messageEnd },
    boundary('b1', relocated, { cutAt }),
    summary('s1', relocated, {
      operationId: 'op-relocated',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 },
      cutAt
    })
  ])
  const before = withCutAt[1]
  const after = withCutAt[3]
  assert.ok(before.kind === 'message' && after.kind === 'message')
  assert.equal(before.message.createdAt, messageStart, '首段起点仍是消息创建时间')
  assert.equal(before.message.updatedAt, cutAt, '首段终点是真实落刀时刻')
  assert.equal(after.message.createdAt, cutAt, '末段起点是真实落刀时刻，不是被重定位的 createdAt')
  assert.equal(after.message.updatedAt, messageEnd)
  assert.equal(after.fragment?.totalElapsedMs, messageEnd - messageStart)

  // 老数据没有 cutAt：被污染的切点必须夹进消息自身区间，
  // 宁可想不起分段，也不能报出一个超出本轮跨度的耗时。
  const legacy = buildRenderableChatItems([
    message('u2', 'user', 'hello', 900_000),
    { ...message('a2', 'assistant', [text('before'), text('after')], messageStart), updatedAt: messageEnd },
    boundary('b2', relocated),
    summary('s2', relocated, {
      operationId: 'op-legacy-relocated',
      displayAnchor: { assistantMessageId: 'a2', afterContentBlockCount: 1 }
    })
  ])
  const legacyBefore = legacy[1]
  const legacyAfter = legacy[3]
  assert.ok(legacyBefore.kind === 'message' && legacyAfter.kind === 'message')
  assert.equal(legacyBefore.message.updatedAt, messageStart, '夹到消息起点')
  assert.equal(legacyAfter.message.createdAt, messageStart, '夹到消息起点')
  assert.equal(legacyAfter.message.updatedAt, messageEnd)
  assert.equal(legacyAfter.fragment?.totalElapsedMs, messageEnd - messageStart)

  // 切点落在消息开头（压缩发生在消息之前）时，前面那段被丢弃、只剩一段 ——
  // 此时不该再重复报一个「共 X」（否则显示成 `07:30 · 共 07:30`）。
  const cutAtStart = buildRenderableChatItems([
    { ...message('a4', 'assistant', [text('one'), text('two')], messageStart), updatedAt: messageEnd },
    boundary('b4', relocated, { cutAt: messageStart - 60_000 }),
    summary('s4', relocated, {
      operationId: 'op-at-start',
      displayAnchor: { assistantMessageId: 'a4', afterContentBlockCount: 0 },
      cutAt: messageStart - 60_000
    })
  ])
  const onlySegment = cutAtStart.find(
    (item) => item.kind === 'message' && item.displayId.includes('compression-after')
  )
  assert.ok(onlySegment && onlySegment.kind === 'message')
  assert.equal(onlySegment.fragment?.totalElapsedMs, undefined, '没真切过就不挂「共 X」')
}

export function testArrayEdgeSplits(): void {
  const assistant = message('a1', 'assistant', [text('one'), text('two')], 2)
  const atStart = buildRenderableChatItems([
    assistant,
    boundary('b-start', 3),
    summary('s-start', 4, {
      operationId: 'op-start',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 0 }
    })
  ])
  assert.deepEqual(itemKinds(atStart), ['context-compression', 'message'])
  assert.equal(atStart[1].kind === 'message' ? atStart[1].fragment?.position : null, 'after')

  const atEnd = buildRenderableChatItems([
    assistant,
    boundary('b-end', 5),
    summary('s-end', 6, {
      operationId: 'op-end',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 2 }
    })
  ])
  assert.deepEqual(itemKinds(atEnd), ['message', 'context-compression'])
  assert.equal(atEnd[0].kind === 'message' ? atEnd[0].fragment?.position : null, 'before')
  assert.equal(atEnd[0].kind === 'message' ? atEnd[0].isLastAssistantMessage : null, true)
}

export function testStringSingleBlockSemantics(): void {
  const assistant = message('a1', 'assistant', 'single block', 2)
  const beforeString = buildRenderableChatItems([
    assistant,
    boundary('b-before', 3),
    summary('s-before', 4, {
      operationId: 'op-before-string',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 0 }
    })
  ])
  assert.deepEqual(itemKinds(beforeString), ['context-compression', 'message'])
  assert.equal(
    beforeString[1].kind === 'message' ? beforeString[1].fragment?.position : null,
    'after'
  )

  const afterString = buildRenderableChatItems([
    assistant,
    boundary('b-after', 5),
    summary('s-after', 6, {
      operationId: 'op-after-string',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
    })
  ])
  assert.deepEqual(itemKinds(afterString), ['message', 'context-compression'])
  assert.equal(
    afterString[0].kind === 'message' ? afterString[0].fragment?.position : null,
    'before'
  )
}

export function testBetweenMessagesAndTail(): void {
  const between = buildRenderableChatItems([
    message('u1', 'user', 'one', 1),
    message('a1', 'assistant', 'two', 2),
    boundary('b1', 3, {
      preservedSegment: { headId: 'u2', anchorId: 'u2', tailId: 'a2' }
    }),
    summary('s1', 4, { operationId: 'op-between' }),
    message('u2', 'user', 'three', 5),
    message('a2', 'assistant', 'four', 6)
  ])
  assert.deepEqual(itemIds(between), [
    'u1',
    'a1',
    's1:context-compression:op-between',
    'u2',
    'a2'
  ])

  const tail = buildRenderableChatItems([
    message('u1', 'user', 'one', 1),
    message('a1', 'assistant', 'two', 2),
    boundary('b-tail', 3),
    summary('s-tail', 4, { operationId: 'op-tail' })
  ])
  assert.deepEqual(itemIds(tail), ['u1', 'a1', 's-tail:context-compression:op-tail'])
}

export function testLegacyStatusFiltering(): void {
  const items = buildRenderableChatItems([
    message('u1', 'user', 'hello', 1),
    message('compression-status:legacy-op', 'system', '', 2, {
      compressionStatus: {
        operationId: 'legacy-op',
        state: 'compressed',
        startedAt: 1,
        completedAt: 2
      }
    }),
    message('a1', 'assistant', 'world', 3)
  ])

  assert.deepEqual(itemIds(items), ['u1', 'a1'])
}

export function testMultipleArtifactsAndReloadStability(): void {
  const messages = [
    message('u1', 'user', 'start', 1),
    message('a1', 'assistant', [text('a1')], 2),
    boundary('b1', 3),
    summary('s1', 4, {
      operationId: 'op-1',
      displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
    }),
    message('a2', 'assistant', [text('a2')], 5),
    boundary('b2', 6, { trigger: 'manual' }),
    summary('s2', 7, {
      operationId: 'op-2',
      displayAnchor: { assistantMessageId: 'a2', afterContentBlockCount: 1 }
    })
  ]
  const first = buildRenderableChatItems(messages)
  const second = buildRenderableChatItems(structuredClone(messages))

  assert.deepEqual(itemIds(first), [
    'u1',
    'a1:compression-before:op-1',
    's1:context-compression:op-1',
    'a2:compression-before:op-2',
    's2:context-compression:op-2'
  ])
  assert.deepEqual(itemIds(second), itemIds(first))
  assert.deepEqual(itemKinds(second), itemKinds(first))
  const triggers = first
    .filter((item) => item.kind === 'context-compression')
    .map((item) => item.kind === 'context-compression' ? item.trigger : null)
  assert.deepEqual(triggers, ['auto', 'manual'])
}
