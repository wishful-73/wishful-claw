import type {
  CompactBoundaryMeta,
  UnifiedMessage
} from '@renderer/lib/api/types'
import {
  isCompactArtifactMessage,
  isCompactBoundaryMessage,
  isCompactSummaryLikeMessage,
  isCompactSummaryMessage,
  resolveActiveCompactArtifacts
} from '@renderer/lib/agent/context-compression'
import type { LiveCompressionState } from '@renderer/stores/live-compression-store'

export type MessageFragmentPosition = 'before' | 'after'

export interface RenderableMessageItem {
  kind: 'message'
  message: UnifiedMessage
  displayId: string
  messageId: string
  originMessageId: string
  fragment?: {
    position: MessageFragmentPosition
    operationId: string
  }
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  showContinue: boolean
}

export interface RenderableContextCompressionItem {
  kind: 'context-compression'
  id: string
  messageId: string
  summary: UnifiedMessage
  boundary: CompactBoundaryMeta
  operationId: string
  trigger: 'auto' | 'manual'
  isLastUserMessage: false
  isLastAssistantMessage: false
  showContinue: false
}

export interface RenderableLiveCompressionItem {
  kind: 'live-compression'
  id: string
  messageId: string
  sessionId: string
  operationId?: string
  trigger: 'auto' | 'manual'
  draft: string
  startedAt: number
  attempt: number
  maxAttempts: number
  isLastUserMessage: false
  isLastAssistantMessage: false
  showContinue: false
}

export type RenderableChatItem =
  | RenderableMessageItem
  | RenderableContextCompressionItem
  | RenderableLiveCompressionItem

interface CompactArtifactPair {
  boundary: UnifiedMessage
  summary: UnifiedMessage
  boundaryIndex: number
  summaryIndex: number
}

function findSummaryAfterBoundary(
  messages: readonly UnifiedMessage[],
  boundaryIndex: number
): { message: UnifiedMessage; index: number } | null {
  for (let index = boundaryIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]
    if (isCompactBoundaryMessage(candidate)) return null
    if (isCompactSummaryLikeMessage(candidate)) return { message: candidate, index }
  }
  return null
}

function collectCompactArtifactPairs(messages: readonly UnifiedMessage[]): CompactArtifactPair[] {
  const pairs: CompactArtifactPair[] = []
  const usedSummaryIds = new Set<string>()

  for (let index = 0; index < messages.length; index += 1) {
    const boundary = messages[index]
    if (!isCompactBoundaryMessage(boundary)) continue
    // Canonical pairing: the summary sits after its boundary. Reload orders rows
    // by (created_at, sort_order), so an inverted worker stamp (summary 1ms
    // before its boundary — existing DB rows already do) makes the summary sit
    // immediately BEFORE the boundary instead. Accept that too so the divider
    // survives reload; only a tagged compactSummary matches here, never a legacy
    // plain-text summary.
    const result = findSummaryAfterBoundary(messages, index)
    if (result && !usedSummaryIds.has(result.message.id)) {
      usedSummaryIds.add(result.message.id)
      pairs.push({
        boundary,
        summary: result.message,
        boundaryIndex: index,
        summaryIndex: result.index
      })
      continue
    }
    const previous = index > 0 ? messages[index - 1] : null
    if (
      previous &&
      isCompactSummaryMessage(previous) &&
      !usedSummaryIds.has(previous.id)
    ) {
      usedSummaryIds.add(previous.id)
      pairs.push({
        boundary,
        summary: previous,
        boundaryIndex: index,
        summaryIndex: index - 1
      })
    }
  }

  // Legacy/imported transcripts may contain a summary without its boundary.
  // Keep it renderable only when it carries its own display anchor.
  for (let index = 0; index < messages.length; index += 1) {
    const summary = messages[index]
    if (!isCompactSummaryLikeMessage(summary) || usedSummaryIds.has(summary.id)) continue
    if (!summary.meta?.compactSummary?.displayAnchor) continue
    usedSummaryIds.add(summary.id)
    pairs.push({
      boundary: {
        id: `${summary.id}:boundary`,
        role: 'system',
        content: '',
        createdAt: summary.createdAt,
        meta: {
          compactBoundary: {
            trigger: 'manual',
            preTokens: 0,
            messagesSummarized: summary.meta.compactSummary.messagesSummarized
          }
        }
      },
      summary,
      boundaryIndex: index,
      summaryIndex: index
    })
  }

  return pairs.sort((a, b) => {
    const aScore = Math.max(a.boundary.createdAt, a.summary.createdAt)
    const bScore = Math.max(b.boundary.createdAt, b.summary.createdAt)
    if (aScore !== bScore) return aScore - bScore
    return a.summaryIndex - b.summaryIndex
  })
}

