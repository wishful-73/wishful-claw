import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { MONO_FONT } from '@renderer/lib/constants'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { isMcpTool, parseMcpToolName } from '@renderer/lib/mcp/mcp-tools'
import { parseExtensionToolResult } from '@renderer/lib/extensions/extension-result'
import { inputSummary } from '../tool-call-summary'
import { CollapsibleHeightPanel } from '../CollapsibleHeightPanel'
import { ExtensionToolResultCard } from '../ExtensionToolResultCard'
import { CompactToolCallHeader } from '../CompactToolCallHeader'
import { LazySyntaxHighlighter } from '../LazySyntaxHighlighter'

import type { ToolCallCardProps } from './types'
import { COMMAND_TOOL_NAMES, COMPACT_BUILTIN_TOOL_NAMES } from './types'
import { areToolCallCardPropsEqual, outputAsString, hasImageBlocks, deriveOutputError, isErrorOnlyOutput, isStructuredBashResult, getBashInputTerminalId, getShellInputCommand, detectLang } from './utils'
import {
  CopyBtn,
  McpToolIcon,
  ToolStatusDot,
  ToolDetailSectionHeader
} from './shared'
import { StructuredInput } from './input-renderers'
import { BashOutputBlock } from './output-blocks/bash-output'
import { GrepOutputBlock, GlobOutputBlock, LSOutputBlock } from './output-blocks/search-output'
import {
  ImageOutputBlock,
  MarkdownOutputBlock,
  OutputBlock,
  ReadOutputBlock
} from './output-blocks/text-output'
import { MemoryOutputBlock } from './output-blocks/memory-output'
import {
  buildCompactToolHeaderModel,
  compactStatusLabel,
  getToolNamespace,
  hasFocusedExpandedOutput
} from './compact-header'

function formatMcpToolDisplayName(name: string): string {
  const parsed = parseMcpToolName(name)
  const toolName = parsed?.toolName ?? name
  const label = toolName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .join(' ')
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : toolName
}

