// Main content renderer: handles string, empty, and block-by-block rendering

import * as React from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { ScaleIn } from '@renderer/components/animate-ui'
import type { ContentBlock } from '@renderer/lib/api/types'
import type { ToolCallState } from '@renderer/lib/agent/types'
import type { AgentRunFileChange } from '@renderer/stores/agent-store'
import type { OrchestrationRun } from '@renderer/lib/orchestration/types'
import type { TFunction } from 'i18next'
import {
  buildToolExecutionOutline, type ToolExecutionRun
} from '../execution-outline'
import { ThinkingBlock } from '../ThinkingBlock'
import { CollapsibleHeightPanel } from '../CollapsibleHeightPanel'
import { WebSearchBlock } from '../WebSearchBlock'
import { ImageGeneratingLoader } from '../ImageGeneratingLoader'
import { ImagePreview } from '../ImagePreview'
import { ImageGenerationErrorCard } from '../ImageGenerationErrorCard'
import { AgentErrorCard } from '../AgentErrorCard'
import { OrchestrationBlock } from '../OrchestrationBlock'
import { imageBlockToAttachment } from '@renderer/lib/image-attachments'
import { useImageEditStore } from '@renderer/stores/image-edit-store'
import {
  getLiveOutputCursorClass
} from '@renderer/lib/live-output-animation'
import type {
  AssistantRenderItemWithInlineSummary,
  ThinkSegment
} from './types'
import { MARKDOWN_WRAPPER_CLASS as MD_CLASS } from './types'
import { parseThinkTags, stripThinkTags } from './think-parser'
import { StreamingMarkdownContent } from './markdown-renderer'
import { ModelThinkingIndicator, GenerationProcessLine } from './ui-buttons'
import { ToolBlockRenderer } from './tool-block-renderer'
import type { ToolBlockRendererProps } from './tool-block-renderer'
import { ExecutionProcessBlock } from './execution-process-block'
import { buildProcessSummary, splitProcessAndFinal } from './process-summary'

export interface ContentRendererProps {
  content: string | ContentBlock[]
  isStreaming: boolean | undefined
  normalizedContent: ContentBlock[] | null
  stringSegments: ThinkSegment[] | null
  renderItemsWithInlineSummaries: AssistantRenderItemWithInlineSummary[]
  renderMode?: 'default' | 'transcript' | 'static'
  thinkingModelName: string
  liveComponentClassName: string
  liveScaleInClassName: string
  liveFadeInClassName: string
  liveOutputAnimationStyle: string
  hasStructuredThinkingBlocks: boolean
  lastStructuredTextIdx: number
  isGeneratingImage: boolean
  imageGenerationTiming?: { startedAt?: number }
  generatingImagePreview?: {
    source: {
      type: string; data?: string; mediaType?: string; url?: string; filePath?: string
    }
  } | null
  toolExecutionOutline: ReturnType<typeof buildToolExecutionOutline>
  toolRunSummaryById: Map<string, string>
  getToolRunCollapsed: (run: ToolExecutionRun) => boolean
  toggleToolRunCollapsed: (run: ToolExecutionRun) => void
  orchestrationRun?: OrchestrationRun | null
  orchestrationAnchorIndex: number
  toolResults?: Map<string, { content: import('@renderer/lib/api/types').ToolResultContent; isError?: boolean }>
  effectiveLiveToolCallMap?: Map<string, ToolCallState> | null
  isLastAssistantMessage?: boolean
  hiddenToolUseIds?: Set<string>
  sessionId?: string | null
  trackedChangeByToolUseId: Map<string, AgentRunFileChange>
  canEditGeneratedImages: boolean
  t: TFunction
}

