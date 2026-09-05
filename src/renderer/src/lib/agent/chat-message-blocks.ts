import type { ContentBlock } from '@renderer/lib/api/types'

/**
 * Build the ordered content blocks a stored ChatMessage renders as.
 *
 * A live run writes streaming output into `segments` / `toolCalls` / `text`
 * rather than a block array, so both the message list and the compression
 * display anchor must derive blocks the same way — otherwise the two disagree
 * about where a block index points.
 */
export function buildChatMessageContent(
  msg: Record<string, unknown>
): ContentBlock[] | string {
  const text = (msg.text as string) ?? ''
  const thinking = msg.thinking as string | undefined
  const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined

  const blocks: ContentBlock[] = []
  const persistedContent = Array.isArray(msg.content)
    ? (msg.content as ContentBlock[])
    : null

  if (persistedContent && persistedContent.length > 0) {
    blocks.push(...persistedContent)
    return blocks
  }

  const segments = msg.segments as Array<Record<string, unknown>> | undefined
  if (segments && segments.length > 0) {
    for (const seg of segments) {
      const segType = seg.type as string
      if (segType === 'thinking' && seg.thinking) {
        blocks.push({ type: 'thinking', thinking: seg.thinking as string, startedAt: seg.startedAt as number | undefined, completedAt: seg.completedAt as number | undefined })
      } else if (segType === 'text' && seg.text) {
        blocks.push({ type: 'text', text: seg.text as string })
      } else if (segType === 'tool_use' && seg.toolCallId) {
        blocks.push({
          type: 'tool_use',
          id: seg.toolCallId as string,
          name: (seg.toolName as string) ?? 'unknown',
          input: (seg.input as Record<string, unknown>) ?? {}
        })
        // Also add inline tool_result block for completed/errored tools
        // so that resolveToolCallStatus finds a result instead of falling back to 'canceled'
        const segStatus = seg.status as string | undefined
        if (segStatus === 'completed' || segStatus === 'error') {
          blocks.push({
            type: 'tool_result',
            toolUseId: seg.toolCallId as string,
            content: (seg.output as string) ?? '',
            isError: segStatus === 'error'
          })
        }
      }
    }
    return blocks.length > 0 ? blocks : text
  }

  // Fallback: old format without temporal ordering
  if (thinking) {
    blocks.push({ type: 'thinking', thinking })
  }

  if (text) {
    blocks.push({ type: 'text', text })
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id as string,
        name: tc.name as string,
        input: (tc.input as Record<string, unknown>) ?? {}
      })
      // Also add inline tool_result block for completed/errored tools
      const tcStatus = tc.status as string | undefined
      if (tcStatus === 'completed' || tcStatus === 'error') {
        blocks.push({
          type: 'tool_result',
          toolUseId: tc.id as string,
          content: (tc.output as string) ?? '',
          isError: tcStatus === 'error'
        })
      }
    }
  }

  return blocks.length > 0 ? blocks : text
}

/**
 * Split position of a message inside its own rendered block list:
 * how many blocks it currently shows, plus the last tool call among them.
 */
export function getRenderedBlockPosition(content: ContentBlock[] | string): {
  afterContentBlockCount: number
  afterToolUseId?: string
} {
  if (typeof content === 'string') {
    return { afterContentBlockCount: content.length > 0 ? 1 : 0 }
  }
  const lastToolUse = [...content]
    .reverse()
    .find((block) => block.type === 'tool_use')
  return {
    afterContentBlockCount: content.length,
    ...(lastToolUse && lastToolUse.type === 'tool_use'
      ? { afterToolUseId: lastToolUse.id }
      : {})
  }
}
