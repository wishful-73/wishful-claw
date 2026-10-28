// live（未完成压缩）状态与草稿相关用例。
// 拆分自 program.ts（S-252，2026-10-28），函数体逐字平移。

import assert from 'node:assert/strict'
import { message, boundary, summary, itemKinds, text, assertCompressionOperation, buildRenderableChatItems } from './fixtures'

export function testNoLiveState(): void {
  const messages = [
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2)
  ]
  const items = buildRenderableChatItems(messages, undefined, undefined)
  assert.equal(items.length, 2)
  assert.ok(items.every((item) => item.kind === 'message'))
}

export function testLiveStateWithDraft(): void {
  const messages = [
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2)
  ]
  const liveState = {
    sessionId: 's1',
    draft: 'compressing summary…',
    attempt: 1,
    maxAttempts: 3,
    startedAt: 3,
    trigger: 'auto' as const
  }
  const items = buildRenderableChatItems(messages, undefined, liveState)

  assert.equal(items.length, 3)
  assert.ok(items[0].kind === 'message' && items[0].displayId === 'u1')
  assert.ok(items[1].kind === 'message' && items[1].displayId === 'a1')
  const live = items[2]
  assert.ok(live.kind === 'live-compression')
  assert.ok('draft' in live && live.draft === 'compressing summary…')
  assert.equal(live.trigger, 'auto')
  assert.equal(live.attempt, 1)
  assert.equal(live.maxAttempts, 3)
}

export function testLiveStateAppendedAfterArtifact(): void {
  const messages = [
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2),
    boundary('b1', 3),
    summary('s1', 4, { operationId: 'op-1' })
  ]
  const liveState = {
    sessionId: 's1',
    draft: 'draft text',
    attempt: 2,
    maxAttempts: 3,
    startedAt: 5,
    trigger: 'manual' as const,
    operationId: 'op-2'
  }
  const items = buildRenderableChatItems(messages, undefined, liveState)

  const kinds = items.map((item) => item.kind)
  assert.ok(kinds.includes('context-compression'))
  assert.ok(kinds.includes('live-compression'))
  const live = items.find((item) => item.kind === 'live-compression')
  assert.ok(live && live.kind === 'live-compression')
  assert.equal(live.draft, 'draft text')
  assert.equal(live.trigger, 'manual')
}

export function testLiveStateInlinesAfterAssistant(): void {
  const assistant = message('a1', 'assistant', [text('before'), text('after')], 2)
  const messages = [
    message('u1', 'user', 'hello', 1),
    assistant
  ]
  const liveState = {
    sessionId: 's1',
    draft: 'summarizing…',
    attempt: 1,
    maxAttempts: 1,
    startedAt: 3,
    trigger: 'auto' as const,
    displayAnchor: { assistantMessageId: 'a1', afterContentBlockCount: 1 }
  }
  const items = buildRenderableChatItems(messages, undefined, liveState)

  assert.ok(items.some((item) => item.kind === 'live-compression'))
  const live = items.find((item) => item.kind === 'live-compression')
  assert.ok(live && live.kind === 'live-compression')
  assert.equal(live.draft, 'summarizing…')
}

export async function testLiveDraftAppendsCoalesce(): Promise<void> {
  const { useLiveCompressionStore } = await import(
    '../../src/renderer/src/stores/live-compression-store'
  )
  const session = 'stream-coalescing'
  const chunks = Array.from({ length: 500 }, (_, index) => `w${index} `)

  let notifications = 0
  const unsubscribe = useLiveCompressionStore.subscribe(() => {
    notifications += 1
  })
  useLiveCompressionStore.getState().start(session, { trigger: 'auto' })
  const afterStart = notifications

  for (const chunk of chunks) useLiveCompressionStore.getState().appendDraft(session, chunk)
  assert.ok(
    notifications - afterStart <= 1,
    `500 draft chunks must coalesce into one notification, got ${notifications - afterStart}`
  )

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(
    useLiveCompressionStore.getState().bySessionId[session]?.draft,
    chunks.join(''),
    'the coalesced flush keeps every chunk in arrival order'
  )
  assert.ok(
    notifications - afterStart <= 3,
    `flushing must not fan out into per-chunk renders, got ${notifications - afterStart}`
  )

  unsubscribe()
  useLiveCompressionStore.getState().clear(session)
}

export function testInvertedTimestampPairStillRenders(): void {
  // Reload order: DB rows ordered by (created_at, sort_order). Existing rows
  // carry summary.createdAt = boundary.createdAt - 1, so the summary sits
  // immediately BEFORE its boundary after reload — the pair must still render.
  const items = buildRenderableChatItems([
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2),
    summary('s-late', 100, { operationId: 'op-inverted', messagesSummarized: 5 }),
    boundary('b-late', 101, { messagesSummarized: 5 }),
    message('u2', 'user', 'next', 200)
  ])

  assert.deepEqual(itemKinds(items), [
    'message',
    'message',
    'context-compression',
    'message'
  ])
  assertCompressionOperation(items, 'op-inverted')
  const divider = items.find((item) => item.kind === 'context-compression')
  assert.ok(divider && divider.kind === 'context-compression')
  assert.equal(divider.summary.id, 's-late')
}
