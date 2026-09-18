// S-57 (iter-31) — queued-message hover text.
//
// The queued list only has one line per entry, so the line renders a collapsed
// summary. `queuedMessageFullText` is what the row's `title` shows on hover, and
// its whole job is to be the *untruncated* counterpart of
// `summarizeQueuedMessage`: same tag handling, no length cap, and a collapsed
// paste has to come back as the verbatim body (the tag only carries the chip
// caption, so not expanding it means the user cannot see what they pasted).

import assert from 'node:assert/strict'
import { createPastedBlockTag, createSelectFileTag } from '../../src/renderer/src/lib/select-file-tags'
import {
  queuedMessageFullText,
  summarizeQueuedMessage
} from '../../src/renderer/src/lib/queued-message-text'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// ── Plain text passes through untruncated ──────────────────────────────────
eq(queuedMessageFullText(''), '', 'empty text stays empty')
eq(queuedMessageFullText('   '), '', 'whitespace-only collapses to empty')
eq(queuedMessageFullText('  hello world  '), 'hello world', 'outer whitespace is trimmed')
eq(
  queuedMessageFullText('第一行\n第二行'),
  '第一行\n第二行',
  'inner newlines survive (the hover text is allowed to be multi-line)'
)

// ── The whole point: no 72-char cut ───────────────────────────────────────
const long = 'x'.repeat(200)
eq(queuedMessageFullText(long), long, 'long text is NOT truncated')
eq(queuedMessageFullText(long).length, 200, 'full text keeps every character')
eq(summarizeQueuedMessage(long).endsWith('…'), true, 'sanity: the summary is the one that truncates')
eq(summarizeQueuedMessage(long).length, 73, 'sanity: summary is 72 chars plus the ellipsis')
eq(summarizeQueuedMessage('短消息'), '短消息', 'short text is passed through by the summary too')

// ── Collapsed paste expands back to the verbatim body ─────────────────────
const body = 'line1\nline2 <tag> & "quoted"'
const pasteTag = createPastedBlockTag({ label: '粘贴 · 2 行', text: body })
eq(queuedMessageFullText(pasteTag), body, 'pasted tag expands to the body')
eq(queuedMessageFullText(pasteTag) === body.slice(0, 5), false, 'sanity: not just a prefix')

// ── select-file tags drop the tag, keep the text ───────────────────────────
const fileTag = createSelectFileTag('src/renderer/a.ts')
eq(
  queuedMessageFullText(`看下 ${fileTag} 然后`),
  '看下 src/renderer/a.ts 然后',
  'select-file tag becomes its plain path'
)

// ── Mixed content: tag + paste + plain text ───────────────────────────────
eq(
  queuedMessageFullText(`改 ${fileTag}：\n${pasteTag}\n结束`),
  `改 src/renderer/a.ts：\n${body}\n结束`,
  'mixed content keeps order and expands each segment'
)

console.log(`queued-message-text: ${checks} assertions passed`)