export function ContentRenderer({
  content,
  isStreaming,
  normalizedContent,
  stringSegments,
  renderItemsWithInlineSummaries,
  renderMode,
  thinkingModelName,
  liveComponentClassName,
  liveScaleInClassName,
  liveFadeInClassName,
  liveOutputAnimationStyle,
  hasStructuredThinkingBlocks,
  lastStructuredTextIdx,
  isGeneratingImage,
  imageGenerationTiming,
  generatingImagePreview,
  toolExecutionOutline,
  toolRunSummaryById,
  getToolRunCollapsed,
  toggleToolRunCollapsed,
  orchestrationRun,
  orchestrationAnchorIndex,
  toolResults,
  effectiveLiveToolCallMap,
  isLastAssistantMessage,
  hiddenToolUseIds,
  sessionId,
  trackedChangeByToolUseId,
  canEditGeneratedImages,
  t
}: ContentRendererProps): React.JSX.Element {
  const openImageEditor = useImageEditStore((s) => s.openEditor)

  const shouldShowImageGeneratingLoader = isGeneratingImage && isStreaming
  const hasEmptyContent =
    (typeof content === 'string' && content.length === 0) ||
    (Array.isArray(normalizedContent) && normalizedContent.length === 0)
  const generatingImagePreviewSrc =
    generatingImagePreview?.source.type === 'base64' && generatingImagePreview.source.data
      ? `data:${generatingImagePreview.source.mediaType || 'image/png'};base64,${generatingImagePreview.source.data}`
      : (generatingImagePreview?.source.url ?? '')

  if (shouldShowImageGeneratingLoader && hasEmptyContent) {
    return (
      <div className={liveComponentClassName || undefined}>
        <ImageGeneratingLoader
          previewSrc={generatingImagePreviewSrc || undefined}
          previewFilePath={generatingImagePreview?.source.filePath}
          startedAt={imageGenerationTiming?.startedAt}
        />
      </div>
    )
  }

  if (generatingImagePreviewSrc && hasEmptyContent) {
    return (
      <div className={liveComponentClassName || undefined}>
        <ImagePreview
          src={generatingImagePreviewSrc}
          alt="Generated image preview"
          filePath={generatingImagePreview?.source.filePath}
        />
      </div>
    )
  }

  if (isStreaming && hasEmptyContent) {
    return (
      <div className={liveComponentClassName || undefined}>
        <ModelThinkingIndicator
          modelName={thinkingModelName}
          label={t('assistantMessage.thinkingStatus', { defaultValue: 'Thinking...' })}
        />
      </div>
    )
  }

  if (hasEmptyContent) {
    return <></>
  }

  if (typeof content === 'string') {
    const segments = stringSegments ?? []
    const hasThink = segments.some((s) => s.type === 'think')

    if (!hasThink) {
      return (
        <div className="space-y-2">
          {isStreaming ? (
            <ModelThinkingIndicator
              modelName={thinkingModelName}
              label={t('assistantMessage.thinkingStatus', { defaultValue: 'Thinking...' })}
            />
          ) : null}
          <div className={MD_CLASS}>
            <StreamingMarkdownContent text={content} isStreaming={!!isStreaming} />
            {isStreaming && (
              <span className={getLiveOutputCursorClass(liveOutputAnimationStyle)} />
            )}
          </div>
        </div>
      )
    }

    const lastTextSegIdx = segments.reduce(
      (acc: number, s, idx) => (s.type === 'text' ? idx : acc),
      -1
    )
    const lastSegment = segments[segments.length - 1]
    const showOuterCursor = isStreaming && !(lastSegment?.type === 'think' && !lastSegment.closed)

    return (
      <div className="space-y-2">
        {isStreaming ? (
          <ModelThinkingIndicator
            modelName={thinkingModelName}
            label={t('assistantMessage.thinkingStatus', { defaultValue: 'Thinking...' })}
          />
        ) : null}
        {segments.map((seg, idx) => {
          if (seg.type === 'think') {
            return (
              <ThinkingBlock
                key={`${idx}-${seg.closed ? 'settled' : 'active'}`}
                thinking={seg.content}
                isStreaming={!!isStreaming && !seg.closed}
              />
            )
          }
          return (
            <div key={idx} className={MD_CLASS}>
              <StreamingMarkdownContent
                text={seg.content}
                isStreaming={!!isStreaming && idx === lastTextSegIdx}
              />
            </div>
          )
        })}
        {showOuterCursor && (
          <span className={getLiveOutputCursorClass(liveOutputAnimationStyle)} />
        )}
      </div>
    )
  }

  if (!normalizedContent) {
    return <div className={MD_CLASS} />
  }

  // Tool block renderer props bundle
  const toolBlockProps: Omit<ToolBlockRendererProps, 'block' | 'blockIndex'> = {
    toolExecutionOutline,
    hiddenToolUseIds,
    orchestrationRun,
    orchestrationAnchorIndex,
    isStreaming,
    isLastAssistantMessage,
    toolResults,
    effectiveLiveToolCallMap,
    liveScaleInClassName,
    liveFadeInClassName,
    sessionId,
    trackedChangeByToolUseId,
    t,
  }

  const renderToolRun = (runId: string): React.JSX.Element | null => {
    const run = toolExecutionOutline.runById.get(runId)
    if (!run) return null

    const collapsed = getToolRunCollapsed(run)
    const detail =
      run.activeSummary ||
      toolRunSummaryById.get(run.id) ||
      (run.activeCount > 0
        ? t('assistantMessage.activeTools', { count: run.activeCount })
        : run.ordinaryItemCount > 0
          ? t('assistantMessage.toolExecutions', { count: run.ordinaryItemCount })
          : null)

    const renderedTools = run.itemIds
      .map((toolUseId) => {
        const item = toolExecutionOutline.itemByToolUseId.get(toolUseId)
        if (!item || item.visibility === 'hidden') return null
        if (item.visibility === 'ordinary' && collapsed && !run.showToggle) return null

        const block = normalizedContent[item.blockIndex]
        if (!block || block.type !== 'tool_use') return null

        return <ToolBlockRenderer key={`${run.id}:${toolUseId}`} block={block} blockIndex={item.blockIndex} {...toolBlockProps} />
      })
      .filter((node): node is React.JSX.Element => !!node)

    if (!run.showToggle && renderedTools.length === 0) return null

    return (
      <React.Fragment key={run.id}>
        {run.showToggle ? (
          <GenerationProcessLine
            active={run.activeCount > 0}
            label={t('assistantMessage.processTools')}
            detail={detail}
            collapsible={run.showToggle}
            expanded={!collapsed}
            onClick={() => toggleToolRunCollapsed(run)}
          />
        ) : null}
        {run.showToggle ? (
          <CollapsibleHeightPanel open={!collapsed} className="overflow-hidden">
            <div className="space-y-2">{renderedTools}</div>
          </CollapsibleHeightPanel>
        ) : (
          renderedTools
        )}
      </React.Fragment>
    )
  }

  // Split items into process (thinking/tool_use) and final output (text/image).
  // hasProcessContent is true only when there are tool calls — thinking-only won't collapse.
  const { processItems, finalItems, hasProcessContent } =
    splitProcessAndFinal(renderItemsWithInlineSummaries, normalizedContent)

  // Count thinking blocks for summary
  const thinkingBlockCount = normalizedContent?.filter((b) => b.type === 'thinking').length ?? 0
  const processSummary = buildProcessSummary(toolExecutionOutline, thinkingBlockCount, t)

  const renderItem = (item: AssistantRenderItemWithInlineSummary): React.JSX.Element | null => {
    if (item.kind === 'compact-summary') {
      return null
    }

    if (item.kind === 'block') {
      const block = normalizedContent![item.index]
      switch (block.type) {
        case 'thinking':
          return (
            <ThinkingBlock
              key={`${item.index}-${block.completedAt ? 'settled' : 'active'}`}
              thinking={block.thinking}
              isStreaming={isStreaming}
              startedAt={block.startedAt}
              completedAt={block.completedAt}
            />
          )
        case 'text': {
          if (hasStructuredThinkingBlocks) {
            const visibleText = stripThinkTags(block.text)
            if (!visibleText.trim()) return null
            return (
              <div key={item.index} className={MD_CLASS}>
                <StreamingMarkdownContent
                  text={visibleText}
                  isStreaming={!!isStreaming && item.index === lastStructuredTextIdx}
                />
              </div>
            )
          }

          const textSegments = parseThinkTags(block.text)
          const hasThinkInBlock = textSegments.some((s) => s.type === 'think')
          if (!hasThinkInBlock) {
            return (
              <div key={item.index} className={MD_CLASS}>
                <StreamingMarkdownContent
                  text={block.text}
                  isStreaming={!!isStreaming && item.index === lastStructuredTextIdx}
                />
              </div>
            )
          }
          const isBlockStreaming = !!(isStreaming && item.index === lastStructuredTextIdx)
          const lastTxtSeg = textSegments.reduce(
            (acc: number, s, j) => (s.type === 'text' ? j : acc),
            -1
          )
          return (
            <div key={item.index}>
              {textSegments.map((seg, j) => {
                if (seg.type === 'think') {
                  return (
                    <ThinkingBlock
                      key={`${item.index}-${j}-${seg.closed ? 'settled' : 'active'}`}
                      thinking={seg.content}
                      isStreaming={isBlockStreaming && !seg.closed}
                    />
                  )
                }
                return (
                  <div key={j} className={MD_CLASS}>
                    <StreamingMarkdownContent
                      text={seg.content}
                      isStreaming={isBlockStreaming && j === lastTxtSeg}
                    />
                  </div>
                )
              })}
            </div>
          )
        }
        case 'image': {
          const imgBlock = block as Extract<ContentBlock, { type: 'image' }>
          const imgSrc =
            imgBlock.source.type === 'base64' && imgBlock.source.data
              ? `data:${imgBlock.source.mediaType || 'image/png'};base64,${imgBlock.source.data}`
              : (imgBlock.source.url ?? '')
          if (!imgSrc && !imgBlock.source.filePath) return null
          const editableImage = imageBlockToAttachment(imgBlock)
          const actions =
            canEditGeneratedImages && sessionId && editableImage
              ? [
                  {
                    key: 'edit',
                    label: t('assistantMessage.editImage', { defaultValue: 'Edit image' }),
                    icon: <Pencil className="size-4" />,
                    onClick: () => openImageEditor({ sessionId, image: editableImage, mode: 'edit' })
                  },
                  {
                    key: 'mask',
                    label: t('assistantMessage.maskEditImage', { defaultValue: 'Mask edit' }),
                    icon: <Eraser className="size-4" />,
                    onClick: () => openImageEditor({ sessionId, image: editableImage, mode: 'mask' })
                  }
                ]
              : undefined
          return (
            <ScaleIn key={item.index} className={liveScaleInClassName}>
              <ImagePreview
                src={imgSrc}
                alt="Generated image"
                filePath={imgBlock.source.filePath}
                actions={actions}
              />
            </ScaleIn>
          )
        }
        case 'image_error': {
          const imageError = block as Extract<ContentBlock, { type: 'image_error' }>
          return (
            <ScaleIn key={item.index} className={liveScaleInClassName}>
              <ImageGenerationErrorCard code={imageError.code} message={imageError.message} />
            </ScaleIn>
          )
        }
        case 'agent_error': {
          const agentError = block as Extract<ContentBlock, { type: 'agent_error' }>
          return (
            <ScaleIn key={item.index} className={liveScaleInClassName}>
              <AgentErrorCard
                code={agentError.code}
                message={agentError.message}
                errorType={agentError.errorType}
                details={agentError.details}
                stackTrace={agentError.stackTrace}
              />
            </ScaleIn>
          )
        }
        case 'tool_use':
          return <ToolBlockRenderer key={block.id} block={block} blockIndex={item.index} {...toolBlockProps} />
        case 'web_search': {
          const webSearch = block as Extract<ContentBlock, { type: 'web_search' }>
          return (
            <ScaleIn key={item.index} className={liveScaleInClassName}>
              <WebSearchBlock block={webSearch} />
            </ScaleIn>
          )
        }
        default:
          return null
      }
    }

    return renderToolRun(item.runId)
  }

  return (
    <div className="space-y-2">
      {orchestrationRun?.kind === 'team' && orchestrationAnchorIndex < 0 ? (
        <OrchestrationBlock run={orchestrationRun} />
      ) : null}
      {hasProcessContent ? (
        renderMode === 'transcript' ? (
          <div className="space-y-2">
            {processItems.map((item) => renderItem(item))}
          </div>
        ) : (
        <ExecutionProcessBlock
          collapsible={true}
          isStreaming={!!isStreaming}
          summary={processSummary}
          activeDetail={toolExecutionOutline.activeSummary}
        >
          {processItems.map((item) => renderItem(item))}
        </ExecutionProcessBlock>
        )
      ) : (
        processItems.map((item) => renderItem(item))
      )}
      {finalItems.length > 0 ? (
        finalItems.map((item) => renderItem(item))
      ) : hasProcessContent && !isStreaming && renderMode !== 'transcript' ? (
        <div className={MD_CLASS}>
          <p className="text-muted-foreground">{t('assistantMessage.cancelledExecution', { defaultValue: '用户取消，中断执行' })}</p>
        </div>
      ) : null}
      {isStreaming && <span className={getLiveOutputCursorClass(liveOutputAnimationStyle)} />}
      {shouldShowImageGeneratingLoader && (
        <div className={`pt-3${liveComponentClassName ? ` ${liveComponentClassName}` : ''}`}>
          <ImageGeneratingLoader
            previewSrc={generatingImagePreviewSrc || undefined}
            previewFilePath={generatingImagePreview?.source.filePath}
            startedAt={imageGenerationTiming?.startedAt}
          />
        </div>
      )}
    </div>
  )
}
