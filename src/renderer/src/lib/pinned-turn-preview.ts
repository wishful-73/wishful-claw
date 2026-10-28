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

  for (const segment of parseSelectFileText(rawText)) {
    if (segment.type === 'text') {
      if (segment.text) textParts.push(segment.text)
      continue
    }
    const chip = chipCaptionOf(segment)
    if (chip) chips.push(chip)
  }

  // 各 text 段原样接起来（段内的换行已经带着），芯片不再以标签形式出现在正文里。
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
