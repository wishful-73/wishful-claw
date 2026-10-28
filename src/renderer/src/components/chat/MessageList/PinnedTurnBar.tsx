import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, FileCode2, Puzzle, Terminal, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { PinnedChipKind } from '@renderer/lib/pinned-turn-preview'
import { buildPinnedTurnPreview, selectPinnedMedia } from '@renderer/lib/pinned-turn-preview'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { USER_MESSAGE_BUBBLE_CLASS } from '../user-message-helpers'

/**
 * S-255: the pinned indicator bar shows a **compact copy** of the user message it points at —
 * images as thumbnails, collapsed pastes / selected files / plugins / slash commands as chips,
 * then at most two lines of text. Before this it read `.text` only, so images disappeared, the
 * tag markup leaked into the caption, and an image-only message rendered the empty state.
 *
 * R-10.5 (iter-v2-28) still holds: this is an indicator, not a second bubble. Nothing inside is
 * interactive — the whole bar is one button that jumps back to the message.
 */

const TITLE_TEXT_LIMIT = 400

interface BarChip {
  kind: PinnedChipKind
  label: string
}

const CHIP_TONE: Record<PinnedChipKind, string> = {
  command: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  pasted: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  file: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  plugin: 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300'
}

const CHIP_ICON: Record<PinnedChipKind, LucideIcon> = {
  command: Terminal,
  pasted: ClipboardPaste,
  file: FileCode2,
  plugin: Puzzle
}

function OverflowBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
      +{count}
    </span>
  )
}

interface PinnedTurnBarProps {
  message: UnifiedMessage
  onJump: () => void
}

export function PinnedTurnBar({ message, onJump }: PinnedTurnBarProps): React.JSX.Element {
  const { t, i18n } = useTranslation('chat')
  // 芯片文案（尤其是粘贴块的「N 字」）由 `translateOr` 现算，所以要跟着语言变 ——
  // message.content 不变时 memo 不会重算，必须把当前语言也放进依赖。
  const preview = React.useMemo(
    () => buildPinnedTurnPreview(message.content),
    [message.content, i18n.language]
  )

  const chips: BarChip[] = [
    ...(preview.command ? [{ kind: 'command' as const, label: `/${preview.command.name}` }] : []),
    ...preview.chips
  ]
  const media = selectPinnedMedia(preview.images, chips)

  const title = [
    preview.command ? `/${preview.command.name}` : '',
    preview.titleText
      ? preview.titleText.length > TITLE_TEXT_LIMIT
        ? `${preview.titleText.slice(0, TITLE_TEXT_LIMIT)}…`
        : preview.titleText
      : '',
    preview.images.length > 0
      ? t('messageList.pinnedTurnImageCount', { count: String(preview.images.length) })
      : ''
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      onClick={onJump}
      title={title || undefined}
      className={cn(
        USER_MESSAGE_BUBBLE_CLASS,
        'ml-auto block w-fit max-w-full cursor-pointer text-left text-sm leading-snug'
      )}
    >
      {(media.thumbnails.length > 0 || media.chips.length > 0) && (
        // `<span>` 而不是 `<div>`：整块外层是 `<button>`，它的 content model 只允许
        // phrasing content，`div` 会被 HTML 校验与部分 a11y 工具判非法。`flex` 让
        // display 照旧，视觉零变化。
        <span className="mb-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden pl-0.5">
          {media.thumbnails.map((image) => (
            <img
              key={image.id}
              src={image.dataUrl}
              alt=""
              aria-hidden
              className="size-7 shrink-0 rounded border border-border/60 object-cover"
            />
          ))}
          {media.chips.map((chip, index) => {
            const Icon = CHIP_ICON[chip.kind]
            return (
              <span
                key={`${chip.kind}-${index}-${chip.label}`}
                className={cn(
                  'inline-flex max-w-[110px] shrink-0 items-center gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                  CHIP_TONE[chip.kind]
                )}
              >
                <Icon className="size-3 shrink-0" />
                <span className="truncate">{chip.label}</span>
              </span>
            )
          })}
          {media.overflow > 0 && <OverflowBadge count={media.overflow} />}
        </span>
      )}
      {preview.text ? (
        <span className="line-clamp-2 whitespace-pre-wrap break-words">{preview.text}</span>
      ) : !preview.hasContent ? (
        <span className="text-xs text-muted-foreground">
          {t('messageList.pinnedTurnEmpty')}
        </span>
      ) : null}
    </button>
  )
}
