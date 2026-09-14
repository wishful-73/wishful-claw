// Pure utility functions and types extracted from MessageList.tsx

import type { UnifiedMessage } from '@renderer/lib/api/types'
import type { TFunction } from 'i18next'
import { getCompactSummaryDisplayText } from '@renderer/lib/agent/context-compression'
import { expandPastedBlocks } from '@renderer/lib/select-file-tags'


import type {
  MessageLocatorIndexRow,
  MessageLocatorSource,
} from './utils'
import { ASSISTANT_RAIL_PREVIEW_LIMIT, EMPTY_ASSISTANT_RAIL_LAYOUT } from './utils'
import { AssistantRailLayout, AssistantRailLayoutRow, AssistantRailMarkerKind, AssistantReplyRailItem } from './utils'

export function normalizeLocatorPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncateAssistantRailPreview(text: string): string {
  if (text.length <= ASSISTANT_RAIL_PREVIEW_LIMIT) return text
  return `${text.slice(0, ASSISTANT_RAIL_PREVIEW_LIMIT - 1).trimEnd()}...`
}

export function isSystemPromptText(text: string): boolean {
  return text.trim().toLowerCase().startsWith('<system')
}

export function getUserMessageText(content: UnifiedMessage['content']): string {
  // T-13: a user row keeps its `<pasted-block>` chips in the DB; the rail
  // preview must read the pasted body, not the tag JSON.
  if (typeof content === 'string') return isSystemPromptText(content) ? '' : expandPastedBlocks(content)
  return content
    .filter(
      (block) =>
        block.type === 'text' && typeof block.text === 'string' && !isSystemPromptText(block.text)
    )
    .map((block) => (block.type === 'text' ? expandPastedBlocks(block.text) : ''))
    .join('\n')
}

export function getAssistantVisibleText(content: UnifiedMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((block) => block.type === 'text' || block.type === 'agent_error')
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'agent_error') return block.message
      return ''
    })
    .join('\n')
}

export function countToolUseBlocks(content: UnifiedMessage['content']): number {
  if (typeof content === 'string') return 0
  return content.filter((block) => block.type === 'tool_use').length
}

