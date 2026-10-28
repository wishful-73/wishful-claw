// 500 行豁免（2026-10-28 实测 514 行）：文件变更卡的 diff 预览 / 落盘快照 / 撤销
// 三条链路读的是同一份 `trackedChange` 与同一份折叠态，拆开就得把 tracked 再拷贝一遍，
// 而撤销按钮的可见性又依赖 diff 是否可渲染 —— 判定跨文件必然对不齐。
// 依据 AGENTS.md §大文件拆分 第 5 条第 1 类（单一呈现单元，状态机不可切）。
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { useAgentStore } from '@renderer/stores/agent-store'
import { deriveFileChangeCollapsed } from './render-density'
import { useDensityOverride, useDensityPolicy } from './use-density-override'
import { MONO_FONT } from '@renderer/lib/constants'
import { formatDurationMs } from '@renderer/lib/format-duration'
import { Button } from '@renderer/components/ui/button'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { type FileChangeCardProps, type CompactActionOp, shortPath, fileName, snapshotText, canRenderInlineSnapshot, resolveEditPayload, resolveWritePayload, hasPendingEditPreviewContent, resolveEditSummaryDiff, trackedStatusLabelKey, trackedTransportLabelKey, trackedStatusTone, trackedStatusDotTone } from './FileChangeCard/utils'

// ── Types ────────────────────────────────────────────────────────
import { NewFileContent, SnapshotSummaryNotice, PendingEditPreview, PendingWritePreview } from './file-change-previews'
import { CompactEditDiff, InlineDiff, TrackedEditDiff } from './file-change-diff'
import { StatusIndicator, CompactStatusDot, FileIcon, ChangeStats, WriteRealtimeStats } from './file-change-stats'

