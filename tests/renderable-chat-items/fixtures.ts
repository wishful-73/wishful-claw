// renderable-chat-items 套件的 fixture 辅助与延迟加载的渲染入口。
// 拆分自 program.ts（S-252，2026-10-28），函数体逐字平移。

import assert from 'node:assert/strict'
import type { RenderableChatItem } from '../../src/renderer/src/components/chat/renderable-chat-items'
import type {
  CompactBoundaryMeta,
  CompactSummaryMeta,
  ContentBlock,
  UnifiedMessage
} from '../../src/renderer/src/lib/api/types'

export let buildRenderableChatItems: typeof import('../../src/renderer/src/components/chat/renderable-chat-items').buildRenderableChatItems

// ES module 的导入绑定不可赋值，所以动态加载后在这里落地。
export async function loadBuildRenderableChatItems(): Promise<void> {
  ;({ buildRenderableChatItems } = await import('../../src/renderer/src/components/chat/renderable-chat-items'))
}
export function message(
  id: string,
  role: UnifiedMessage['role'],
  content: UnifiedMessage['content'],
  createdAt: number,
  meta?: UnifiedMessage['meta']
): UnifiedMessage {
  return { id, role, content, createdAt, ...(meta ? { meta } : {}) }
}

export function boundary(
  id: string,
  createdAt: number,
  options: Partial<CompactBoundaryMeta> = {}
): UnifiedMessage {
  return message(id, 'system', '', createdAt, {
    compactBoundary: {
      trigger: options.trigger ?? 'auto',
      preTokens: options.preTokens ?? 1200,
      messagesSummarized: options.messagesSummarized ?? 3,
      ...(options.preservedSegment ? { preservedSegment: options.preservedSegment } : {}),
      ...(options.cutAt != null ? { cutAt: options.cutAt } : {})
    }
  })
}

export function summary(
  id: string,
  createdAt: number,
  options: Partial<CompactSummaryMeta> = {}
): UnifiedMessage {
  return message(id, 'user', 'compressed summary', createdAt, {
    compactSummary: {
      messagesSummarized: options.messagesSummarized ?? 3,
      recentMessagesPreserved: options.recentMessagesPreserved ?? true,
      ...(options.operationId ? { operationId: options.operationId } : {}),
      ...(options.displayAnchor ? { displayAnchor: options.displayAnchor } : {}),
      ...(options.cutAt != null ? { cutAt: options.cutAt } : {})
    }
  })
}

export function itemIds(items: RenderableChatItem[]): string[] {
  return items.map((item) => item.kind === 'message' ? item.displayId : item.id)
}

export function itemKinds(items: RenderableChatItem[]): string[] {
  return items.map((item) => item.kind)
}

export function text(value: string): ContentBlock {
  return { type: 'text', text: value }
}

export function toolUse(id: string): ContentBlock {
  return { type: 'tool_use', id, name: 'Read', input: {} }
}

export function toolResult(id: string): ContentBlock {
  return { type: 'tool_result', toolUseId: id, content: 'output', isError: false }
}

export function assertCompressionOperation(items: RenderableChatItem[], operationId: string): void {
  const item = items.find((candidate) => candidate.kind === 'context-compression')
  assert.ok(item && item.kind === 'context-compression')
  assert.equal(item.operationId, operationId)
  assert.equal(item.id, `${item.summary.id}:context-compression:${operationId}`)
}