export function countCodeFenceBlocks(text: string): number {
  return text.match(/```/g)?.length ?? 0
}

export function isTeamLocatorSource(source: MessageLocatorSource): boolean {
  if (source.source === 'team') return true
  return (
    typeof source.content === 'string' && /^\[Team message from .+?\]:\n?/u.test(source.content)
  )
}

export function shouldShowAssistantRailMarker(
  source: MessageLocatorSource,
  hiddenCompactSummaryIds: Set<string>
): boolean {
  if (hiddenCompactSummaryIds.has(source.id)) return false
  if (source.meta?.compactSummary) return true
  if (source.meta?.compactBoundary) return false
  if (source.meta?.compressionStatus) return false
  if (isTeamLocatorSource(source)) return false
  // Only show markers for user messages
  if (source.role !== 'user') return false
  return (
    Boolean(normalizeLocatorPreview(getUserMessageText(source.content))) ||
    countImageBlocks(source.content) > 0
  )
}

export function getAssistantRailMarkerKind(
  source: MessageLocatorSource,
  streamingMessageId: string | null,
  hiddenCompactSummaryIds: Set<string>
): AssistantRailMarkerKind | null {
  if (!shouldShowAssistantRailMarker(source, hiddenCompactSummaryIds)) return null
  if (source.meta?.compactSummary) return 'summary'
  if (source.role === 'user') return 'user'
  if (source.id === streamingMessageId) return 'streaming'
  return 'assistant'
}

export function buildAssistantRailPreview(
  source: MessageLocatorSource,
  kind: AssistantRailMarkerKind,
  t: TFunction
): string {
  const text =
    kind === 'summary'
      ? getCompactSummaryDisplayText({
          id: source.id,
          role: source.role,
          content: source.content,
          createdAt: source.createdAt,
          meta: source.meta
        })
      : kind === 'user'
        ? getUserMessageText(source.content)
        : getAssistantVisibleText(source.content)
  const preview = truncateAssistantRailPreview(normalizeLocatorPreview(text))
  if (preview) return preview

  if (kind === 'user') {
    const imageCount = countImageBlocks(source.content)
    if (imageCount > 0) {
      return t('messageList.userLocator.imageMessage', {
        count: imageCount,
        defaultValue: imageCount === 1 ? 'Image message' : '{{count}} images'
      })
    }
    return t('messageList.userLocator.emptyMessage', {
      defaultValue: 'Empty message'
    })
  }

  const toolUseCount = countToolUseBlocks(source.content)
  if (toolUseCount > 0) {
    return t('messageList.assistantRail.toolOnlyPreview', {
      count: toolUseCount,
      defaultValue: toolUseCount === 1 ? '1 tool call' : '{{count}} tool calls'
    })
  }

  if (kind === 'summary') {
    return t('messageList.assistantRail.summaryPreview', {
      defaultValue: 'Compressed history summary'
    })
  }

  return t('messageList.assistantRail.emptyPreview', {
    defaultValue: 'Assistant reply'
  })
}

export function estimateLocatorRowHeight(source: MessageLocatorSource): number {
  if (source.meta?.compressionStatus) return 64
  if (source.meta?.compactBoundary) return 40
  if (source.meta?.compactSummary) return 112

  const text =
    source.role === 'assistant'
      ? getAssistantVisibleText(source.content)
      : getUserMessageText(source.content)
  const normalizedLength = normalizeLocatorPreview(text).length
  const newlineCount = text.split('\n').length - 1
  const imageCount = countImageBlocks(source.content)
  const toolUseCount = countToolUseBlocks(source.content)
  const codeFenceCount = countCodeFenceBlocks(text)

  if (source.role === 'assistant') {
    return Math.max(
      96,
      96 +
        Math.ceil(normalizedLength / 82) * 22 +
        newlineCount * 8 +
        Math.ceil(codeFenceCount / 2) * 96 +
        toolUseCount * 88 +
        imageCount * 180
    )
  }

  if (source.role === 'user') {
    return Math.max(72, 72 + Math.ceil(normalizedLength / 90) * 18 + imageCount * 120)
  }

  if (source.role === 'tool') return 64 + Math.min(120, Math.ceil(normalizedLength / 120) * 18)
  return 48
}

export function buildAssistantRailLayout(args: {
  sources: MessageLocatorSource[]
  streamingMessageId: string | null
  measuredHeights: Map<string, number>
  hiddenCompactSummaryIds: Set<string>
  t: TFunction
}): AssistantRailLayout {
  if (args.sources.length === 0) return EMPTY_ASSISTANT_RAIL_LAYOUT

  const rows: AssistantRailLayoutRow[] = []
  let estimatedTop = 0

  for (const source of args.sources) {
    const estimatedHeight = Math.max(
      1,
      args.measuredHeights.get(source.id) ?? estimateLocatorRowHeight(source)
    )
    const markerKind = getAssistantRailMarkerKind(
      source,
      args.streamingMessageId,
      args.hiddenCompactSummaryIds
    )
    rows.push({ ...source, estimatedTop, estimatedHeight, markerKind })
    estimatedTop += estimatedHeight
  }

  const totalEstimatedHeight = Math.max(1, estimatedTop)
  const items: AssistantReplyRailItem[] = []
  for (const row of rows) {
    if (!row.markerKind) continue
    items.push({
      id: row.id,
      index: items.length + 1,
      preview: buildAssistantRailPreview(row, row.markerKind, args.t),
      time: formatLocatorTime(row.createdAt),
      position: (row.estimatedTop + row.estimatedHeight / 2) / totalEstimatedHeight,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      estimatedTop: row.estimatedTop,
      estimatedHeight: row.estimatedHeight,
      kind: row.markerKind
    })
  }

  return { rows, items, totalEstimatedHeight }
}

export function parseLocatorRowSource(row: MessageLocatorIndexRow): MessageLocatorSource {
  return {
    id: row.id,
    role: row.role as UnifiedMessage['role'],
    content: parseLocatorContent(row.content),
    meta: parseLocatorMeta(row.meta),
    createdAt: row.created_at,
    sortOrder: row.sort_order
  }
}

export function countImageBlocks(content: UnifiedMessage['content']): number {
  if (typeof content === 'string') return 0
  return content.filter((block) => block.type === 'image' || block.type === 'image_error').length
}

export function getCompactRailGapPx(total: number): number {
  return Math.max(3.5, Math.min(9, 176 / (Math.max(2, total) - 1)))
}

export function getCompactRailMarkerOffsetPx(index: number, total: number): number {
  const safeTotal = Math.max(1, total)
  if (safeTotal === 1) return 0

  const gapPx = getCompactRailGapPx(safeTotal)
  return (index - (safeTotal - 1) / 2) * gapPx
}

export function getCompactRailMarkerTop(index: number, total: number): string {
  const offsetPx = getCompactRailMarkerOffsetPx(index, total)
  return `calc(50% + ${Number(offsetPx.toFixed(2))}px)`
}

export function getCompactRailMarkerY(rect: DOMRect, index: number, total: number): number {
  return rect.top + rect.height / 2 + getCompactRailMarkerOffsetPx(index, total)
}

export function formatLocatorTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function splitLocatorPreview(preview: string): { title: string; detail: string | null } {
  const normalized = preview.trim()
  if (normalized.length <= 30) return { title: normalized, detail: null }

  const sentenceEnd = normalized.search(/[。.!！?？]/)
  const splitOnSentence = sentenceEnd >= 12 && sentenceEnd <= 34
  const titleEnd = splitOnSentence ? sentenceEnd + 1 : Math.min(30, normalized.length)
  const title = normalized.slice(0, titleEnd).trim()
  const detail = normalized.slice(titleEnd).trim()

  return {
    title: !splitOnSentence && title.length < normalized.length ? `${title}...` : title,
    detail: detail || normalized
  }
}

export function parseLocatorContent(rawContent: string): UnifiedMessage['content'] {
  try {
    const parsed = JSON.parse(rawContent)
    if (typeof parsed === 'string' || Array.isArray(parsed)) return parsed
  } catch {
    return rawContent
  }
  return ''
}

export function parseLocatorMeta(rawMeta: string | null): UnifiedMessage['meta'] {
  if (!rawMeta) return undefined
  try {
    return JSON.parse(rawMeta) as UnifiedMessage['meta']
  } catch {
    return undefined
  }
}