function getOperationId(boundary: UnifiedMessage, summary: UnifiedMessage): string {
  return (
    summary.meta?.compactSummary?.operationId ??
    boundary.meta?.compressionStatus?.operationId ??
    summary.meta?.compressionStatus?.operationId ??
    `${boundary.id}:${summary.id}`
  )
}

function getContentBlockCount(message: UnifiedMessage): number {
  if (typeof message.content === 'string') return message.content.length > 0 ? 1 : 0
  return Array.isArray(message.content) ? message.content.length : 0
}

function createAssistantFragment(
  message: UnifiedMessage,
  start: number,
  end: number,
  id: string,
  position: MessageFragmentPosition,
  operationId: string
): RenderableMessageItem | null {
  if (message.role !== 'assistant' || end <= start) return null
  const content = typeof message.content === 'string'
    ? (start === 0 && end === 1 ? message.content : null)
    : Array.isArray(message.content)
      ? message.content.slice(start, end)
      : null
  if (content === null || (Array.isArray(content) && content.length === 0)) return null

  return {
    kind: 'message',
    message: { ...message, id, content },
    displayId: id,
    messageId: id,
    originMessageId: message.id,
    fragment: { position, operationId },
    isLastUserMessage: false,
    isLastAssistantMessage: false,
    showContinue: false
  }
}

function getAnchor(summary: UnifiedMessage, boundary: UnifiedMessage) {
  return summary.meta?.compactSummary?.displayAnchor ?? boundary.meta?.compressionStatus?.displayAnchor
}

function resolveSplitAt(message: UnifiedMessage, anchor: ReturnType<typeof getAnchor>): number {
  if (typeof message.content === 'string') return (anchor?.afterContentBlockCount ?? 0) > 0 ? 1 : 0
  if (!Array.isArray(message.content)) return 0

  if (anchor?.afterToolUseId) {
    const toolIndex = message.content.findIndex(
      (block) => block.type === 'tool_use' && block.id === anchor.afterToolUseId
    )
    if (toolIndex >= 0) {
      // Keep an inline tool_result with the tool_use it belongs to.
      const following = message.content[toolIndex + 1]
      const includesResult =
        following?.type === 'tool_result' && following.toolUseId === anchor.afterToolUseId
      return toolIndex + 1 + (includesResult ? 1 : 0)
    }
  }

  const count = anchor?.afterContentBlockCount
  return Number.isFinite(count)
    ? Math.max(0, Math.min(message.content.length, Math.floor(count ?? 0)))
    : 0
}

function getBetweenMessageInsertionIndex(
  messages: readonly UnifiedMessage[],
  displayMessages: readonly UnifiedMessage[],
  pair: CompactArtifactPair
): number {
  const preservedHeadId = pair.boundary.meta?.compactBoundary?.preservedSegment?.headId
  if (preservedHeadId) {
    const index = displayMessages.findIndex((message) => message.id === preservedHeadId)
    if (index >= 0) return index
  }

  for (let index = pair.summaryIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]
    if (isCompactArtifactMessage(candidate) || candidate.meta?.compressionStatus) continue
    const displayIndex = displayMessages.findIndex((message) => message.id === candidate.id)
    if (displayIndex >= 0) return displayIndex
  }
  return displayMessages.length
}

