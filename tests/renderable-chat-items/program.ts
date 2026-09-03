import assert from 'node:assert/strict'
import type { RenderableChatItem } from '../../src/renderer/src/components/chat/renderable-chat-items'
import type {
  CompactBoundaryMeta,
  CompactSummaryMeta,
  ContentBlock,
  UnifiedMessage
} from '../../src/renderer/src/lib/api/types'

let buildRenderableChatItems: typeof import('../../src/renderer/src/components/chat/renderable-chat-items').buildRenderableChatItems

function message(
  id: string,
  role: UnifiedMessage['role'],
  content: UnifiedMessage['content'],
  createdAt: number,
  meta?: UnifiedMessage['meta']
): UnifiedMessage {
  return { id, role, content, createdAt, ...(meta ? { meta } : {}) }
}

function boundary(
  id: string,
  createdAt: number,
  options: Partial<CompactBoundaryMeta> = {}
): UnifiedMessage {
  return message(id, 'system', '', createdAt, {
    compactBoundary: {
      trigger: options.trigger ?? 'auto',
      preTokens: options.preTokens ?? 1200,
      messagesSummarized: options.messagesSummarized ?? 3,
      ...(options.preservedSegment ? { preservedSegment: options.preservedSegment } : {})
    }
  })
}

function summary(
  id: string,
  createdAt: number,
  options: Partial<CompactSummaryMeta> = {}
): UnifiedMessage {
  return message(id, 'user', 'compressed summary', createdAt, {
    compactSummary: {
      messagesSummarized: options.messagesSummarized ?? 3,
      recentMessagesPreserved: options.recentMessagesPreserved ?? true,
      ...(options.operationId ? { operationId: options.operationId } : {}),
      ...(options.displayAnchor ? { displayAnchor: options.displayAnchor } : {})
    }
  })
}

function itemIds(items: RenderableChatItem[]): string[] {
  return items.map((item) => item.kind === 'message' ? item.displayId : item.id)
}

function itemKinds(items: RenderableChatItem[]): string[] {
  return items.map((item) => item.kind)
}

function text(value: string): ContentBlock {
  return { type: 'text', text: value }
}

function assertCompressionOperation(items: RenderableChatItem[], operationId: string): void {
  const item = items.find((candidate) => candidate.kind === 'context-compression')
  assert.ok(item && item.kind === 'context-compression')
  assert.equal(item.operationId, operationId)
  assert.equal(item.id, `${item.summary.id}:context-compression:${operationId}`)
}

function testNoArtifacts(): void {
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

function testArrayMiddleSplit(): void {
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

function testArrayEdgeSplits(): void {
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

function testStringSingleBlockSemantics(): void {
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

function testBetweenMessagesAndTail(): void {
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

function testLegacyStatusFiltering(): void {
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

function testMultipleArtifactsAndReloadStability(): void {
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

function testNoLiveState(): void {
  const messages = [
    message('u1', 'user', 'hello', 1),
    message('a1', 'assistant', 'world', 2)
  ]
  const items = buildRenderableChatItems(messages, undefined, undefined)
  assert.equal(items.length, 2)
  assert.ok(items.every((item) => item.kind === 'message'))
}

function testLiveStateWithDraft(): void {
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

function testLiveStateAppendedAfterArtifact(): void {
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

function testLiveStateInlinesAfterAssistant(): void {
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

const tests: Array<[string, () => void]> = [
  ['no artifacts', testNoArtifacts],
  ['array middle split', testArrayMiddleSplit],
  ['array edge splits', testArrayEdgeSplits],
  ['string single-block semantics', testStringSingleBlockSemantics],
  ['between messages and transcript tail', testBetweenMessagesAndTail],
  ['legacy compression status filtering', testLegacyStatusFiltering],
  ['multiple artifacts and reload stability', testMultipleArtifactsAndReloadStability],
  ['no live state renders no live item', testNoLiveState],
  ['live state with draft produces live item', testLiveStateWithDraft],
  ['live state appends after artifact pair', testLiveStateInlinesAfterAssistant]
]

async function main(): Promise<void> {
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async () => undefined,
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined
      }
    }
  }
  ;({ buildRenderableChatItems } = await import(
    '../../src/renderer/src/components/chat/renderable-chat-items'
  ))

  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }

  console.log(`Renderable chat item tests passed: ${tests.length}`)
}

void main()
