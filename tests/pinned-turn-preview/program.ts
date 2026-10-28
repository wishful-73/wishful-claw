// S-255 (iter-v3-3) — pinned indicator bar: one user message -> what the bar shows.
//
// The bug was never missing data: `UnifiedMessage.content` carries text + images +
// `<pasted-block>` / `<select-file>` tags. The bar threw all but `.text` away, so images
// vanished, tag markup leaked into the caption and an image-only message rendered "(image/
// attachment message)". This suite locks the derivation half down; the bar's markup is
// exercised by eye on a dev instance.

import assert from 'node:assert/strict'
import { buildPinnedTurnPreview } from '../../src/renderer/src/lib/pinned-turn-preview'
import {
  createPastedBlockTag,
  createSelectFileTag
} from '../../src/renderer/src/lib/select-file-tags'
import type { ContentBlock } from '../../src/renderer/src/lib/api/types'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

function imageBlock(base64: string, mediaType = 'image/png'): ContentBlock {
  return { type: 'image', source: { type: 'base64', mediaType, data: base64 } } as ContentBlock
}

// ── Plain text is unchanged ────────────────────────────────────────────────
const plain = buildPinnedTurnPreview('  hello  ')
eq(plain.text, 'hello', 'plain text is trimmed')
eq(plain.chips.length, 0, 'plain text yields no chips')
eq(plain.images.length, 0, 'plain text yields no images')
check(plain.hasContent, 'plain text counts as content')

// ── Images survive, and an image-only message is not "empty" ──────────────
const imageOnly = buildPinnedTurnPreview([imageBlock('AAAA')] as ContentBlock[])
eq(imageOnly.text, '', 'image-only message has no text')
eq(imageOnly.images.length, 1, 'image-only message keeps its image')
eq(imageOnly.images[0].dataUrl, 'data:image/png;base64,AAAA', 'image is renderable as a data URL')
check(imageOnly.hasContent, 'image-only message must not render the empty state')

// ── Collapsed paste becomes a chip, never raw markup ─────────────────────
const pasteBody = 'line one\nline two\nline three'
const pasteTag = createPastedBlockTag({ label: '粘贴 · 3 行', text: pasteBody })
const withPaste = buildPinnedTurnPreview(`看下这个\n${pasteTag}`)
eq(withPaste.text, '看下这个', 'paste tag is removed from the caption text')
check(!withPaste.text.includes('<pasted-block>'), 'raw pasted-block markup never reaches the bar')
eq(withPaste.chips.length, 1, 'paste yields exactly one chip')
eq(withPaste.chips[0].kind, 'pasted', 'paste chip is tagged as pasted')
// S-257: caption is recomputed from the body, so the frozen payload label is irrelevant.
eq(withPaste.chips[0].label, '粘贴 · 3 行 · 28 字', 'paste chip carries lines and characters')
eq(
  withPaste.titleText,
  `看下这个\n${pasteBody}`,
  'hover title expands the paste back to its verbatim body'
)
check(!withPaste.titleText.includes('<pasted-block>'), 'hover title never leaks raw markup')

// ── Selected file becomes a chip showing just the file name ──────────────
const fileTag = createSelectFileTag('D:\\work\\deep\\report.md')
const withFile = buildPinnedTurnPreview(`读一下 ${fileTag} 谢谢`)
eq(withFile.text, '读一下  谢谢', 'file tag is removed from the caption text')
eq(withFile.chips.length, 1, 'file yields exactly one chip')
eq(withFile.chips[0].kind, 'file', 'file chip is tagged as file')
eq(withFile.chips[0].label, 'report.md', 'file chip shows the bare file name')

// ── Mixed message: every part is accounted for, in order ─────────────────
const mixed = buildPinnedTurnPreview(
  [imageBlock('BBBB'), { type: 'text', text: `图 ${fileTag} 和 ${pasteTag}` }] as ContentBlock[]
)
eq(mixed.images.length, 1, 'mixed message keeps its image')
eq(mixed.chips.length, 2, 'mixed message keeps both chips')
eq(mixed.chips[0].kind, 'file', 'chips preserve source order (file first)')
eq(mixed.chips[1].kind, 'pasted', 'chips preserve source order (paste second)')
eq(mixed.text, '图  和', 'mixed caption keeps only the surrounding text')
check(mixed.hasContent, 'mixed message has content')

// ── Nothing at all still reports empty ──────────────────────────────────
const empty = buildPinnedTurnPreview('')
eq(empty.text, '', 'empty message has no text')
eq(empty.chips.length, 0, 'empty message has no chips')
check(!empty.hasContent, 'empty message falls back to the empty state')

console.log(`pinned turn preview checks passed: ${checks}`)
