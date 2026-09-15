/*
 * Where the blinking cursor goes. Pure on purpose: the rule is "there is never more than
 * one", and that is easy to break by tweaking one of the render sites.
 *
 * History (T-4): the cursor used to be rendered at three places on the message-level
 * `isStreaming` flag, with nothing preventing several from showing at once —
 * - while thinking, the thinking block's cursor *and* the trailing one both lit up;
 * - a context compression splits one run into two assistant messages (both streaming),
 *   so each rendered its own.
 *
 * 老大's rule (2026-09-15): while thinking only the thinking block's cursor shows; at all
 * other times only the trailing one does.
 */

interface ThinkSegmentLike {
  type: string
  /** Think segments carry this; a closed segment means the thought finished. */
  closed?: boolean
}

interface ThinkingBlockLike {
  type: string
  completedAt?: number
}

export interface LiveCursorInput {
  isStreaming?: boolean | undefined
  /** Segments parsed from string content; null when the message carries content blocks. */
  stringSegments?: readonly ThinkSegmentLike[] | null
  /** Structured content, used when there are no string segments. */
  normalizedContent?: readonly ThinkingBlockLike[] | null
  /** Only the last assistant message in a session may show a cursor. */
  isLastAssistantMessage?: boolean | undefined
}

/**
 * True while the thought itself is still streaming — i.e. the thinking block's own cursor
 * is the one on screen. `ThinkingBlock` derives its `isThinking` from
 * `isStreaming && !completedAt`, so this stays deliberately complementary to it: exactly
 * one of the two shows.
 */
export function isThinkingActive({
  isStreaming,
  stringSegments,
  normalizedContent
}: LiveCursorInput): boolean {
  if (!isStreaming) return false

  // String content: the thought is live while its last segment is an unclosed think.
  if (stringSegments) {
    const last = stringSegments[stringSegments.length - 1]
    return !!last && last.type === 'think' && !last.closed
  }

  // Structured content: same question, read off the trailing thinking block.
  const trailing = normalizedContent?.[normalizedContent.length - 1]
  return trailing?.type === 'thinking' && !trailing.completedAt
}

/**
 * Whether the trailing cursor belongs at the end of the rendered content.
 *
 * Every guard matters:
 * - `isLastAssistantMessage` — after a compression the earlier message must not light up.
 * - `!isThinkingActive` — while thinking, the thinking block owns the cursor.
 * - `hasContent` — with nothing rendered yet there is no line to sit on; the caller shows
 *   its "thinking…" placeholder instead.
 */
export function shouldShowTrailingCursor(input: LiveCursorInput): boolean {
  if (!input.isStreaming || !input.isLastAssistantMessage) return false
  if (isThinkingActive(input)) return false
  return input.stringSegments
    ? input.stringSegments.length > 0
    : (input.normalizedContent?.length ?? 0) > 0
}
