import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, ClipboardPaste, FileCode2, Puzzle } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import { parseSelectFileText } from '@renderer/lib/select-file-tags'

interface SelectFileInlineTextProps {
  text: string
  className?: string
  overlay?: boolean
}

export function SelectFileInlineText({
  text,
  className,
  overlay = false
}: SelectFileInlineTextProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const segments = React.useMemo(() => parseSelectFileText(text), [text])
  // T-13: collapsed pastes render as chips and start closed; clicking one
  // reveals the verbatim body. Keyed by segment index (segments never reorder
  // within a rendered message).
  const [expandedPastes, setExpandedPastes] = React.useState<ReadonlySet<number>>(() => new Set())
  const togglePaste = React.useCallback((index: number): void => {
    setExpandedPastes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <React.Fragment key={`${segment.raw}-${index}`}>{segment.text}</React.Fragment>
        }

        if (segment.type === 'pasted') {
          const expanded = expandedPastes.has(index)
          return (
            <span
              key={`${segment.raw}-${index}`}
              className="my-0.5 inline-flex max-w-full flex-col align-top"
            >
              <button
                type="button"
                onClick={() => togglePaste(index)}
                title={
                  expanded
                    ? t('input.pastedBlock.collapse', { defaultValue: '收起' })
                    : t('input.pastedBlock.expandTitle', { defaultValue: '展开为原文' })
                }
                className="mx-0.5 inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 align-baseline text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
              >
                <ClipboardPaste className="size-3 shrink-0" />
                <span className="truncate">{segment.label}</span>
                {expanded ? (
                  <ChevronUp className="size-3 shrink-0" />
                ) : (
                  <ChevronDown className="size-3 shrink-0" />
                )}
              </button>
              {expanded && (
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 p-2 text-left text-[12px] leading-relaxed text-foreground/90">
                  {segment.pastedText}
                </pre>
              )}
            </span>
          )
        }

        const isPlugin = segment.type === 'plugin'
        const Icon = isPlugin ? Puzzle : FileCode2
        const badgeClassName = isPlugin
          ? 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300'
          : 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300'

        if (overlay) {
          return (
            <span key={`${segment.raw}-${index}`} className="relative inline-block align-baseline">
              <span className="invisible">{isPlugin ? segment.text : segment.raw}</span>
              <Badge
                variant="secondary"
                className={cn(
                  'absolute inset-0 inline-flex max-w-full items-center justify-start gap-1 overflow-hidden rounded-md border px-2 py-0 text-[12px] font-medium',
                  badgeClassName
                )}
              >
                <Icon className="size-3 shrink-0" />
                <span className="truncate">{segment.text}</span>
              </Badge>
            </span>
          )
        }

        return (
          <Badge
            key={`${segment.raw}-${index}`}
            variant="secondary"
            className={cn(
              'mx-0.5 inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border align-baseline text-[12px] font-medium',
              badgeClassName
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{segment.text}</span>
          </Badge>
        )
      })}
    </span>
  )
}
