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
 * Everything below is derived from the classes in that file, not the other way round — the
 * regression suite asserts against this, so a constant that disagrees with the CSS makes the
 * whole suite meaningless.
 *
 * `pl-0.5` (0.125rem), `size-7` (1.75rem) and `gap-1` (0.25rem) are **rem**, so they scale with
 * the root font size; `max-w-[110px]` and `text-[11px]` are **fixed px**. The settings page lets
 * the root size go 12–20, so "fits" has to hold at every step of that range, not just at 16.
 * Sizing this purely in px constants was the first version's mistake: it read 356 for a line
 * that really renders 381 at root 20, i.e. it would have passed a budget it should have failed.
 *
 * 400 is the widest line we accept, and it is not arbitrary: "no images + 3 chips" is the
 * widest shape the old implementation ever produced (342 + 28 = 370) and it was never reported
 * as clipped, so keeping it is safe. The worst shape the *current* selector can emit is
 * "3 images + 2 chips + badge": pl 2.5 + 3×35 + 2×110 + 5 gaps×5 + badge 37 = **389.5** at root
 * 20 (360 at root 16) — inside 400 at both ends, but the headroom is only 10.5px, so neither the
 * font-size ceiling nor the badge width has room to grow. The suite pins both numbers.
 */
export const MEDIA_LINE_BUDGET_PX = 400

/** Chip slot for budget arithmetic: its `max-w-[110px]` plus one `gap-1` at root 16. */
const CHIP_SLOT_PX = 114
/** Thumbnail slot for budget arithmetic: its `size-7` plus one `gap-1` at root 16. */
const THUMBNAIL_SLOT_PX = 32
/** `+N` badge plus one `gap-1` at root 16. */
const OVERFLOW_BADGE_PX = 32

// The same geometry expressed the way the CSS is written (rem relative to the root size), used
// only by `measurePinnedMediaLine`. `PL_REM` is the container's `pl-0.5`.
const PL_REM = 0.125
const THUMBNAIL_REM = 1.75
const GAP_REM = 0.25
const CHIP_MAX_PX = 110
// `+N` badge: `border` on both sides, `px-1.5` on both sides, and the `+N` glyphs at `text-[11px]`
// (fixed px). Two digits is the realistic width — `+15` at 11px runs ≈19.3px with letter-spacing,
// so 20 is the honest figure; over-estimating only makes the assertion stricter, which is the safe
// direction.
const BADGE_BORDER_PX = 2
const BADGE_PADDING_REM = 0.375
const BADGE_TEXT_PX = 20

/** Never show more than this many of either kind, whatever the budget would allow. */
const MAX_THUMBNAILS = 3
const MAX_CHIPS = 3

export interface PinnedMediaSelection<T> {
  thumbnails: ImageAttachment[]
  chips: T[]
  overflow: number
}

/**
 * Rendered width of one selection, in px — only exists so the regression suite can assert it.
 *
 * This is the real flex geometry from `PinnedTurnBar.tsx`: the row is
 * `pl + Σ items + gaps × gap`, where `gaps` is the number of adjacent pairs actually rendered —
 * **the `+N` badge is one of those items**, it sits in the same flex container and eats its own
 * gap. So with a badge there are `items` gaps, without one `items − 1`. Forgetting the badge's gap
 * made this read 4px wide at root 16 and 5px at root 20 — the same direction of error (a ruler that
 * under-reports) as the first version, which is exactly what this function exists to prevent.
 *
 * The previous version approximated the row as `Σ slot widths ± 4`, which was wrong in both
 * directions — it read 174 for a 159.5px line at root 12 and 356 for a 381px line at root 20.
 * Pass the root font size in, because three of the four dimensions are rem and therefore move
 * with it.
 */
export function measurePinnedMediaLine(
  selection: PinnedMediaSelection<unknown>,
  rootFontSizePx = 16
): number {
  const items = selection.thumbnails.length + selection.chips.length
  // The row itself is only rendered when there is at least one item, so zero items is zero width.
  if (items === 0) return 0

  const r = rootFontSizePx
  const hasBadge = selection.overflow > 0
  // Items on the line: thumbnails + chips + the badge when it shows. Gaps sit *between* them.
  const itemsOnLine = hasBadge ? items + 1 : items
  let width = PL_REM * r
  width += selection.thumbnails.length * THUMBNAIL_REM * r
  width += selection.chips.length * CHIP_MAX_PX
  width += (itemsOnLine - 1) * GAP_REM * r
  if (hasBadge) {
    width += BADGE_BORDER_PX + BADGE_PADDING_REM * 2 * r + BADGE_TEXT_PX
  }
  return width
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
 * The slot constants are quoted at root 16 while the real line grows with the root font size, so
 * this deliberately over-allocates at large sizes and under-allocates at small ones. That is fine
 * because the result is re-measured by `measurePinnedMediaLine` at every root size in
 * `settings.fontSize`'s range: the selector's worst output ("3 images + 2 chips + badge") is 381.5
 * at root 20, still inside the 400 budget. If the budget ever tightens, that pair has to be
 * re-derived together — they are two halves of one constraint.
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
