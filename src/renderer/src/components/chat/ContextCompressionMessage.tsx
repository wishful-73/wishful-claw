import * as React from 'react'
import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, Scissors } from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import {
  getCompactSummaryDisplayText,
  isCompactSummaryLikeMessage
} from '@renderer/lib/agent/context-compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'

export function ContextCompressionMessage({
  message
}: {
  message: UnifiedMessage
}): React.JSX.Element | null {
  const { t } = useTranslation('agent')
  const [expanded, setExpanded] = React.useState(false)

  if (!isCompactSummaryLikeMessage(message)) {
    return null
  }

  const content = getCompactSummaryDisplayText(message).trim()
  if (!content) return null

  const meta = message.meta?.compactSummary
  const summarizedCount = meta?.messagesSummarized ?? 0
  const toggleLabel = expanded
    ? t('contextCompression.summaryCollapse', { defaultValue: 'Collapse summary' })
    : t('contextCompression.summaryExpand', { defaultValue: 'Expand summary' })
  const dividerLabel =
    summarizedCount > 0
      ? t('contextCompression.dividerWithCount', {
          defaultValue: 'Context compressed · {{count}} earlier messages summarized',
          count: summarizedCount
        })
      : t('contextCompression.divider', { defaultValue: 'Context compressed' })

  return (
    <div className="my-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/40" />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title={toggleLabel}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
        >
          <Scissors className="size-3" />
          {dividerLabel}
          <ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/40" />
      </div>
      {meta?.summarizerFailed ? (
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-3" />
          {t('contextCompression.summaryFallbackWarning', {
            defaultValue: 'Summary generation failed; fallback summary used and context remains compressed'
          })}
        </div>
      ) : null}
      {expanded ? (
        <div className="mt-2 rounded-md border border-border bg-muted/25 px-3 py-2.5 prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground dark:prose-invert [&_h1]:mb-2 [&_h1]:mt-1 [&_h1]:text-base [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_li]:my-0.5 [&_p]:my-1.5 [&_pre]:overflow-x-auto">
          <Markdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>
            {content}
          </Markdown>
        </div>
      ) : null}
    </div>
  )
}
