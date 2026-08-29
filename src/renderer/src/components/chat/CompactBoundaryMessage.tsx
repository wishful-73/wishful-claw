import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveRestore } from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'

/**
 * Inline divider marking the point where the model context switched from the
 * full history to the compressed view. The expandable summary body itself is
 * rendered by <ContextCompressionMessage> right after this divider; this card
 * only carries the boundary metadata (trigger, summarized count, pre-tokens).
 */
export function CompactBoundaryMessage({
  message
}: {
  message: UnifiedMessage
}): React.JSX.Element | null {
  const { t } = useTranslation('agent')
  const boundary = message.meta?.compactBoundary
  if (!boundary) return null

  const tokenFormatter = new Intl.NumberFormat()
  const triggerLabel =
    boundary.trigger === 'manual'
      ? t('contextCompression.triggerManual', { defaultValue: 'Manual' })
      : t('contextCompression.triggerAuto', { defaultValue: 'Auto' })

  return (
    <div className="my-3 flex items-center gap-2" aria-hidden={false}>
      <div className="h-px flex-1 bg-border" />
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        <ArchiveRestore className="size-3 shrink-0" />
        <span className="font-medium">
          {t('contextCompression.boundaryTitle', {
            defaultValue: 'Context compressed from here'
          })}
        </span>
        {boundary.messagesSummarized > 0 ? (
          <span>
            ·{' '}
            {t('contextCompression.boundarySummarized', {
              defaultValue: '{{count}} messages summarized',
              count: boundary.messagesSummarized
            })}
          </span>
        ) : null}
        {boundary.preTokens > 0 ? (
          <span>· {tokenFormatter.format(boundary.preTokens)} tokens</span>
        ) : null}
        <span>· {triggerLabel}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
