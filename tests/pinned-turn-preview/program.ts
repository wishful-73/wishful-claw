// S-255 (iter-v3-3) — pinned indicator bar: one user message -> what the bar shows.
//
// The bug was never missing data: `UnifiedMessage.content` carries text + images +
// `<pasted-block>` / `<select-file>` tags. The bar threw all but `.text` away, so images
// vanished, tag markup leaked into the caption and an image-only message rendered "(image/
// attachment message)". This suite locks the derivation half down; the bar's markup is
// exercised by eye on a dev instance.

import assert from 'node:assert/strict'
import {
  buildPinnedTurnPreview,
  MEDIA_LINE_BUDGET_PX,
  measurePinnedMediaLine,
  selectPinnedMedia
} from '../../src/renderer/src/lib/pinned-turn-preview'
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
// 注：`'读一下  谢谢'` 的双空格是「把芯片从文本里摘掉」的副产物，不是设计上的期望。
// 聊天窗内联 badge 也是这个表现，故两边一致；将来若要折叠成单空格，这两条要同步改。
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

// ── Media line width budget (S-255 审查补刀 · 第二轮) ────────────────────
// 槽位必须按「宽度」分配，不能按元素个数：缩略图 28px、芯片最宽 110px，
// 「4 个元素」在不同配比下从 238px 到 402px 不等。曾经最坏的一档正是
// 「1 图 + 3 芯」= 402px —— 而容器是 overflow-hidden，第一个被裁掉的就是
// `+N` 徽标，也就是「还有内容」的唯一提示。
function chipsOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'file' as const,
    label: `f${i}.md`
  }))
}
function fakeImages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `img${i}`,
    dataUrl: `data:image/png;base64,AAAA${i}`,
    mediaType: 'image/png'
  }))
}

// 每一种「图片数 × 芯片充足」的配比都必须装进预算，这条是真正的守门断言。
for (let imageCount = 0; imageCount <= 8; imageCount += 1) {
  const selection = selectPinnedMedia(fakeImages(imageCount), chipsOf(8))
  const width = measurePinnedMediaLine(selection)
  check(
    width <= MEDIA_LINE_BUDGET_PX,
    `${imageCount} image(s) + chips fits the media line budget (${width}px <= ${MEDIA_LINE_BUDGET_PX}px)`
  )
  check(selection.chips.length >= 1, `${imageCount} image(s) still leave at least one chip slot`)
}

const noMedia = selectPinnedMedia([], [])
eq(noMedia.thumbnails.length + noMedia.chips.length, 0, 'no media selects nothing')
eq(noMedia.overflow, 0, 'no media has no overflow')

const chipsOnly = selectPinnedMedia([], chipsOf(5))
eq(chipsOnly.chips.length, 3, 'chips alone use three slots — the widest shape we accept')
eq(chipsOnly.overflow, 2, 'chips alone fold the rest into overflow')

const imagesOnly = selectPinnedMedia(fakeImages(5), [])
eq(imagesOnly.thumbnails.length, 3, 'images alone use up to three slots')
eq(imagesOnly.chips.length, 0, 'images alone keep no chip slot they cannot use')
eq(imagesOnly.overflow, 2, 'images alone fold the rest into overflow')

// 「贴一张截图 + 粘两段代码 + 引用一个文件」—— 最常见的拼图方式，也是回归的现场。
const mixedMedia = selectPinnedMedia(fakeImages(1), chipsOf(5))
eq(mixedMedia.thumbnails.length, 1, 'the single image is kept')
eq(mixedMedia.chips.length, 2, 'one image leaves room for two chips, not three')
eq(mixedMedia.overflow, 3, 'overflow counts both merged sources')
check(
  measurePinnedMediaLine(mixedMedia) < 300,
  'one image + two chips stays under 300px — the 402px shape must not come back'
)

const threeImages = selectPinnedMedia(fakeImages(3), chipsOf(5))
eq(threeImages.thumbnails.length, 3, 'three images keep all three thumbnails')
eq(threeImages.chips.length, 2, 'three images still leave two chip slots')
eq(threeImages.overflow, 3, 'overflow stays consistent')

const worstCase = selectPinnedMedia(fakeImages(10), chipsOf(10))
check(worstCase.overflow > 0, 'worst case reports hidden content')
eq(worstCase.overflow, 20 - worstCase.thumbnails.length - worstCase.chips.length, 'worst case overflow arithmetic holds')

console.log(`pinned turn preview checks passed: ${checks}`)
