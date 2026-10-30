/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, TriangleAlert } from 'lucide-react'
import type { ToolCallStatus } from '@renderer/lib/agent/types'
import type { ImageBlock, TextBlock, ToolResultContent } from '@renderer/lib/api/types'
import type { CompactToolHeaderModel } from './CompactToolCallHeader'
import { CompactToolCallHeader } from './CompactToolCallHeader'
import { ImagePreview } from './ImagePreview'
import { getToolIcon } from './BrowserToolCard/icons'
import { resolveToolDisplayName } from '@renderer/lib/tools/tool-display-name'
import { resolveImageBlockSource } from '@renderer/lib/tools/image-block-source'
import {
  PREVIEW_LIMIT,
  buildSummary,
  getMainPreview,
  getResultRows,
  lineCount,
  parseErrorMessage,
  parseStructuredOutput,
  statusLabel
} from './BrowserToolCard/summary'

interface BrowserToolCardProps {
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  forceOpen?: boolean
}

const CONTENT_TRANSITION = {
  duration: 0.18,
  ease: 'easeOut' as const
}

export function BrowserToolCard({
  name,
  input,
  output,
  status,
  error,
  forceOpen = false
}: BrowserToolCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const jsonOutput = parseStructuredOutput(output)
  const canceledMessage =
    status === 'canceled'
      ? t('toolCall.noResult', { defaultValue: 'No tool result available' })
      : null
  const parsedError = error || parseErrorMessage(output) || canceledMessage
  const isRunning = status === 'streaming' || status === 'pending_approval' || status === 'running'
  const hasError = status === 'error' || status === 'canceled' || Boolean(parsedError)

  const { images, notes } = useMemo(() => {
    if (!Array.isArray(output)) {
      return { images: [] as ImageBlock[], notes: [] as TextBlock[] }
    }

    return {
      images: output.filter((block): block is ImageBlock => block.type === 'image'),
      notes: output.filter((block): block is TextBlock => block.type === 'text')
    }
  }, [output])

  const autoOpenKey = `${isRunning ? 'active' : 'idle'}:${images.length}`
  const [openState, setOpenState] = useState<{ key: string; open: boolean }>(() => ({
    key: autoOpenKey,
    open: forceOpen || images.length > 0
  }))
  const open =
    forceOpen || (openState.key === autoOpenKey ? openState.open : images.length > 0)

  const summary = buildSummary(name, input, jsonOutput, notes, t)
  const mainPreview = getMainPreview(name, jsonOutput)
  const resultRows = getResultRows(name, jsonOutput)
  const rawOutput = typeof output === 'string' && !jsonOutput && !parsedError ? output : ''
  // S-270：`fallbackTitle` 末行原来是 `return name`，于是新浏览器工具（如 BrowserEvaluate）
  // 直接把裸 camelCase 顶上去。统一出口后兜底成「工具 · 原名」。
  const title = t(`toolCall.browser.${name}.title`, {
    defaultValue: resolveToolDisplayName(name, t)
  })
  const badges: CompactToolHeaderModel['badges'] = []

  if (images.length > 0) {
    badges.push({ label: t('toolCall.imageFile'), tone: 'blue' })
  }
  if (mainPreview) {
    badges.push({
      label: t('toolCall.lineCount', { count: lineCount(mainPreview.content) }),
      tone: 'blue'
    })
  }

  const model: CompactToolHeaderModel = {
    icon: getToolIcon(name),
    primary: summary || title,
    secondary: summary ? title : undefined,
    badges,
    title: [title, summary].filter(Boolean).join('\n')
  }

  return (
    <div className="my-0 min-w-0 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          if (forceOpen) return
          setOpenState({
            key: autoOpenKey,
            open: !open
          })
        }}
        className="group w-full rounded-md px-2 py-0.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-accent/50"
      >
        <CompactToolCallHeader
          model={model}
          status={status}
          statusLabel={statusLabel(status, t)}
          hasError={hasError}
          errorTitle={parsedError}
          elapsed={null}
          open={open}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={CONTENT_TRANSITION}
            className="mt-0.5 overflow-hidden pl-4"
          >
            <div className="space-y-2 pb-0.5">
              {isRunning ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>
                    {t('toolCall.browser.executing', {
                      defaultValue: 'Executing browser action...'
                    })}
                  </span>
                </div>
              ) : null}

              {hasError ? (
                <div className="rounded-md border border-destructive/25 bg-destructive/[0.035] px-2.5 py-2 text-xs text-destructive">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="break-words">{parsedError}</span>
                  </div>
                </div>
              ) : null}

              {images.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('toolCall.browser.screenshotPreview', {
                      defaultValue: 'Screenshot preview'
                    })}
                  </p>
                  {images.map((image, index) => {
                    // S-284：落库副本里 base64 会被剥掉，重开会话只剩 filePath。
                    const src = resolveImageBlockSource(image)?.src ?? ''
                    if (!src && !image.source.filePath) return null
                    return (
                      <ImagePreview
                        key={`${image.source.filePath ?? src}-${index}`}
                        src={src}
                        alt={`Browser screenshot ${index + 1}`}
                        filePath={image.source.filePath}
                      />
                    )
                  })}
                </div>
              ) : null}

              {resultRows.length > 0 ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {resultRows.map((row) => (
                    <div key={row.labelKey} className="min-w-0 rounded-md bg-muted/20 px-2 py-1.5">
                      <p className="text-[9px] font-medium uppercase text-muted-foreground/60">
                        {t(row.labelKey, { defaultValue: row.fallbackLabel })}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-foreground" title={row.value}>
                        {row.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {mainPreview ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(mainPreview.labelKey, { defaultValue: mainPreview.fallbackLabel })}
                    </p>
                    {mainPreview.truncated ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground/65">
                        {t('toolCall.browser.previewTruncated', {
                          count: PREVIEW_LIMIT,
                          defaultValue: `first ${PREVIEW_LIMIT} chars`
                        })}
                      </span>
                    ) : null}
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-md bg-muted/20 px-2.5 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
                    {mainPreview.content}
                  </pre>
                </div>
              ) : null}

              {rawOutput ? (
                <pre className="max-h-44 overflow-auto rounded-md bg-muted/20 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap break-words">
                  {rawOutput}
                </pre>
              ) : null}

              {notes.length > 0 ? (
                <div className="space-y-1.5">
                  {notes.map((note, index) => (
                    <p
                      key={`${note.text}-${index}`}
                      className="rounded-md bg-muted/20 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
                    >
                      {note.text}
                    </p>
                  ))}
                </div>
              ) : null}

              <details className="group/input">
                <summary className="cursor-pointer select-none text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  {t('toolCall.browser.input', { defaultValue: 'Input' })}
                </summary>
                <pre className="mt-1.5 max-h-36 overflow-auto rounded-md bg-muted/20 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap break-words">
                  {JSON.stringify(input, null, 2)}
                </pre>
              </details>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
