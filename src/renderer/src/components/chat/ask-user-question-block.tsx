/**
 * PreviewPane and QuestionBlock components for AskUserQuestionCard.
 * Extracted from AskUserQuestionCard.tsx per AGENTS.md file splitting guidelines.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import {
  Check,
  Sparkles,
  PanelRight,
  ListChecks
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Badge } from '@renderer/components/ui/badge'
import { Textarea } from '@renderer/components/ui/textarea'
import type { AskUserQuestionItem } from '@renderer/lib/tools/ask-user-tool'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  SAFE_LINK_COMPONENTS
} from '@renderer/lib/preview/viewers/markdown-components'
import {
  getOptionLabel,
  isRecommendedOptionLabel,
  stripRecommendedMarker
} from './ask-user-utils'

export function looksLikeHtmlPreview(preview: string): boolean {
  return /<\s*[a-z!][^>]*>/i.test(preview)
}

export function buildPreviewDocument(preview: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.45;
        padding: 12px;
        background: transparent;
      }
      * { box-sizing: border-box; }
    </style>
  </head>
  <body>${preview}</body>
</html>`
}

export function PreviewPane({ preview }: { preview: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isHtml = looksLikeHtmlPreview(preview)

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <PanelRight className="size-3.5 text-primary/80" />
        <div className="text-xs font-medium text-foreground">{t('askUser.previewTitle')}</div>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {isHtml ? 'HTML' : 'Markdown'}
        </Badge>
      </div>
      {isHtml ? (
        <iframe
          title="Ask user question preview"
          sandbox=""
          srcDoc={buildPreviewDocument(preview)}
          className="h-56 w-full rounded-lg border border-border/60 bg-background"
        />
      ) : (
        <div className="max-h-56 overflow-auto rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-muted prose-pre:px-3 prose-pre:py-2 prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:font-mono prose-pre:font-mono">
            <Markdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              components={SAFE_LINK_COMPONENTS}
            >
              {preview}
            </Markdown>
          </div>
        </div>
      )}
    </div>
  )
}

export function QuestionBlock({
  index,
  item,
  selected,
  customText,
  notes,
  hoveredOption,
  onToggle,
  onCustomTextChange,
  onNotesChange,
  onHoverOption,
  disabled
}: {
  index: number
  item: AskUserQuestionItem
  selected: Set<string>
  customText: string
  notes: string
  hoveredOption?: string | null
  onToggle: (index: number, value: string) => void
  onCustomTextChange: (index: number, text: string) => void
  onNotesChange: (index: number, text: string) => void
  onHoverOption: (index: number, value: string | null) => void
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isOtherSelected = selected.has('__other__')
  const selectedLabels = [...selected].filter((value) => value !== '__other__')
  const selectedOption =
    !item.multiSelect && selectedLabels.length === 1
      ? item.options?.find((option) => option.label === selectedLabels[0])
      : undefined
  const hoveredPreviewOption =
    !item.multiSelect && hoveredOption
      ? item.options?.find((option) => option.label === hoveredOption)
      : undefined
  const selectedPreview = hoveredPreviewOption?.preview ?? selectedOption?.preview
  const showNotes = !!item.options?.length && selectedLabels.length > 0 && !isOtherSelected

  return (
    <div
      className={cn(
        'grid gap-3',
        selectedPreview && 'lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]'
      )}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          {item.header && (
            <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-medium">
              {item.header}
            </Badge>
          )}
          <p className="text-[13px] font-semibold leading-tight text-foreground">{item.question}</p>
        </div>

        {item.options && item.options.length > 0 && (
          <div className="space-y-1.5">
            {item.options.map((opt, oi) => {
              const value = getOptionLabel(opt.label)
              if (!value) return null

              const isSelected = selected.has(value)
              const isRecommended = isRecommendedOptionLabel(value)
              return (
                <button
                  key={oi}
                  disabled={disabled}
                  onClick={() => onToggle(index, value)}
                  onMouseEnter={() => onHoverOption(index, value)}
                  onFocus={() => onHoverOption(index, value)}
                  onMouseLeave={() => onHoverOption(index, null)}
                  onBlur={() => onHoverOption(index, null)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-tight transition-all',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                      : 'border-border/80 bg-background/80 hover:border-primary/50 hover:bg-muted/40 hover:shadow-sm',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-all',
                      item.multiSelect ? 'rounded-md' : 'rounded-full',
                      isSelected
                        ? 'scale-105 border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 bg-background'
                    )}
                  >
                    {isSelected && <Check className="size-3 stroke-[2.5]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div
                        className={cn(
                          'font-medium transition-colors',
                          isSelected ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {stripRecommendedMarker(opt.label)}
                      </div>
                      {isRecommended && (
                        <Badge
                          variant="outline"
                          className="border-primary/30 text-[10px] text-primary"
                        >
                          <Sparkles className="size-3" />
                          {t('askUser.recommended')}
                        </Badge>
                      )}
                      {opt.preview && !item.multiSelect && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          <PanelRight className="size-3" />
                          {t('askUser.previewBadge')}
                        </Badge>
                      )}
                    </div>
                    {opt.description && (
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                        {opt.description}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
            <button
              disabled={disabled}
              onClick={() => onToggle(index, '__other__')}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-tight transition-all',
                isOtherSelected
                  ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                  : 'border-border/80 bg-background/80 hover:border-primary/50 hover:bg-muted/40 hover:shadow-sm',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-all',
                  item.multiSelect ? 'rounded-md' : 'rounded-full',
                  isOtherSelected
                    ? 'scale-105 border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40 bg-background'
                )}
              >
                {isOtherSelected && <Check className="size-3 stroke-[2.5]" />}
              </span>
              <span
                className={cn(
                  'font-medium transition-colors',
                  isOtherSelected ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {t('askUser.other')}
              </span>
            </button>
          </div>
        )}

        {(!item.options || item.options.length === 0 || isOtherSelected) && (
          <Textarea
            disabled={disabled}
            value={customText}
            onChange={(e) => onCustomTextChange(index, e.target.value)}
            placeholder={t('askUser.answerPlaceholder')}
            rows={3}
            className={cn(
              'min-h-[84px] rounded-xl border bg-background/70 text-sm shadow-none',
              'placeholder:text-muted-foreground/50',
              'focus-visible:ring-2 focus-visible:ring-primary/25',
              disabled && 'cursor-not-allowed bg-muted/20 opacity-50'
            )}
          />
        )}

        {showNotes && (
          <div className="space-y-1.5 rounded-xl border border-dashed border-border/70 bg-muted/10 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <ListChecks className="size-3.5" />
              {t('askUser.notesTitle')}
            </div>
            <Textarea
              disabled={disabled}
              value={notes}
              onChange={(e) => onNotesChange(index, e.target.value)}
              placeholder={t('askUser.notesPlaceholder')}
              rows={3}
              className={cn(
                'min-h-[76px] rounded-lg border bg-background/80 text-sm shadow-none',
                'placeholder:text-muted-foreground/50',
                'focus-visible:ring-2 focus-visible:ring-primary/25',
                disabled && 'cursor-not-allowed bg-muted/20 opacity-50'
              )}
            />
          </div>
        )}
      </div>

      {selectedPreview && <PreviewPane preview={selectedPreview} />}
    </div>
  )
}

