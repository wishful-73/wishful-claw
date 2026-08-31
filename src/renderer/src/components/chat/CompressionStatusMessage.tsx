/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { useLiveCompressionStore } from '@renderer/stores/live-compression-store'
import type { UnifiedMessage } from '@renderer/lib/api/types'

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
  if (!status) return null

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

  const tokenFormatter = new Intl.NumberFormat()
  return (
    <div className="my-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
      {isTerminalFailure || status.summarizerFailed ? (
        <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      )}
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
      {status.summarizerFailed ? (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">
          {t('contextCompression.summarizerFailed', {
            defaultValue: 'Fallback summary used (summarizer unavailable)'
          })}
        </span>
      ) : null}
      {status.error ? <span className="text-[11px] text-muted-foreground">{status.error}</span> : null}
    </div>
  )
}

export function LiveCompressionCard({
  sessionId,
  className
}: {
  sessionId?: string | null
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation('agent')
  const live = useLiveCompressionStore((state) =>
    sessionId ? state.bySessionId[sessionId] : undefined
  )
  const cardRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!live) return
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [live?.draft.length, live?.attempt])

  if (!live) return null

  const retrying = live.attempt > 1 && live.maxAttempts > 1
  const title = retrying
    ? t('contextCompression.summarizingRetry', {
        defaultValue: 'Rewriting summary (attempt {{attempt}}/{{maxAttempts}})…',
        attempt: live.attempt,
        maxAttempts: live.maxAttempts
      })
    : t('contextCompression.summarizing', { defaultValue: 'Writing summary…' })

  return (
    <div ref={cardRef} className={className}>
      <div className="my-2 rounded-md border border-amber-500/30 bg-muted/25 px-3 py-2 text-[12px]">
        <div className="flex items-center gap-2">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        {live.draft ? (
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
            {live.draft}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t('contextCompression.summarizingHint', {
              defaultValue: 'Writing a summary of earlier context…'
            })}
          </p>
        )}
      </div>
    </div>
  )
}