export function FileChangeCard({
  name,
  input,
  output,
  status,
  error,
  startedAt,
  completedAt,
  trackedChange,
  forceOpen = false
}: FileChangeCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const resolvedEdit = React.useMemo(() => resolveEditPayload(input), [input])
  const resolvedWrite = React.useMemo(() => resolveWritePayload(input), [input])
  const isActive = status === 'streaming' || status === 'running' || status === 'pending_approval'
  const isRealtimeWrite =
    name === 'Write' && !trackedChange && (status === 'streaming' || status === 'running')
  // S-225：默认折叠态由全局档位派生（纯文本 / 紧凑折叠，详情展开）；手动开合在本档内有效。
  const { density } = useDensityPolicy()
  const [collapsed, setCollapsed] = useDensityOverride<boolean>(() =>
    deriveFileChangeCollapsed(density, forceOpen)
  )
  const undoFileChange = useAgentStore((state) => state.undoFileChange)
  const [isUndoingFile, setIsUndoingFile] = React.useState(false)

  const filePath = String(input.file_path ?? input.path ?? '')
  const elapsed =
    startedAt && completedAt
      ? // S-245：统一走 formatDurationMs，秒档不带小数
        formatDurationMs(completedAt - startedAt)
      : null
  const outputStr = typeof output === 'string' ? output : undefined
  const isFileActionable = trackedChange?.status === 'open'
  const parsedOutput = outputStr ? decodeStructuredToolResult(outputStr) : null
  const parsedOutputError =
    parsedOutput && !Array.isArray(parsedOutput) && typeof parsedOutput.error === 'string'
      ? parsedOutput.error.trim()
      : null
  const canceledMessage =
    status === 'canceled'
      ? t('toolCall.noResult', { defaultValue: 'No tool result available' })
      : null
  const isSuccess = !!(
    parsedOutput &&
    !Array.isArray(parsedOutput) &&
    parsedOutput.success === true
  )
  const outputWriteOp =
    trackedChange?.op ??
    (parsedOutput &&
    !Array.isArray(parsedOutput) &&
    (parsedOutput.op === 'create' || parsedOutput.op === 'modify')
      ? (parsedOutput.op as 'create' | 'modify')
      : undefined)
  const effectiveWriteOp = name === 'Write' ? (outputWriteOp ?? 'modify') : undefined
  const compactActionOp: CompactActionOp =
    name === 'Delete' ? 'delete' : name === 'Write' ? (effectiveWriteOp ?? 'modify') : 'modify'
  const hasFailureStatus = status === 'error' || status === 'canceled'
  const compactActionLabel = hasFailureStatus
    ? status === 'canceled'
      ? t('toolCall.canceled', { defaultValue: 'Canceled' })
      : t('error.label', { defaultValue: 'Error' })
    : compactActionOp === 'create'
      ? isActive
        ? t('fileChange.creating')
        : t('fileChange.created')
      : compactActionOp === 'delete'
        ? isActive
          ? t('fileChange.deleting')
          : t('fileChange.deleted')
        : isActive
          ? t('fileChange.editing')
          : t('fileChange.edited')
  const isOutputError = outputStr
    ? Boolean(parsedOutputError) || (!parsedOutput && outputStr.length > 0)
    : false
  const hasCompactError = hasFailureStatus || (isOutputError && !isSuccess)
  const compactEditDiff = React.useMemo(
    () => resolveEditSummaryDiff(resolvedEdit, trackedChange),
    [resolvedEdit, trackedChange]
  )
  const useCompactChangeLayout = name === 'Edit' || name === 'Delete' || name === 'Write'
  const compactActiveShellClass = 'bg-background/75 dark:bg-white/[0.035]'
  const canRenderTrackedWriteDiff =
    !!trackedChange &&
    trackedChange.op === 'modify' &&
    canRenderInlineSnapshot(trackedChange.before) &&
    canRenderInlineSnapshot(trackedChange.after)
  const showTrackedEditDiff = name === 'Edit' && !!trackedChange
  const showPendingEditPreview =
    name === 'Edit' &&
    !trackedChange &&
    status !== 'completed' &&
    status !== 'error' &&
    hasPendingEditPreviewContent(input)
  const showSettledCompactEditDiff =
    name === 'Edit' &&
    !trackedChange &&
    status !== 'streaming' &&
    status !== 'running' &&
    !!compactEditDiff
  const showTrackedWriteInlineDiff = name === 'Write' && canRenderTrackedWriteDiff
  const showTrackedWriteSnapshotSummary =
    name === 'Write' &&
    !!trackedChange &&
    trackedChange.op === 'modify' &&
    !canRenderTrackedWriteDiff
  const showTrackedWriteNewFile =
    name === 'Write' &&
    !!trackedChange &&
    trackedChange.op === 'create' &&
    canRenderInlineSnapshot(trackedChange.after)
  const showTrackedWriteNewFileSummary =
    name === 'Write' &&
    !!trackedChange &&
    trackedChange.op === 'create' &&
    !canRenderInlineSnapshot(trackedChange.after)
  const showPendingWriteStreaming =
    name === 'Write' && !trackedChange && (status === 'streaming' || status === 'running')
  const showSettledWriteModifyPreview =
    name === 'Write' &&
    !trackedChange &&
    status !== 'streaming' &&
    status !== 'running' &&
    effectiveWriteOp === 'modify'
  const showSettledWriteNewFile =
    name === 'Write' &&
    !trackedChange &&
    status !== 'streaming' &&
    status !== 'running' &&
    effectiveWriteOp === 'create' &&
    !!resolvedWrite.preview
  const showDeleteNotice = name === 'Delete'
  const hasExpandedContent =
    showTrackedEditDiff ||
    showPendingEditPreview ||
    showSettledCompactEditDiff ||
    showTrackedWriteInlineDiff ||
    showTrackedWriteSnapshotSummary ||
    showTrackedWriteNewFile ||
    showTrackedWriteNewFileSummary ||
    showPendingWriteStreaming ||
    showSettledWriteModifyPreview ||
    showSettledWriteNewFile ||
    showDeleteNotice

  const borderColor =
    status === 'streaming'
      ? 'border-violet-500/30'
      : status === 'running'
        ? 'border-blue-500/30'
        : status === 'error' || (isOutputError && !isSuccess)
          ? 'border-destructive/30'
          : trackedChange?.status === 'reverted'
            ? 'border-muted-foreground/20'
            : name === 'Write'
              ? 'border-green-500/20'
              : name === 'Delete'
                ? 'border-red-500/20'
                : 'border-amber-500/20'

  const handleUndoFile = async (): Promise<void> => {
    if (!trackedChange || !isFileActionable) return
    const confirmed = await confirm({
      title: t('fileChange.undoFileConfirmTitle'),
      description: t('fileChange.undoFileConfirmDesc', { path: filePath }),
      confirmLabel: t('fileChange.undoConfirmAction'),
      variant: 'destructive'
    })
    if (!confirmed) return
    setIsUndoingFile(true)
    try {
      await undoFileChange(trackedChange.runId, trackedChange.id)
    } finally {
      setIsUndoingFile(false)
    }
  }

  React.useEffect(() => {
    if (forceOpen) {
      setCollapsed(false)
    }
  }, [forceOpen])

  return (
    <div
      className={cn(
        useCompactChangeLayout
          ? cn(
              'my-1 overflow-hidden text-foreground transition-all duration-200',
              isActive ? compactActiveShellClass : 'bg-transparent'
            )
          : 'activity-card-shell my-3 overflow-hidden rounded-[18px] text-foreground transition-all duration-200',
        !useCompactChangeLayout && borderColor
      )}
    >
      <button
        onClick={() => {
          if (forceOpen) return
          setCollapsed((v) => !v)
        }}
        className={cn(
          useCompactChangeLayout
            ? cn(
                'group w-full rounded-md px-1.5 py-1 text-left transition-colors',
                isActive
                  ? 'hover:bg-muted/35 dark:hover:bg-white/[0.04]'
                  : 'hover:bg-muted/35 dark:hover:bg-white/[0.03]'
              )
            : 'activity-card-header activity-card-header--interactive flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors',
          !useCompactChangeLayout && status === 'running' && 'bg-blue-500/[0.05]'
        )}
      >
        {useCompactChangeLayout ? (
          <div
            className={cn(
              'flex w-full items-center gap-1.5 text-[12px] text-muted-foreground transition-colors group-hover:text-foreground'
            )}
            title={filePath || undefined}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border bg-transparent',
                hasCompactError
                  ? 'border-destructive/25 text-destructive'
                  : compactActionOp === 'create'
                    ? 'border-lime-500/25 text-lime-600 dark:text-lime-400'
                    : compactActionOp === 'delete'
                      ? 'border-destructive/25 text-destructive'
                      : 'border-lime-500/25 text-lime-600 dark:text-lime-400'
              )}
            >
              {hasCompactError ? (
                <XCircle className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
            </span>
            <span className="shrink-0 text-muted-foreground/55">files</span>
            <span className="shrink-0 text-muted-foreground/40">&gt;</span>
            <span className="shrink-0 font-mono font-medium text-foreground/82">{name}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground/60">
              (
              {filePath ? (
                <>
                  {compactActionLabel}: {shortPath(filePath)}
                </>
              ) : (
                t('toolCall.receivingArgs')
              )}
              )
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {compactEditDiff ? (
                <>
                  <span className="shrink-0 text-[10px] font-medium text-emerald-500 dark:text-emerald-400/90">
                    +{compactEditDiff.added}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium text-red-500/90 dark:text-red-400/90">
                    -{compactEditDiff.deleted}
                  </span>
                </>
              ) : isRealtimeWrite ? (
                <WriteRealtimeStats
                  input={input}
                  resolvedWrite={resolvedWrite}
                  op={compactActionOp === 'create' ? 'create' : 'modify'}
                />
              ) : (
                <ChangeStats name={name} input={input} trackedChange={trackedChange} minimal />
              )}
              {hasCompactError ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400"
                  title={
                    error ||
                    parsedOutputError ||
                    canceledMessage ||
                    t('error.label', { ns: 'common' })
                  }
                />
              ) : trackedChange ? (
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    trackedStatusDotTone(trackedChange)
                  )}
                  title={`${t(trackedTransportLabelKey(trackedChange))} / ${t(trackedStatusLabelKey(trackedChange))}`}
                />
              ) : (
                <CompactStatusDot status={status} />
              )}
              {elapsed && (
                <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/70">
                  {elapsed}
                </span>
              )}
              {collapsed ? (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" />
              ) : (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground/70" />
              )}
            </span>
          </div>
        ) : (
          <>
            <FileIcon name={name} />
            <span
              className="text-xs font-medium truncate min-w-0 flex-1"
              title={filePath || undefined}
            >
              {filePath ? (
                fileName(filePath)
              ) : (
                <span className="text-zinc-500 italic animate-pulse">
                  {t('toolCall.receivingArgs')}
                </span>
              )}
            </span>
            <span
              className="text-[10px] text-zinc-500 font-mono truncate max-w-[180px] hidden sm:block"
              title={filePath}
            >
              {shortPath(filePath)}
            </span>
            <ChangeStats name={name} input={input} trackedChange={trackedChange} />
            {trackedChange && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  trackedStatusTone(trackedChange)
                )}
              >
                {t(trackedTransportLabelKey(trackedChange))} ·{' '}
                {t(trackedStatusLabelKey(trackedChange))}
              </span>
            )}
            {elapsed && (
              <span className="text-[9px] text-muted-foreground/70 tabular-nums shrink-0">
                {elapsed}
              </span>
            )}
            <StatusIndicator status={status} />
          </>
        )}
      </button>

      {!collapsed && hasExpandedContent && (
        <div
          className={cn(
            'overflow-hidden',
            useCompactChangeLayout
              ? 'ml-3 border-l border-border/45 pl-5 pt-1 dark:border-white/[0.08]'
              : 'activity-card-divider border-t bg-background/40'
          )}
        >
          {showTrackedEditDiff && trackedChange && (
            <TrackedEditDiff change={trackedChange} filePath={filePath} />
          )}
          {showPendingEditPreview && <PendingEditPreview input={input} />}
          {showSettledCompactEditDiff && compactEditDiff && (
            <CompactEditDiff
              oldStr={compactEditDiff.oldStr}
              newStr={compactEditDiff.newStr}
              filePath={filePath}
            />
          )}
          {showTrackedWriteInlineDiff && trackedChange && (
            <InlineDiff
              oldStr={snapshotText(trackedChange.before)}
              newStr={snapshotText(trackedChange.after)}
              filePath={filePath}
            />
          )}
          {showTrackedWriteSnapshotSummary && trackedChange && (
            <SnapshotSummaryNotice
              before={trackedChange.before}
              after={trackedChange.after}
              filePath={filePath}
            />
          )}
          {showTrackedWriteNewFile && trackedChange && (
            <NewFileContent
              content={snapshotText(trackedChange.after)}
              filePath={filePath}
              isStreaming={status === 'streaming'}
            />
          )}
          {showTrackedWriteNewFileSummary && trackedChange && (
            <SnapshotSummaryNotice after={trackedChange.after} filePath={filePath} />
          )}
          {showPendingWriteStreaming && (
            <PendingWritePreview
              input={input}
              isStreaming={status === 'streaming'}
              op={compactActionOp === 'create' ? 'create' : 'modify'}
            />
          )}
          {showSettledWriteModifyPreview && (
            <PendingWritePreview input={input} isStreaming={false} op="modify" />
          )}
          {showSettledWriteNewFile && (
            <NewFileContent
              content={resolvedWrite.text || resolvedWrite.preview}
              filePath={filePath}
              isStreaming={false}
            />
          )}

          {showDeleteNotice && (
            <div className="px-3 py-3 text-[11px] text-red-500/80 italic dark:text-red-300/80">
              {t('fileChange.fileWillBeDeleted')}
            </div>
          )}
        </div>
      )}

      {trackedChange && !collapsed && (
        <div
          className={cn(
            useCompactChangeLayout
              ? 'bg-transparent px-3 py-2'
              : 'activity-card-divider border-t bg-muted/20 px-3 py-2'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              {trackedChange.status === 'reverted'
                ? t('fileChange.restored')
                : t('fileChange.individualActions')}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant={useCompactChangeLayout ? 'ghost' : 'destructive'}
                className={
                  useCompactChangeLayout ? 'text-zinc-200 hover:bg-white/[0.04]' : undefined
                }
                onClick={handleUndoFile}
                disabled={!isFileActionable || isUndoingFile}
              >
                {isUndoingFile ? <Loader2 className="size-3 animate-spin" /> : null}
                {t('action.undo', { ns: 'common' })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {(error || (parsedOutputError && !error) || canceledMessage) && (
        <div
          className={cn(
            useCompactChangeLayout
              ? 'px-3 py-2'
              : 'border-t border-destructive/20 bg-destructive/8 px-3 py-2'
          )}
        >
          <p
            className={cn(
              'font-mono whitespace-pre-wrap break-words text-[11px] text-destructive',
              useCompactChangeLayout && 'text-red-500/90 dark:text-red-300/90'
            )}
            style={{ fontFamily: MONO_FONT }}
          >
            {error || parsedOutputError || canceledMessage}
          </p>
        </div>
      )}
      {outputStr && !error && !parsedOutputError && isOutputError && !isSuccess && (
        <div
          className={cn(
            useCompactChangeLayout
              ? 'px-3 py-2'
              : 'border-t border-destructive/20 bg-destructive/8 px-3 py-2'
          )}
        >
          <p
            className={cn(
              'font-mono whitespace-pre-wrap break-words text-[11px] text-destructive/80',
              useCompactChangeLayout && 'text-red-500/80 dark:text-red-300/80'
            )}
            style={{ fontFamily: MONO_FONT }}
          >
            {outputStr.length > 500 ? `${outputStr.slice(0, 500)}...` : outputStr}
          </p>
        </div>
      )}
    </div>
  )
}
