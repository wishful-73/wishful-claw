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

/** How many media slots the bar can show before it has to fold the rest into `+N`. */
const MAX_THUMBNAILS = 3
const MAX_CHIPS = 3
/** Total elements allowed on the single media line — thumbnails and chips share the budget. */
const MAX_MEDIA_SLOTS = 4

export interface PinnedMediaSelection<T> {
  thumbnails: ImageAttachment[]
  chips: T[]
  overflow: number
}

/**
 * Pick what fits on the one media line the bar is allowed (R-10.5 keeps it to one line).
 *
 * Thumbnails and chips share a fixed slot budget rather than getting one each: with both
 * generous the line ran ~410px wide and `overflow-hidden` clipped the `+N` badge — the only
 * hint that content was missing — on any narrow window. Four slots keeps the worst case
 * under ~300px while still showing something of every kind that is present.
 *
 * Generic over the chip shape so the bar can hand in its own list (slash commands included)
 * while the regression suite uses the plain `PinnedChip`.
 */
export function selectPinnedMedia<T>(images: ImageAttachment[], chips: T[]): PinnedMediaSelection<T> {
  const thumbnails = images.slice(0, MAX_THUMBNAILS)
  const chipSlots = Math.max(1, Math.min(MAX_CHIPS, MAX_MEDIA_SLOTS - thumbnails.length))
  const visibleChips = chips.slice(0, chipSlots)
  return {
    thumbnails,
    chips: visibleChips,
    overflow: images.length + chips.length - thumbnails.length - visibleChips.length
  }
}
