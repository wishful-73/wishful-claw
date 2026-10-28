// T-13 (iter-29) — long-paste chips: data-layer round-trip.
//
// The composer serializes collapsed pastes as `<pasted-block>{…}</pasted-block>`
// tags so the transcript can render a chip. Everything that needs the real user
// text (model payload, copy, memory, follow-up) has to expand them again, so the
// contract between `createPastedBlockTag` and `expandPastedBlocks` is the thing
// this suite locks down.

import assert from 'node:assert/strict'
import {
  createPastedBlockTag,
  createSelectFileTag,
  describePastedBlockLabel,
  expandPastedBlocks,
  parseSelectFileText,
  selectFileTextToPlainText
} from '../../src/renderer/src/lib/select-file-tags'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// ── Plain text is untouched ────────────────────────────────────────────────
eq(expandPastedBlocks(''), '', 'empty text stays empty')
eq(expandPastedBlocks('hello world'), 'hello world', 'plain text passes through')
eq(
  expandPastedBlocks('a\nb\r\nc'),
  'a\nb\r\nc',
  'whitespace and line endings survive unchanged'
)

// ── Round trip: tag -> verbatim body ───────────────────────────────────────
const body = 'line1\nline2 <tag> & "quoted" \u4e2d\u6587\ttail'
const tag = createPastedBlockTag({ label: '\u7c98\u8d34 \u00b7 4 \u884c', text: body })

check(tag.startsWith('<pasted-block>') && tag.endsWith('</pasted-block>'), 'tag is wrapped')
eq(expandPastedBlocks(tag), body, 'pasted tag expands back to the verbatim body')

const segments = parseSelectFileText(tag)
eq(segments.length, 1, 'tag parses to a single segment')
eq(segments[0]?.type, 'pasted', 'segment is a paste')
eq(
  segments[0]?.type === 'pasted' ? segments[0].pastedText : null,
  body,
  'pasted segment carries the body'
)

// The copy / queue-summary view has to surface the body too, not the caption.
eq(selectFileTextToPlainText(tag), body, 'plain-text view surfaces the pasted body')

// ── Mixed content keeps every non-paste segment as-is ─────────────────────
const fileTag = createSelectFileTag('src/renderer/a.ts')
const mixed = `\u770b\u4e0b ${fileTag} \u7136\u540e\uff1a\n${tag}\n\u7ed3\u675f`
eq(
  expandPastedBlocks(mixed),
  `\u770b\u4e0b ${fileTag} \u7136\u540e\uff1a\n${body}\n\u7ed3\u675f`,
  'expand rewrites the paste and leaves the select-file tag raw'
)
eq(expandPastedBlocks(fileTag), fileTag, 'a select-file-only message is unchanged')
eq(
  selectFileTextToPlainText(mixed),
  `\u770b\u4e0b src/renderer/a.ts \u7136\u540e\uff1a\n${body}\n\u7ed3\u675f`,
  'plain-text view flattens the file reference and keeps the pasted body'
)

// ── Malformed payloads never drop text ────────────────────────────────────
const notJson = '<pasted-block>not json</pasted-block>'
eq(expandPastedBlocks(notJson), notJson, 'unparsable payload is left untouched')

const noText = '<pasted-block>{"label":"x"}</pasted-block>'
eq(expandPastedBlocks(noText), noText, 'payload without a body is left untouched')

const unclosed = '<pasted-block>{"label":"x","text":"y"}'
eq(expandPastedBlocks(unclosed), unclosed, 'unclosed tag is left untouched')

eq(
  expandPastedBlocks(`\u524d${notJson}\u540e`),
  `\u524d${notJson}\u540e`,
  'surrounding text survives a malformed tag'
)

// ── Multiple pastes ───────────────────────────────────────────────────────
const first = createPastedBlockTag({ label: 'p1', text: 'AAA' })
const second = createPastedBlockTag({ label: 'p2', text: 'BBB' })
eq(
  expandPastedBlocks(`${first} / ${second}`),
  'AAA / BBB',
  'every paste in a message is expanded'
)

// ── Idempotence on already-expanded text ──────────────────────────────────
eq(expandPastedBlocks(body), body, 'expanding twice is a no-op')

// ── S-257: render-time chip caption carries the character count ───────────
// `describePastedBlockLabel` is computed from the verbatim body, not from the
// frozen `label` in the payload, so the count must survive any caption wording.
// i18n is not initialised in this suite ⇒ every assertion reads the zh fallback.
eq(
  describePastedBlockLabel('a'.repeat(400)),
  '\u7c98\u8d34 \u00b7 400 \u5b57',
  'single-line paste shows only the character count'
)
eq(
  describePastedBlockLabel('one\ntwo\nthree'),
  '\u7c98\u8d34 \u00b7 3 \u884c \u00b7 13 \u5b57',
  'multi-line paste shows lines and characters'
)
eq(
  describePastedBlockLabel('abc\n'),
  '\u7c98\u8d34 \u00b7 3 \u5b57',
  'trailing newline appended by the editor is not counted'
)
eq(
  describePastedBlockLabel('a'.repeat(9999)),
  `\u7c98\u8d34 \u00b7 9999 \u5b57`,
  'under ten thousand stays in plain characters'
)
eq(
  describePastedBlockLabel('a'.repeat(10000)),
  '\u7c98\u8d34 \u00b7 1 \u4e07\u5b57',
  'ten thousand switches to the wan unit with no trailing .0'
)
eq(
  describePastedBlockLabel('a'.repeat(12345)),
  '\u7c98\u8d34 \u00b7 1.2 \u4e07\u5b57',
  'wan unit keeps one decimal'
)
eq(describePastedBlockLabel(''), '\u7c98\u8d34 \u00b7 0 \u5b57', 'empty body reports zero')

console.log(`select-file tag checks passed: ${checks}`)
