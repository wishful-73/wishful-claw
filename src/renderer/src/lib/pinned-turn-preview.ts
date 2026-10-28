import {
  describePastedBlockLabel,
  expandPastedBlocks,
  parseSelectFileText,
  selectFileTextToPlainText,
  type SelectFileTextSegment
} from './select-file-tags'
import { extractEditableUserMessageDraft, type ImageAttachment } from './image-attachments'
import type { SystemCommandSnapshot } from './commands/system-command'
import type { UnifiedMessage } from './api/types'

/**
 * S-255: everything the pinned indicator bar needs, derived from **one** user message.
 *
 * The bar used to render `extractEditableUserMessageDraft(content).text` and nothing else, so
 * images vanished, collapsed pastes and `<select-file>` tags leaked into the caption as raw
 * markup, and an image-only message fell through to the empty state. The message itself was
 * never the problem — `UnifiedMessage.content` carries all of it.
 *
 * Kept dependency-free (no React) on purpose: the bar's fidelity is worth a plain regression
 * suite, and this is the half that decides what shows up.
 */

export type PinnedChipKind = 'command' | 'pasted' | 'file' | 'plugin'

export interface PinnedChip {
  kind: Exclude<PinnedChipKind, 'command'>
  label: string
}

export interface PinnedTurnPreview {
  /** Plain user text with every chip / image removed — chip captions are not repeated here. */
  text: string
  images: ImageAttachment[]
  chips: PinnedChip[]
  command: SystemCommandSnapshot | null
  /** Expanded body (pastes restored to their verbatim text) for the hover title. */
  titleText: string
  /** True when the message holds anything at all — image-only messages are not empty. */
  hasContent: boolean
}

function chipCaptionOf(segment: SelectFileTextSegment): PinnedChip | null {
  if (segment.type === 'pasted') {
    // S-257: same caption the transcript chip shows, so the bar never disagrees with the bubble.
    return { kind: 'pasted', label: describePastedBlockLabel(segment.pastedText ?? '') }
  }
  if (segment.type === 'plugin') {
    const label = segment.label || segment.text
    return label ? { kind: 'plugin', label } : null
  }
  if (segment.type === 'file') {
    const parts = segment.text.replace(/\\/g, '/').split('/').filter(Boolean)
    const label = parts[parts.length - 1] || segment.text
    return label ? { kind: 'file', label } : null
  }
  return null
}

export function buildPinnedTurnPreview(content: UnifiedMessage['content']): PinnedTurnPreview {
  const draft = extractEditableUserMessageDraft(content)
  const rawText = draft.text.replace(/\r\n?/g, '\n')

  const chips: PinnedChip[] = []
  const textParts: string[] = []

  // 依赖 parseSelectFileText 的「text 段首尾相接」性质：段是原文的连续切片，
  // 所以 join('') 无损，不会吃字也不会凭空加分隔符。（tests/pinned-turn-preview
  // 的 '读一下  谢谢' 断言就是这条性质的守门 —— 摘掉芯片后留下的是双空格。）
  for (const segment of parseSelectFileText(rawText)) {
    if (segment.type === 'text') {
      if (segment.text) textParts.push(segment.text)
      continue
    }
    const chip = chipCaptionOf(segment)
    if (chip) chips.push(chip)
  }

  const text = textParts.join('').trim()

  return {
    text,
    images: draft.images,
    chips,
    command: draft.command,
    titleText: selectFileTextToPlainText(expandPastedBlocks(rawText)).trim(),
    hasContent:
      text.length > 0 || draft.images.length > 0 || chips.length > 0 || Boolean(draft.command)
  }
}

/**
 * The media line's width budget, in px, from `PinnedTurnBar.tsx`'s real CSS.
 *
 * These have to track the classes there: a thumbnail is `size-7` (28) + `gap-1` (4), a chip is
 * `max-w-[110px]` (110) + `gap-1` (4), and the `+N` badge is ~28 + `gap-1` (4).
 *
 * 400 is the widest line we accept, and it is not arbitrary: "no images + 3 chips" is the
 * widest shape the old implementation ever produced (342 + 28 = 370) and it was never reported
 * as clipped, so keeping it is safe. Everything else must fit inside the same budget.
 */
export const MEDIA_LINE_BUDGET_PX = 400
const THUMBNAIL_SLOT_PX = 32
const CHIP_SLOT_PX = 114
const OVERFLOW_BADGE_PX = 32

/** Never show more than this many of either kind, whatever the budget would allow. */
const MAX_THUMBNAILS = 3
const MAX_CHIPS = 3

export interface PinnedMediaSelection<T> {
  thumbnails: ImageAttachment[]
  chips: T[]
  overflow: number
}

/** Estimated rendered width of one selection — only exists so the regression suite can assert it. */
export function measurePinnedMediaLine(selection: PinnedMediaSelection<unknown>): number {
  const elements = selection.thumbnails.length * THUMBNAIL_SLOT_PX + selection.chips.length * CHIP_SLOT_PX
  return selection.overflow > 0 ? elements + OVERFLOW_BADGE_PX : Math.max(0, elements - 4)
}

/**
 * Pick what fits on the one media line the bar is allowed (R-10.5 keeps it to one line).
 *
 * The budget is spent by **width**, not by element count. Sizing it by count was the original
 * bug: thumbnails are 28px and chips up to 110px, so "4 elements" ranged from 238px to 402px
 * depending on the mix — and the worst case was exactly "1 image + 3 chips", the most common
 * way to compose a message (screenshot + pasted code + a referenced file). That shape ran
 * 402px against `overflow-hidden`, which clips from the right, so the first thing lost was the
 * `+N` badge — the only hint that content was missing.
 *
 * `Math.max(1, …)` because a chip is the informative half of a message; a lone thumbnail plus
 * `+N` says far less than one chip plus `+N`.
 *
 * Generic over the chip shape so the bar can hand in its own list (slash commands included)
 * while the regression suite uses the plain `PinnedChip`.
 */
export function selectPinnedMedia<T>(images: ImageAttachment[], chips: T[]): PinnedMediaSelection<T> {
  const thumbnails = images.slice(0, MAX_THUMBNAILS)
  const budgetForChips = MEDIA_LINE_BUDGET_PX - OVERFLOW_BADGE_PX - thumbnails.length * THUMBNAIL_SLOT_PX
  const chipSlots = Math.max(1, Math.min(MAX_CHIPS, Math.floor(budgetForChips / CHIP_SLOT_PX)))
  const visibleChips = chips.slice(0, chipSlots)
  return {
    thumbnails,
    chips: visibleChips,
    overflow: images.length + chips.length - thumbnails.length - visibleChips.length
  }
}