function ToolCallCardInner({
  toolUseId,
  name,
  input,
  output,
  status,
  error,
  startedAt,
  completedAt,
  forceOpen = false
}: ToolCallCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isProcessing = status === 'streaming' || status === 'running'
  const isActive = isProcessing || status === 'pending_approval'
  const isCommandTool = COMMAND_TOOL_NAMES.has(name)
  const isLiveCommandTool = isCommandTool && isProcessing
  const toolNamePulseClass =
    status === 'running'
      ? 'tool-name-live-pulse tool-name-live-pulse--running'
      : status === 'streaming'
        ? 'tool-name-live-pulse tool-name-live-pulse--streaming'
        : null
  const hasVisualOutput = hasImageBlocks(output)
  const isReadTextTool = name === 'Read' && !hasVisualOutput
  const [open, setOpen] = React.useState(
    forceOpen || isLiveCommandTool || hasVisualOutput
  )
  const [readTextOutputRevealed, setReadTextOutputRevealed] = React.useState(false)
  const prevIsActiveRef = React.useRef(isActive)
  const wasLiveCommandToolRef = React.useRef(isLiveCommandTool)
  const toggleOpen = React.useCallback(() => {
    if (forceOpen) return
    if (isLiveCommandTool) return
    if (name === 'Read' && !open) {
      setReadTextOutputRevealed(true)
    }
    setOpen((current) => !current)
  }, [forceOpen, isLiveCommandTool, name, open])

  React.useEffect(() => {
    if (forceOpen) {
      setOpen(true)
      if (isReadTextTool) {
        setReadTextOutputRevealed(true)
      }
      prevIsActiveRef.current = isActive
      wasLiveCommandToolRef.current = isLiveCommandTool
      return
    }
    if (hasVisualOutput) {
      setOpen(true)
      prevIsActiveRef.current = isActive
      wasLiveCommandToolRef.current = isLiveCommandTool
      return
    }
    if (isLiveCommandTool) {
      setOpen(true)
      prevIsActiveRef.current = isActive
      wasLiveCommandToolRef.current = true
      return
    }
    if (wasLiveCommandToolRef.current) {
      setOpen(false)
      wasLiveCommandToolRef.current = false
      prevIsActiveRef.current = isActive
      return
    }
    if (isReadTextTool) {
      if (!readTextOutputRevealed) {
        setOpen(false)
      }
      prevIsActiveRef.current = isActive
      wasLiveCommandToolRef.current = isLiveCommandTool
      return
    }
    if (prevIsActiveRef.current && !isActive) {
      setOpen(false)
    }
    prevIsActiveRef.current = isActive
    wasLiveCommandToolRef.current = isLiveCommandTool
  }, [
    forceOpen,
    hasVisualOutput,
    isActive,
    isLiveCommandTool,
    isReadTextTool,
    readTextOutputRevealed
  ])
  const outputText = React.useMemo(() => outputAsString(output), [output])
  const extensionToolResult = React.useMemo(
    () => (open ? parseExtensionToolResult(output) : null),
    [open, output]
  )
  const summary = React.useMemo(
    () => inputSummary(name, input, outputText),
    [input, name, outputText]
  )
  const displayName = React.useMemo(
    () =>
      isMcpTool(name)
        ? formatMcpToolDisplayName(name)
        : t(`permission.toolLabels.${name}`, { defaultValue: name }),
    [name, t]
  )
  const headerSummary = React.useMemo(() => {
    if (name !== 'TodoTaskList' && name !== 'TaskList') return summary
    if (!outputText) return null

    const data = decodeStructuredToolResult(outputText)
    if (!data || Array.isArray(data) || !Array.isArray(data.tasks)) return null

    const completed = data.tasks.filter(
      (task) =>
        task && typeof task === 'object' && (task as { status?: unknown }).status === 'completed'
    ).length
    return t('todo.tasksDone', { completed, total: data.tasks.length })
  }, [name, outputText, summary, t])
  const outputIsErrorOnly = React.useMemo(() => isErrorOnlyOutput(outputText), [outputText])
  const outputError = React.useMemo(() => deriveOutputError(outputText), [outputText])
  const suppressErrorPanel = isCommandTool && isStructuredBashResult(outputText)
  const displayError = suppressErrorPanel
    ? null
    : error || (status === 'error' ? outputError : null)
  const shouldRenderOutputPanels = (!displayError || !outputIsErrorOnly) && (!isProcessing || isCommandTool)
  const hideLivePayload =
    isProcessing &&
    (name === 'Write' || name === 'Edit') &&
    input.content_hidden_until_complete === true
  const showSettledWriteContent =
    name === 'Write' &&
    status !== 'streaming' &&
    status !== 'running' &&
    !!(input.content || input.content_preview)
  const elapsed = (() => {
    if (!startedAt || !completedAt) return null
    const diffMs = completedAt - startedAt
    if (diffMs < 1000) return `${Math.round(diffMs)}ms`
    return `${(diffMs / 1000).toFixed(1)}s`
  })()
  // Cache elapsed so it persists even after liveToolCall is cleaned up
  const elapsedCacheRef = React.useRef<string | null>(null)
  if (elapsed) {
    elapsedCacheRef.current = elapsed
  }
  const isMcpToolCall = isMcpTool(name)
  const useCompactToolHeader = COMPACT_BUILTIN_TOOL_NAMES.has(name)
  const compactHeader = React.useMemo(() => {
    const model = buildCompactToolHeaderModel({
      name,
      input,
      output,
      outputText,
      displayName,
      summary,
      t
    })
    return {
      ...model,
      toolLabel: displayName,
      namespace: getToolNamespace(name)
    }
  }, [displayName, input, name, output, outputText, summary, t])
  const compactStatus = compactStatusLabel(status, t)
  const compactHeaderError = Boolean(displayError) || (status === 'error' && !!outputError)
  const bashHasFocusedOutput =
    shouldRenderOutputPanels &&
    isCommandTool &&
    Boolean(
      status === 'running' ||
      status === 'streaming' ||
      outputText ||
      getBashInputTerminalId(input) ||
      getShellInputCommand(input)
    )
  const hasFocusedOutput =
    shouldRenderOutputPanels &&
    (hasFocusedExpandedOutput(name, output, outputText) || bashHasFocusedOutput)
  const suppressSkillOutput = name === 'Skill'
  const isMemoryTool = name.startsWith("memory_")
  const shouldShowStructuredInput = !(showSettledWriteContent || hasFocusedOutput) && !isMemoryTool
  const shouldShowResultHeader =
    !suppressSkillOutput && !isMemoryTool &&
    shouldRenderOutputPanels &&
    (Boolean(output) ||
      (isCommandTool &&
        Boolean(
          status === 'running' ||
          status === 'streaming' ||
          getBashInputTerminalId(input) ||
          getShellInputCommand(input)
        )))

  return (
    <div
      className={cn(
        useCompactToolHeader || isMcpToolCall
          ? 'my-1 min-w-0 overflow-hidden'
          : 'my-5 min-w-0 overflow-hidden'
      )}
    >
      <button
        onClick={toggleOpen}
        className={cn(
          useCompactToolHeader
            ? 'group w-full rounded-lg p-0 text-left transition-colors'
            : isMcpToolCall
              ? 'group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-foreground/92 transition-colors hover:bg-muted/35 hover:text-foreground dark:hover:bg-white/[0.035]'
              : 'flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'
        )}
      >
        {useCompactToolHeader ? (
          <CompactToolCallHeader
            model={compactHeader}
            status={status}
            statusLabel={compactStatus}
            hasError={compactHeaderError}
            errorTitle={displayError ?? outputError ?? t('error.label')}
            elapsed={elapsed ?? elapsedCacheRef.current}
            open={open}
          />
        ) : isMcpToolCall ? (
          <>
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border border-white/18 bg-transparent text-white/90',
                isProcessing && 'animate-pulse'
              )}
            >
              <McpToolIcon />
            </span>
            <span className={cn('min-w-0 shrink truncate font-medium', toolNamePulseClass)}>
              {displayName}
            </span>
            {status !== 'streaming' && headerSummary && !open ? (
              <span className="min-w-0 flex-1 truncate text-muted-foreground/62">
                {headerSummary}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            {(elapsed ?? elapsedCacheRef.current) && (
              <span className="text-[10px] tabular-nums text-muted-foreground/55">{elapsed ?? elapsedCacheRef.current}</span>
            )}
            <ChevronDown
              className={cn(
                'size-3 shrink-0 text-muted-foreground/55 transition-transform duration-200 group-hover:text-foreground/80',
                !open && '-rotate-90'
              )}
            />
          </>
        ) : (
          <>
            <ToolStatusDot status={status} />
            <span className={cn('font-medium', toolNamePulseClass)}>{displayName}</span>
            {isProcessing && !error && (
              <>
                {name === 'Write' && (input.file_path || input.path) ? (
                  <span className="text-blue-500/80 text-[10px] animate-pulse dark:text-blue-400/70">
                    Write:{' '}
                    {String(input.file_path || input.path)
                      .split(/[\\/]/)
                      .slice(-2)
                      .join('/')}
                    {typeof input.content_lines === 'number'
                      ? ` (${t('toolCall.lineCount', { count: input.content_lines })})`
                      : ''}
                  </span>
                ) : name === 'Edit' && (input.file_path || input.path) ? (
                  <span className="text-amber-600/80 text-[10px] animate-pulse dark:text-amber-400/70">
                    Edit:{' '}
                    {String(input.file_path || input.path)
                      .split(/[\\/]/)
                      .slice(-2)
                      .join('/')}
                  </span>
                ) : (
                  <span className="text-violet-500/80 text-[10px] animate-pulse dark:text-violet-400/70">
                    {status === 'streaming'
                      ? t('toolCall.receivingArgs')
                      : headerSummary || t('toolCall.executing')}
                  </span>
                )}
              </>
            )}
            {error && status === 'streaming' && (
              <span className="text-red-500/80 text-[10px] animate-pulse dark:text-red-400/70">
                {t('error.label')}
              </span>
            )}
            {status !== 'streaming' && headerSummary && !open && (
              <span className="max-w-[300px] truncate text-muted-foreground/70">
                {headerSummary}
              </span>
            )}
            {(elapsed ?? elapsedCacheRef.current) && (
              <span className="text-[10px] tabular-nums text-muted-foreground/55">{elapsed ?? elapsedCacheRef.current}</span>
            )}
            <ChevronDown
              className={cn(
                'size-3 text-muted-foreground/55 transition-transform duration-200',
                !open && '-rotate-90'
              )}
            />
          </>
        )}
      </button>

      <CollapsibleHeightPanel
        open={open}
        className={cn(
          'min-w-0 overflow-hidden',
          useCompactToolHeader
            ? 'ml-3 mt-1.5 border-l border-border/45 pl-5 dark:border-white/[0.08]'
            : 'mt-1.5 pl-5'
        )}
        contentClassName={cn(
          'space-y-2 pb-0.5',
          useCompactToolHeader &&
            'rounded-lg border border-border/55 bg-background/55 px-3 py-3 dark:border-white/[0.08] dark:bg-[#0d0d0e]'
        )}
      >
        {hideLivePayload ? (
          <div className="space-y-2">
            <StructuredInput name={name} input={input} />
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground/70">
              {t('toolCall.hiddenLivePayload')}
            </div>
          </div>
        ) : (
          <>
            {showSettledWriteContent &&
              name === 'Write' &&
              (() => {
                const writeContent = typeof input.content === 'string' ? input.content : null
                const writePreview =
                  typeof input.content_preview === 'string' ? input.content_preview : null
                const writePreviewTail =
                  typeof input.content_preview_tail === 'string' ? input.content_preview_tail : null
                const displayContent =
                  writeContent ??
                  (writePreviewTail ? `${writePreview}\n…\n${writePreviewTail}` : writePreview) ??
                  ''
                const isOmitted = !writeContent && !!input.content_omitted
                const totalLines =
                  typeof input.content_lines === 'number'
                    ? input.content_lines
                    : writeContent
                      ? writeContent.split('\n').length
                      : null
                return (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('toolCall.content')}
                      </p>
                      <span className="text-[9px] text-muted-foreground/55 font-mono">
                        {detectLang(String(input.file_path ?? input.path ?? ''))}
                        {totalLines !== null
                          ? ` · ${t('toolCall.lineCount', { count: totalLines })}`
                          : ''}
                      </span>
                      {isOmitted && (
                        <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground/60">
                          {t('toolCall.preview')}
                        </span>
                      )}
                      {writeContent && <CopyBtn text={writeContent} />}
                    </div>
                    <LazySyntaxHighlighter
                      language={detectLang(String(input.file_path ?? input.path ?? ''))}
                      wrapLongLines
                      customStyle={{
                        margin: 0,
                        padding: '0.5rem',
                        borderRadius: '0.375rem',
                        fontSize: '11px',
                        maxHeight: '200px',
                        overflow: 'auto',
                        fontFamily: MONO_FONT
                      }}
                      codeTagProps={{ style: { fontFamily: 'inherit' } }}
                    >
                      {displayContent}
                    </LazySyntaxHighlighter>
                  </div>
                )
              })()}
            {shouldShowStructuredInput && (
              <div className="space-y-2">
                <ToolDetailSectionHeader label={t('toolCall.parameters')} />
                <StructuredInput name={name} input={input} />
              </div>
            )}
            {shouldShowResultHeader && <ToolDetailSectionHeader label={t('toolCall.result')} />}
            {output && name === 'Read' && hasImageBlocks(output) && (
              <ImageOutputBlock output={output} />
            )}
            {shouldRenderOutputPanels &&
              output &&
              name === 'Read' &&
              !hasImageBlocks(output) &&
              readTextOutputRevealed &&
              outputText && (
                <ReadOutputBlock
                  output={outputText}
                  filePath={String(input.file_path ?? input.path ?? '')}
                />
              )}
            {shouldRenderOutputPanels &&
              isCommandTool &&
              (status === 'running' ||
                status === 'streaming' ||
                outputText ||
                getBashInputTerminalId(input) ||
                getShellInputCommand(input)) && (
                <BashOutputBlock
                  name={name}
                  output={outputText ?? ''}
                  input={input}
                  toolUseId={toolUseId}
                  status={status}
                />
              )}
            {shouldRenderOutputPanels && output && name === 'Grep' && outputText && (
              <GrepOutputBlock output={outputText} pattern={String(input.pattern ?? '')} />
            )}
            {shouldRenderOutputPanels && output && name === 'Glob' && outputText && (
              <GlobOutputBlock output={outputText} />
            )}
            {shouldRenderOutputPanels && output && name === 'LS' && outputText && (
              <LSOutputBlock output={outputText} />
            )}
            {shouldRenderOutputPanels &&
              output &&
              ['Edit', 'Write', 'Delete'].includes(name) &&
              (() => {
                const s = outputText ?? ''
                const parsed = decodeStructuredToolResult(s)
                const success = !!(parsed && !Array.isArray(parsed) && parsed.success === true)
                return (
                  <div className="flex items-center gap-1.5 text-xs">
                    {success ? (
                      <>
                        <CheckCircle2 className="size-3 text-green-500" />
                        <span className="text-green-500/70">
                          {t('toolCall.appliedSuccessfully')}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="size-3 text-destructive" />
                        <span className="text-destructive/70 font-mono truncate">
                          {s.slice(0, 100)}
                        </span>
                      </>
                    )}
                  </div>
                )
              })()}
            {shouldRenderOutputPanels && output && extensionToolResult && (
              <ExtensionToolResultCard output={output} />
            )}
            {shouldRenderOutputPanels &&
              output &&
              name.startsWith('codegraph_') &&
              outputText && <MarkdownOutputBlock output={outputText} />}
            {shouldRenderOutputPanels &&
              output &&
              name.startsWith('memory_') &&
              !(status === 'streaming' || status === 'running') &&
              outputText && <MemoryOutputBlock name={name} input={input} output={outputText} />}
            {shouldRenderOutputPanels &&
              output &&
              !extensionToolResult &&
              !name.startsWith('codegraph_') &&
              !name.startsWith('memory_') &&
              ![
                'Read',
                'Bash',
                'Shell',
                'PowerShell',
                'Grep',
                'Glob',
                'LS',
                'TodoTaskCreate',
                'TodoTaskUpdate',
                'TodoTaskGet',
                'TodoTaskList',
                // Legacy names for old persisted transcripts.
                'TaskCreate',
                'TaskUpdate',
                'TaskGet',
                'TaskList',
                'Edit',
                'Write',
                'Delete',
                'AskUserQuestion',
                'Skill',
                'visualize_show_widget'
              ].includes(name) &&
              (hasImageBlocks(output) ? (
                <ImageOutputBlock output={output} />
              ) : outputText ? (
                <OutputBlock output={outputText} />
              ) : null)}
            {displayError && (
              <div>
                <p className="mb-1 text-xs font-medium text-destructive">{t('error.label')}</p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-destructive font-mono">
                  {displayError}
                </pre>
              </div>
            )}
          </>
        )}
      </CollapsibleHeightPanel>
    </div>
  )
}

export const ToolCallCard = React.memo(ToolCallCardInner, areToolCallCardPropsEqual)
ToolCallCard.displayName = 'ToolCallCard'

export { ToolStatusDot } from './shared'
export { WidgetOutputBlock } from './output-blocks/widget-output'
