// Main content renderer: handles string, empty, and block-by-block rendering
//
// 500 行豁免（2026-10-28，行数以实际为准）：这个文件就是「一条 assistant 消息怎么画」的
// 单一渲染分派器 —— 文本 / 思考 / 工具 / 图片 / 编排 / 过程折叠全按 block 类型走同一张
// 表，共用一个 renderItem 与同一套 folding 判定。拆成多个文件只会把一个 switch 切成
// 几个互相 import 的碎片，判定口径立刻分叉（iter-40 S-210 的回填逻辑就依赖这个
// 单点）。依据 AGENTS.md §大文件拆分 第 5 条第 1 类（单一职责分派器）。

import * as React from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { ScaleIn } from '@renderer/components/animate-ui'
import type { ContentBlock, MessageRunEndMeta } from '@renderer/lib/api/types'
import type { ToolCallState } from '@renderer/lib/agent/types'
import type { ChatRenderDensity } from '@renderer/stores/settings-store-types'
import type { AgentRunFileChange } from '@renderer/stores/agent-store'
import type { OrchestrationRun } from '@renderer/lib/orchestration/types'
import type { TFunction } from 'i18next'
import {
  buildToolExecutionOutline,
  type ToolExecutionItem,
  type ToolExecutionRun
} from '../execution-outline'
import { deriveProcessRenderForm, shouldPinOutsideCollapsedRun } from '../render-density'
import { PROCESS_LINE_CARD_ONLY_TOOL_NAMES } from './tool-block-renderer'
import { ThinkingBlock } from '../ThinkingBlock'
import { CollapsibleHeightPanel } from '../CollapsibleHeightPanel'
import { WebSearchBlock } from '../WebSearchBlock'
import { ImageGeneratingLoader } from '../ImageGeneratingLoader'
import { ImagePreview } from '../ImagePreview'
import { ImageGenerationErrorCard } from '../ImageGenerationErrorCard'
import { AgentErrorCard } from '../AgentErrorCard'
import { OrchestrationBlock } from '../OrchestrationBlock'
import { imageBlockToAttachment } from '@renderer/lib/image-attachments'
import { getLiveOutputCursorClass } from '@renderer/lib/live-output-animation'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useImageEditStore } from '@renderer/stores/image-edit-store'
import type { AssistantRenderItem, ThinkSegment } from './types'
import type { MessageFragmentPosition } from '../renderable-chat-items'
import { MARKDOWN_WRAPPER_CLASS as MD_CLASS } from './types'
import { parseThinkTags, stripThinkTags } from './think-parser'
import { shouldShowTrailingCursor } from './live-cursor'
import { StreamingMarkdownContent } from './markdown-renderer'
import { ModelThinkingIndicator, GenerationProcessLine } from './ui-buttons'
import { ToolBlockRenderer } from './tool-block-renderer'
import type { ToolBlockRendererProps } from './tool-block-renderer'
import { ExecutionProcessBlock } from './execution-process-block'
import { buildProcessSummary, splitProcessAndFinal } from './process-summary'
import { resolveRunEndLabel } from '@renderer/lib/agent/run-end-label'

export interface ContentRendererProps {
  content: string | ContentBlock[]
  isStreaming: boolean | undefined
  normalizedContent: ContentBlock[] | null
  stringSegments: ThinkSegment[] | null
  renderItems: AssistantRenderItem[]
  renderMode?: 'default' | 'transcript' | 'static'
  thinkingModelName: string
  liveComponentClassName: string
  liveScaleInClassName: string
  liveFadeInClassName: string
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
  /** 当前渲染档位（S-248：决定过程层是卡片还是文本行） */
  renderDensity: ChatRenderDensity
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
  /** 这一轮怎么结束的（落库数据）；缺失 = 不知道，按旧文案兜底。 */
  runEnd?: MessageRunEndMeta | null
  /**
   * 压缩把一条 assistant 消息劈成两段时，这段是劈出来的哪一截。
   * `before` = 压缩卡片之前那半截，这一轮并没有结束，尾部提示不能说「任务暂告一段落」。
   */
  fragmentPosition?: MessageFragmentPosition
  t: TFunction
}