export function buildRenderableChatItems(
  messages: readonly UnifiedMessage[],
  visibleMessageIds?: readonly string[],
  liveState?: LiveCompressionState
): RenderableChatItem[] {
  const pairs = collectCompactArtifactPairs(messages)
  const artifactIds = new Set<string>()
  for (const message of messages) {
    if (isCompactArtifactMessage(message) || message.meta?.compressionStatus) artifactIds.add(message.id)
  }

  const visibleIds = visibleMessageIds ? new Set(visibleMessageIds) : null
  const displayMessages = messages.filter((message) => {
    if (artifactIds.has(message.id)) return false
    return !visibleIds || visibleIds.has(message.id)
  })
  const lastUserId = [...displayMessages].reverse().find((message) => message.role === 'user')?.id ?? null
  const lastAssistantId = [...displayMessages].reverse().find((message) => message.role === 'assistant')?.id ?? null
  const items: RenderableChatItem[] = []
  const insertedPairIds = new Set<string>()
  const insertedAt = new Map<number, CompactArtifactPair[]>()
  const anchoredPairsByAssistantId = new Map<string, CompactArtifactPair[]>()

  // While compressing, the live draft card takes the same anchor position the
  // completed divider will occupy, so completion swaps it in place instead of
  // the card sitting at the transcript tail and the divider appearing mid-list.
  const liveAnchor = liveState?.displayAnchor
  const liveAnchorResolvable = Boolean(
    liveAnchor?.assistantMessageId &&
      displayMessages.some((message) => message.id === liveAnchor.assistantMessageId)
  )

  for (const pair of pairs) {
    const anchor = getAnchor(pair.summary, pair.boundary)
    if (anchor?.assistantMessageId && displayMessages.some((message) => message.id === anchor.assistantMessageId)) {
      const anchoredPairs = anchoredPairsByAssistantId.get(anchor.assistantMessageId) ?? []
      anchoredPairs.push(pair)
      anchoredPairsByAssistantId.set(anchor.assistantMessageId, anchoredPairs)
      continue
    }
    const insertionIndex = getBetweenMessageInsertionIndex(messages, displayMessages, pair)
    const list = insertedAt.get(insertionIndex) ?? []
    list.push(pair)
    insertedAt.set(insertionIndex, list)
  }

  const appendCompression = (pair: CompactArtifactPair): void => {
    const operationId = getOperationId(pair.boundary, pair.summary)
    const boundary = pair.boundary.meta?.compactBoundary
    if (!boundary || insertedPairIds.has(pair.summary.id)) return
    insertedPairIds.add(pair.summary.id)
    items.push({
      kind: 'context-compression',
      id: `${pair.summary.id}:context-compression:${operationId}`,
      messageId: `${pair.summary.id}:context-compression:${operationId}`,
      summary: pair.summary,
      boundary,
      operationId,
      trigger: boundary.trigger,
      isLastUserMessage: false,
      isLastAssistantMessage: false,
      showContinue: false
    })
  }

  const appendMessage = (message: UnifiedMessage): void => {
    const item: RenderableMessageItem = {
      kind: 'message',
      message,
      displayId: message.id,
      messageId: message.id,
      originMessageId: message.id,
      isLastUserMessage: message.id === lastUserId,
      isLastAssistantMessage: message.id === lastAssistantId,
      showContinue: false
    }
    items.push(item)
  }

  const makeLiveItem = (): RenderableLiveCompressionItem => ({
    kind: 'live-compression',
    id: `${liveState!.sessionId}:live-compression:${liveState!.operationId ?? liveState!.startedAt}`,
    messageId: `${liveState!.sessionId}:live-compression:${liveState!.operationId ?? liveState!.startedAt}`,
    sessionId: liveState!.sessionId,
    operationId: liveState!.operationId,
    trigger: liveState!.trigger,
    draft: liveState!.draft,
    startedAt: liveState!.startedAt,
    attempt: liveState!.attempt,
    maxAttempts: liveState!.maxAttempts,
    isLastUserMessage: false,
    isLastAssistantMessage: false,
    showContinue: false
  })

  for (let index = 0; index <= displayMessages.length; index += 1) {
    for (const pair of insertedAt.get(index) ?? []) appendCompression(pair)
    const message = displayMessages[index]
    if (!message) continue

    const anchoredPairs = anchoredPairsByAssistantId.get(message.id)
    if ((anchoredPairs?.length || message.id === liveAnchor?.assistantMessageId) && message.role === 'assistant') {
      // Unified split plan: completed artifact pairs and the live anchor become
      // sorted cut points over the assistant's content blocks, so the live card
      // occupies exactly where the completed divider will appear.
      const liveSplitsHere = message.id === liveAnchor?.assistantMessageId
      const splits: { pair: CompactArtifactPair | null; splitAt: number }[] = (
        anchoredPairs ?? []
      ).map((pair) => ({
        pair,
        splitAt: resolveSplitAt(message, getAnchor(pair.summary, pair.boundary))
      }))
      if (liveSplitsHere && liveAnchor) {
        splits.push({ pair: null, splitAt: resolveSplitAt(message, liveAnchor) })
      }
      splits.sort((a, b) =>
        a.splitAt - b.splitAt ||
        (a.pair && b.pair ? a.pair.summaryIndex - b.pair.summaryIndex : a.pair ? 1 : b.pair ? -1 : 0)
      )

      const assistantItemIndexes: number[] = []
      let cursor = 0
      let previousOperationId: string | null = null

      for (const { pair, splitAt } of splits) {
        if (pair) {
          const operationId = getOperationId(pair.boundary, pair.summary)
          const fragment = createAssistantFragment(
            message,
            cursor,
            splitAt,
            `${message.id}:compression-before:${operationId}`,
            'before',
            operationId
          )
          if (fragment) {
            assistantItemIndexes.push(items.length)
            items.push(fragment)
          }
          appendCompression(pair)
          cursor = splitAt
          previousOperationId = operationId
        } else {
          // Live anchor cut: keep the blocks before the cut visible, then the
          // live card, then fall through so the remaining tail renders below.
          const fragment = createAssistantFragment(
            message,
            cursor,
            splitAt,
            `${message.id}:compression-before:live`,
            'before',
            'live'
          )
          if (fragment) {
            assistantItemIndexes.push(items.length)
            items.push(fragment)
          }
          items.push(makeLiveItem())
          cursor = splitAt
          if (previousOperationId === null) previousOperationId = 'live'
        }
      }

      if (previousOperationId) {
        const fragment = createAssistantFragment(
          message,
          cursor,
          getContentBlockCount(message),
          `${message.id}:compression-after:${previousOperationId}`,
          'after',
          previousOperationId
        )
        if (fragment) {
          assistantItemIndexes.push(items.length)
          items.push(fragment)
        }
      }

      const lastAssistantItemIndex = assistantItemIndexes.at(-1)
      if (lastAssistantItemIndex !== undefined && message.id === lastAssistantId) {
        const lastAssistantItem = items[lastAssistantItemIndex]
        if (lastAssistantItem.kind === 'message') {
          items[lastAssistantItemIndex] = { ...lastAssistantItem, isLastAssistantMessage: true }
        }
      }
      continue
    }

    appendMessage(message)
  }

  // Fallback: live card at the transcript tail when no stable anchor resolves
  // (manual compression can't predict the split point up front).
  if (liveState && !(liveAnchorResolvable && items.some((item) => item.kind === 'live-compression'))) {
    items.push(makeLiveItem())
  }

  return items
}

export function getRenderableItemMessageId(item: RenderableChatItem): string {
  return item.kind === 'message' ? item.displayId : item.id
}

export function getRenderableItemOriginMessageId(item: RenderableChatItem): string | null {
  return item.kind === 'message' ? item.originMessageId : null
}

export function isRenderableMessageItem(item: RenderableChatItem): item is RenderableMessageItem {
  return item.kind === 'message'
}

export function getActiveCompactArtifactIds(messages: readonly UnifiedMessage[]): Set<string> {
  const active = resolveActiveCompactArtifacts(messages)
  if (!active) return new Set()
  return new Set([active.boundaryId, active.summaryId].filter((id): id is string => Boolean(id)))
}
