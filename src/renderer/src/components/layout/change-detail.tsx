import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileCode, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { CodeDiffViewer } from '@renderer/components/chat/CodeDiffViewer'
import { type LoadedChangeContent, isLoadedChangeContent } from '@renderer/components/chat/change-summary-utils'
import { buildDiffCopyText, canRenderInlineSnapshot, computeDiff, detectLang, foldContext, lineCount, snapshotText, type AggregatedFileChange } from '@renderer/components/chat/file-change-utils'
import { isErrorResult } from './session-change-utils'
import { loadAggregatedChangeContent } from '../chat/change-summary-utils'

export function CopyIconButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [copied, setCopied] = React.useState(false)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
      title={t('action.copy')}
      aria-label={t('action.copy')}
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
    </Button>
  )
}

export function ReviewEmptyState(): React.JSX.Element {
  const { t } = useTranslation('layout')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl border border-border/60 bg-muted/20">
        <FileCode className="size-7 text-muted-foreground/50" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {t('rightPanel.reviewEmptyTitle', { defaultValue: 'No file changes yet' })}
        </p>
        <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
          {t('rightPanel.reviewEmptyDesc', {
            defaultValue:
              'Latest diffs are unavailable. File changes for this session will appear here.'
          })}
        </p>
      </div>
    </div>
  )
}

export function ChangeDetail({ change }: { change: AggregatedFileChange }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [loadedContent, setLoadedContent] = React.useState<LoadedChangeContent | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const shouldLoadFullContent =
    change.op === 'create'
      ? !canRenderInlineSnapshot(change.after)
      : !canRenderInlineSnapshot(change.before) || !canRenderInlineSnapshot(change.after)

  React.useEffect(() => {
    if (!shouldLoadFullContent) {
      setLoadedContent(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    const load = async (): Promise<void> => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await loadAggregatedChangeContent(change)
        if (cancelled) return

        if (isLoadedChangeContent(result)) {
          setLoadedContent(result)
          return
        }

        setLoadError(
          isErrorResult(result)
            ? result.error
            : t('fileChange.loadDiffFailed', { defaultValue: 'Failed to load the full diff' })
        )
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [change, shouldLoadFullContent, t])

  const beforeText =
    loadedContent?.beforeText ?? (change.op === 'modify' ? snapshotText(change.before) : '')
  const afterText = loadedContent?.afterText ?? snapshotText(change.after)
  const diffLines = React.useMemo(() => computeDiff(beforeText, afterText), [afterText, beforeText])
  const diffChunks = React.useMemo(() => foldContext(diffLines), [diffLines])
  const diffCopyText = React.useMemo(() => buildDiffCopyText(diffLines), [diffLines])

  if (isLoading && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border/60 bg-muted/15 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin text-emerald-400" />
        {t('thinking.thinkingEllipsis')}
      </div>
    )
  }

  if (loadError && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-300">
          {detectLang(change.filePath)}
        </span>
        <span>{t('fileChange.lineCount', { count: lineCount(afterText) })}</span>
        {diffCopyText ? <CopyIconButton text={diffCopyText} /> : null}
      </div>
      <CodeDiffViewer chunks={diffChunks} defaultMode="inline" showModeToggle toolbarEnd={null} />
    </div>
  )
}

