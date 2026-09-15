/*
 * The live-cursor rule: **never more than one cursor on screen**.
 *
 * This exists because the rule is only one open-coded boolean away from breaking. The
 * original code decided each of the three cursor sites independently from the
 * message-level `isStreaming` flag, so while thinking you got the thinking block's cursor
 * *and* the trailing one, and a context compression (which splits a run into two
 * streaming assistant messages) got one per message.
 */

import assert from 'node:assert/strict'
import {
  isThinkingActive,
  shouldShowTrailingCursor
} from '../../src/renderer/src/components/chat/AssistantMessage/live-cursor'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

const think = (closed: boolean): { type: string; closed: boolean } => ({ type: 'think', closed })
const text = (): { type: string } => ({ type: 'text' })

// ── While thinking: the block owns the cursor ────────────────────────────────
{
  const streaming = { isStreaming: true, isLastAssistantMessage: true }

  check(
    isThinkingActive({ ...streaming, stringSegments: [think(false)] }),
    'an unclosed trailing think segment means thinking is live'
  )
  check(
    !shouldShowTrailingCursor({ ...streaming, stringSegments: [think(false)] }),
    'while thinking the trailing cursor stays off — otherwise there would be two'
  )

  check(
    !isThinkingActive({ ...streaming, stringSegments: [think(false), text()] }),
    'a thought followed by text is finished'
  )
  check(
    shouldShowTrailingCursor({ ...streaming, stringSegments: [think(false), text()] }),
    'once text is streaming the trailing cursor is the one that shows'
  )

  check(
    !isThinkingActive({ ...streaming, stringSegments: [think(true)] }),
    'a closed think segment is no longer thinking'
  )
}

// ── Structured content behaves the same way ─────────────────────────────────
{
  const streaming = { isStreaming: true, isLastAssistantMessage: true }

  check(
    isThinkingActive({ ...streaming, normalizedContent: [{ type: 'thinking' }] }),
    'a trailing thinking block without completedAt is live'
  )
  check(
    !shouldShowTrailingCursor({ ...streaming, normalizedContent: [{ type: 'thinking' }] }),
    'and it suppresses the trailing cursor'
  )
  check(
    !isThinkingActive({
      ...streaming,
      normalizedContent: [{ type: 'thinking', completedAt: 123 }]
    }),
    'a completed thinking block is not live'
  )
  check(
    shouldShowTrailingCursor({
      ...streaming,
      normalizedContent: [{ type: 'thinking', completedAt: 123 }]
    }),
    'so the trailing cursor returns'
  )
  check(
    !isThinkingActive({ ...streaming, normalizedContent: [{ type: 'text' }] }),
    'a trailing text block is never thinking'
  )
}

// ── Only the last assistant message may show one ────────────────────────────
{
  // The compression case: the earlier message still carries the streaming flag, so
  // without this guard both it and the new one render a cursor.
  check(
    !shouldShowTrailingCursor({
      isStreaming: true,
      isLastAssistantMessage: false,
      stringSegments: [text()]
    }),
    'a non-final assistant message never shows the cursor'
  )
  check(
    shouldShowTrailingCursor({
      isStreaming: true,
      isLastAssistantMessage: true,
      stringSegments: [text()]
    }),
    'the final one does'
  )
}

// ── Off while idle ──────────────────────────────────────────────────────────
{
  check(
    !shouldShowTrailingCursor({ isStreaming: false, isLastAssistantMessage: true }),
    'a finished run shows no cursor'
  )
  check(!isThinkingActive({}), 'no streaming flag means no live thought')
  check(
    !shouldShowTrailingCursor({ isStreaming: true, isLastAssistantMessage: true }),
    'streaming with no content yet shows no trailing cursor'
  )
}

// ── The property that matters: the two can never both be on ─────────────────
{
  const cases: Array<Parameters<typeof isThinkingActive>[0]> = [
    { isStreaming: true, isLastAssistantMessage: true, stringSegments: [think(false)] },
    { isStreaming: true, isLastAssistantMessage: true, stringSegments: [text()] },
    { isStreaming: true, isLastAssistantMessage: true, normalizedContent: [{ type: 'thinking' }] },
    {
      isStreaming: true,
      isLastAssistantMessage: true,
      normalizedContent: [{ type: 'thinking', completedAt: 1 }]
    },
    { isStreaming: false, isLastAssistantMessage: true }
  ]

  for (const input of cases) {
    const thinking = isThinkingActive(input)
    const trailing = shouldShowTrailingCursor(input)
    check(
      !(thinking && trailing),
      `a live thought and a trailing cursor must never coexist: ${JSON.stringify(input)}`
    )
  }
}

console.log(`live cursor checks passed: ${checks}`)
