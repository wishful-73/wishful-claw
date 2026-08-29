/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import Markdown from 'react-markdown'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'

function buildSummaryPreview(content: string): string {
  const firstMeaningfulLine = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return (firstMeaningfulLine ?? content)
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`[\]]/g, '')
    .trim()
}

/**
 * Inline status card rendered in place of a synthetic system message whose
 * `meta.compressionStatus` is set. Two visual modes:
 *  - `compressing` — animated loader while the summarizer is running.
 *  - `compressed`  — green check + count of summarized messages once it succeeds.
 *
 * The actual compactBoundary / compactSummary cards still render separately at
 * the in-history compression point; this card sits at the moment compression
 * happened and acts as a UX confirmation that the run paused, summarized, and
 * resumed without touching prior turns.
 */
export function CompressionStatusMessage({
  message
}: {
  message: UnifiedMessage
}): React.JSX.Element | null {
  const { t } = useTranslation('agent')
  const status = message.meta?.compressionStatus
  const [expanded, setExpanded] = React.useState(false)
  if (!status) return null

  const tokenFormatter = new Intl.NumberFormat()
  const summaryText = status.summaryText?.trim() ?? ''
  const summaryPreview = summaryText ? buildSummaryPreview(summaryText) : ''
  const isTerminalSuccess = status.state === 'compressed'
  const isTerminalFailure =
    status.state === 'failed' || status.state === 'blocked' || status.state === 'cancelled'
  const title =
    status.state === 'compressing'
      ? t('contextCompression.compressing', { defaultValue: 'Compressing context…' })
      : status.state === 'compressed'
        ? t('contextCompression.compressed', { defaultValue: 'Context compressed' })
        : status.state === 'skipped'
          ? t('contextCompression.skipped', { defaultValue: 'Context compression skipped' })
          : status.state === 'blocked'
            ? t('contextCompression.blocked', { defaultValue: 'Context compression blocked' })
            : status.state === 'cancelled'
              ? t('contextCompression.cancelled', { defaultValue: 'Context compression cancelled' })
              : t('contextCompression.failed', { defaultValue: 'Context compression failed' })

  if (status.state === 'compressing') {
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-foreground">{title}</span>
      </div>
    )
  }

  const toggleLabel = expanded
    ? t('contextCompression.summaryCollapse', { defaultValue: 'Collapse summary' })
    : t('contextCompression.summaryExpand', { defaultValue: 'Expand summary' })

  return (
    <div className="my-2 rounded-md border border-border bg-muted/25 px-3 py-2.5 text-[12px]">
      <div className="flex items-start gap-2">
        {isTerminalFailure || status.summarizerFailed ? (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{title}</span>
            {status.trigger ? (
              <span className="rounded border border-border/70 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {status.trigger === 'manual'
                  ? t('contextCompression.triggerManual', { defaultValue: 'Manual' })
                  : t('contextCompression.triggerAuto', { defaultValue: 'Auto' })}
              </span>
            ) : null}
            {typeof status.messagesSummarized === 'number' && status.messagesSummarized > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {t('contextCompression.compressedDetail', {
                  defaultValue: '{{count}} messages compressed',
                  count: status.messagesSummarized
                })}
              </span>
            ) : typeof status.keptMessageCount === 'number' && status.keptMessageCount > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {t('contextCompression.compressedDetail', {
                  defaultValue: '{{count}} messages compressed',
                  count: status.keptMessageCount
                })}
              </span>
            ) : null}
            {typeof status.preTokens === 'number' && status.preTokens > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {t('contextCompression.boundaryPreTokens', {
                  defaultValue: '{{tokens}} tokens at trigger',
                  tokens: tokenFormatter.format(status.preTokens)
                })}
              </span>
            ) : null}
          </div>
          {status.summarizerFailed ? (
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('contextCompression.summarizerFailed', {
                defaultValue: 'Fallback summary used (summarizer unavailable)'
              })}
            </div>
          ) : null}
          {status.error ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{status.error}</div>
          ) : null}
          {summaryPreview && !expanded ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
              {summaryPreview}
            </div>
          ) : null}
        </div>
        {isTerminalSuccess && summaryText ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>
      {expanded && summaryText ? (
        <div className="mt-2 border-t border-border/70 pt-2 prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground dark:prose-invert [&_h1]:mb-2 [&_h1]:mt-1 [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h3]:mb-1 [&_h3]:mt-2 [&_li]:my-0.5 [&_p]:my-1.5 [&_pre]:overflow-x-auto">
          <Markdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>
            {summaryText}
          </Markdown>
        </div>
      ) : null}
    </div>
  )
}