export function ContentRenderer({
  content,
  isStreaming,
  normalizedContent,
  stringSegments,
  renderItems,
  renderMode,
  thinkingModelName,
  liveComponentClassName,
  liveScaleInClassName,
  liveFadeInClassName,
  hasStructuredThinkingBlocks,
  lastStructuredTextIdx,
  isGeneratingImage,
  imageGenerationTiming,
  generatingImagePreview,
  toolExecutionOutline,
  renderDensity,
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
  runEnd,
  fragmentPosition,
  t
}: ContentRendererProps): React.JSX.Element {
  const openImageEditor = useImageEditStore((s) => s.openEditor)
  const liveOutputAnimationStyle = useSettingsStore((s) => s.liveOutputAnimationStyle)

  /**
   * The trailing cursor (T-4 口径修正，2026-09-15）。
   *
   * **The rule — and the reason it is not computed here — lives in `live-cursor.ts`:**
   * never more than one cursor on screen. Thinking keeps its own inside `ThinkingBlock`;
   * otherwise the trailing one shows, and only on the last assistant message so a
   * compression cannot light up two.
   *
   * All the render sites below share this single value rather than each deciding for
   * itself — that is exactly how the rule got broken before (three sites, three
   * independent `isStreaming` checks, nothing coordinating them).
   */
  const showTrailingCursor = shouldShowTrailingCursor({
    isStreaming,
    stringSegments,
    normalizedContent,
    isLastAssistantMessage
  })
  const trailingCursor = showTrailingCursor ? (
    <span className={getLiveOutputCursorClass(liveOutputAnimationStyle)} />
  ) : null

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
            {trailingCursor}
          </div>
        </div>
      )
    }

    const lastTextSegIdx = segments.reduce(
      (acc: number, s, idx) => (s.type === 'text' ? idx : acc),
      -1
    )
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
              {/* 光标只跟最后一段文本；末尾是思考段时不跟（那段由 ThinkingBlock 自己亮）。 */}
              {idx === lastTextSegIdx && idx === segments.length - 1 ? trailingCursor : null}
            </div>
          )
        })}
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

        return {
          item,
          node: (
            <ToolBlockRenderer
              key={`${run.id}:${toolUseId}`}
              block={block}
              blockIndex={item.blockIndex}
              {...toolBlockProps}
            />
          )
        }
      })
      .filter(
        (entry): entry is { item: ToolExecutionItem; node: React.JSX.Element } => !!entry
      )

    // S-225 §8：折叠态下 attention / force 项必须露在折叠面板之外 —— 档位不得藏错误。
    // 否则「纯文本」档里一个失败的 Edit 会跟着面板一起沉下去，用户只看到「运行了 N 个工具」。
    //
    // S-248：纯文本档里错误已经降级成红行了（老大 2026-10-28 09:40「错误丢了就丢了」），
    // 再浮出来就又是一张卡片壳 —— 所以这一档只浮出**仍然必须是卡片**的项（答题 / 子 agent /
    // 生成图 / 桌面截图），其余留在面板里当行。
    const processForm = deriveProcessRenderForm(renderDensity)
    const pinnedTools = renderedTools.filter(
      (entry) =>
        shouldPinOutsideCollapsedRun(collapsed, entry.item.visibility) &&
        (processForm === 'card' ||
          PROCESS_LINE_CARD_ONLY_TOOL_NAMES.has(entry.item.name) ||
          entry.item.category === 'desktop' ||
          entry.item.category === 'interactive')
    )
    const panelTools =
      pinnedTools.length > 0
        ? renderedTools.filter((entry) => !pinnedTools.includes(entry))
        : renderedTools

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
        {pinnedTools.length > 0 ? (
          <div className={processForm === 'line' ? 'space-y-0' : 'space-y-2'}>
            {pinnedTools.map((entry) => entry.node)}
          </div>
        ) : null}
        {run.showToggle ? (
          <CollapsibleHeightPanel open={!collapsed} className="overflow-hidden">
            {/* R-10.3: 展开且非流式（定格态手动展开）时封顶 70vh 出内部滚动条 */}
            <div
              className={
                !collapsed && !isStreaming
                  ? `max-h-[70vh] overflow-y-auto ${processForm === 'line' ? 'space-y-0' : 'space-y-2'}`
                  : processForm === 'line'
                    ? 'space-y-0'
                    : 'space-y-2'
              }
            >
              {panelTools.map((entry) => entry.node)}
            </div>
          </CollapsibleHeightPanel>
        ) : (
          panelTools.map((entry) => entry.node)
        )}
      </React.Fragment>
    )
  }

  // Split items into process (thinking/tool_use) and final output (text/image).
  // hasProcessContent is true only when there are tool calls — thinking-only won't collapse.
  const { processItems, finalItems, hasProcessContent } = splitProcessAndFinal(
    renderItems,
    normalizedContent
  )

  // Count thinking blocks for summary
  const thinkingBlockCount = normalizedContent?.filter((b) => b.type === 'thinking').length ?? 0
  const processSummary = buildProcessSummary(toolExecutionOutline, thinkingBlockCount, t)

  // 结束原因照实显示（S-210）：数据来自消息 meta.runEnd，没有就一个字都不说。
  const runEndLabel = isStreaming || renderMode === 'transcript' ? null : resolveRunEndLabel(runEnd)
  const runEndText = runEndLabel
    ? t(runEndLabel.key, { ...runEndLabel.params, defaultValue: runEndLabel.fallback })
    : null

  /** `trailing` marks the last rendered item, which is where the cursor belongs. */
  const renderItem = (item: AssistantRenderItem, trailing = false): React.JSX.Element | null => {
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
                {trailing ? trailingCursor : null}
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
                {trailing ? trailingCursor : null}
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
                    {trailing && j === lastTxtSeg && j === textSegments.length - 1
                      ? trailingCursor
                      : null}
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
        finalItems.map((item, index) => renderItem(item, index === finalItems.length - 1))
      ) : hasProcessContent && !isStreaming && renderMode !== 'transcript' && !runEndText ? (
        // 折叠块外面没正文时补一句，说明「为什么这儿没正文」：
        // - `before` 分片 = 压缩卡片把这一轮劈成两半，前半截本来就没有收尾正文，任务没结束；
        // - 其余 = 老消息没有 runEnd（那会儿还没落库这个数据），只能沿用旧文案，不编原因。
        <div className={MD_CLASS}>
          <p className="text-muted-foreground">
            {fragmentPosition === 'before'
              ? t('assistantMessage.contextCompacted', {
                  defaultValue: '上下文已压缩，执行继续'
                })
              : t('assistantMessage.executionPaused', { defaultValue: '任务暂告一段落' })}
          </p>
        </div>
      ) : null}
      {runEndText ? (
        <div className={MD_CLASS}>
          <p className="text-muted-foreground">{runEndText}</p>
        </div>
      ) : null}
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
