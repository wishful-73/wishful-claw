// Renders a single tool_use block as the appropriate tool card

import * as React from 'react'
import { ScaleIn, FadeIn } from '@renderer/components/animate-ui'
import type { ContentBlock, ToolResultContent } from '@renderer/lib/api/types'
import type { ToolCallState } from '@renderer/lib/agent/types'
import type { AgentRunFileChange } from '@renderer/stores/agent-store'
import type { OrchestrationRun } from '@renderer/lib/orchestration/types'
import type { TFunction } from 'i18next'
import {
  buildToolExecutionOutline, INTERACTIVE_TOOL_NAMES
} from '../execution-outline'
import { shouldRenderToolAsLine } from '../render-density'
import { useDensityPolicy } from '../use-density-override'
import { ProcessTextLine } from './process-text-line'
import { AskUserQuestionCard } from '../AskUserQuestionCard'
import { PlanReviewCard } from '../PlanReviewCard'
import { GoalConfirmCard } from '../GoalConfirmCard'
import { ToolCallCard, WidgetOutputBlock } from '../ToolCallCard'
import { FileChangeCard } from '../FileChangeCard'
import { BashArtifactsCard } from '../BashArtifactsCard'
import { SubAgentCard } from '../SubAgentCard'
import { TeamEventCard } from '../TeamEventCard'
import { OrchestrationBlock } from '../OrchestrationBlock'
import { ImagePluginToolCard } from '../ImagePluginToolCard'
import { BrowserToolCard } from '../BrowserToolCard'
import { CodeGraphToolCard } from '../CodeGraphToolCard'
import { DesktopActionToolCard } from '../DesktopActionToolCard'
import { TASK_TOOL_NAME } from '@renderer/lib/agent/sub-agents/create-tool'
import { TEAM_TOOL_NAMES } from '@renderer/lib/agent/teams/register'
import {
  DESKTOP_CLICK_TOOL_NAME, DESKTOP_SCREENSHOT_TOOL_NAME, DESKTOP_SCROLL_TOOL_NAME,
  DESKTOP_TYPE_TOOL_NAME, DESKTOP_WAIT_TOOL_NAME, IMAGE_GENERATE_TOOL_NAME
} from '@renderer/lib/app-plugin/types'
import { isBrowserToolName } from '@renderer/lib/app-plugin/browser-tool-names'
import {
  resolveToolCallStatus, resolvePendingToolCallStatus,
  mergeWidgetToolInput, buildToolCallRenderState,
  shouldShowToolInMessageList, decodeBashArtifacts
} from './utils'

/**
 * S-248：这些工具在纯文本档也不降级成一行 —— 它们的存在形式就是卡片。
 *
 * 交互类（答题 / 审批 / 目标确认）一行字点不了，功能直接消失；
 * 子 agent / 团队事件 / 生成图 / widget / 桌面截图，输出本身就是结果或者有展开内容。
 */
export const PROCESS_LINE_CARD_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...INTERACTIVE_TOOL_NAMES,
  TASK_TOOL_NAME,
  ...TEAM_TOOL_NAMES,
  IMAGE_GENERATE_TOOL_NAME,
  'visualize_show_widget',
  DESKTOP_SCREENSHOT_TOOL_NAME
])

export interface ToolBlockRendererProps {
  block: Extract<ContentBlock, { type: 'tool_use' }>
  blockIndex: number
  toolExecutionOutline: ReturnType<typeof buildToolExecutionOutline>
  hiddenToolUseIds?: Set<string>
  orchestrationRun?: OrchestrationRun | null
  orchestrationAnchorIndex: number
  isStreaming: boolean | undefined
  isLastAssistantMessage?: boolean
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  effectiveLiveToolCallMap?: Map<string, ToolCallState> | null
  liveScaleInClassName: string
  liveFadeInClassName: string
  sessionId?: string | null
  trackedChangeByToolUseId: Map<string, AgentRunFileChange>
  t: TFunction
}

export function ToolBlockRenderer({
  block,
  blockIndex,
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
}: ToolBlockRendererProps): React.JSX.Element | null {
  // S-248：档位要读在最前面 —— 下面有多个早退，hook 不能藏在条件分支里。
  const { density } = useDensityPolicy()
  const executionItem = toolExecutionOutline.itemByToolUseId.get(block.id)
  if (
    executionItem?.visibility === 'hidden' ||
    (!executionItem && !shouldShowToolInMessageList(block.name))
  ) {
    return null
  }
  if (hiddenToolUseIds?.has(block.id)) {
    const isOrchestrationAnchor =
      orchestrationRun?.kind === 'team' &&
      block.name === TASK_TOOL_NAME &&
      !block.input.run_in_background &&
      blockIndex === orchestrationAnchorIndex
    if (block.name !== TASK_TOOL_NAME && !isOrchestrationAnchor) return null
  }

  // S-248：纯文本档换形态 —— 过程降级成一行文本，卡片壳整个不渲染（也不可点）。
  const liveToolCall = effectiveLiveToolCallMap?.get(block.id)
  const toolResult = toolResults?.get(block.id)
  const toolOutput = toolResult?.content ?? liveToolCall?.output
  const lineStatus: string = executionItem?.status ?? (isStreaming ? 'streaming' : 'completed')
  if (
    shouldRenderToolAsLine({
      density,
      toolName: block.name,
      status: lineStatus,
      requiresApproval: !!executionItem?.requiresApproval,
      hasVisualResult:
        block.name === IMAGE_GENERATE_TOOL_NAME ||
        block.name === 'visualize_show_widget' ||
        block.name === DESKTOP_SCREENSHOT_TOOL_NAME ||
        (isBrowserToolName(block.name) &&
          (block.input as { action?: string }).action === 'screenshot') ||
        !!decodeBashArtifacts(toolOutput),
      keepAsCardToolNames: PROCESS_LINE_CARD_ONLY_TOOL_NAMES
    })
  ) {
    return (
      <ProcessTextLine
        name={block.name}
        summary={executionItem?.summary ?? ''}
        status={lineStatus}
        hasError={!!executionItem?.hasError || !!liveToolCall?.error}
        startedAt={liveToolCall?.startedAt}
        completedAt={liveToolCall?.completedAt}
        input={block.input}
        trackedChange={trackedChangeByToolUseId.get(block.id)}
      />
    )
  }

  if (block.name === 'AskUserQuestion') {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const shouldUsePendingFallback = isLastAssistantMessage && !result && !liveTc
    const statusValue = shouldUsePendingFallback
      ? resolvePendingToolCallStatus(true, liveTc, result)
      : (executionItem?.status ?? resolvePendingToolCallStatus(isStreaming, liveTc, result))
    return (
      <ScaleIn className={liveScaleInClassName}>
        <AskUserQuestionCard
          toolUseId={block.id}
          input={block.input}
          output={result?.content ?? liveTc?.output}
          status={statusValue}
          isLive={!!isStreaming}
        />
      </ScaleIn>
    )
  }
  if (block.name === 'SubmitPlanReview') {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const shouldUsePendingFallback = isLastAssistantMessage && !result && !liveTc
    const statusValue = shouldUsePendingFallback
      ? resolvePendingToolCallStatus(true, liveTc, result)
      : (executionItem?.status ?? resolvePendingToolCallStatus(isStreaming, liveTc, result))
    return (
      <ScaleIn className={liveScaleInClassName}>
        <PlanReviewCard
          output={result?.content ?? liveTc?.output}
          status={statusValue}
          isLive={!!isStreaming}
          sessionId={sessionId}
        />
      </ScaleIn>
    )
  }
  if (block.name === 'create_goal') {
    return (
      <ScaleIn className={liveScaleInClassName}>
        <GoalConfirmCard sessionId={sessionId} />
      </ScaleIn>
    )
  }
  if (block.name === 'visualize_show_widget') {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const widgetInput = mergeWidgetToolInput(block.input, liveTc?.input)
    const statusValue =
      executionItem?.status ?? resolvePendingToolCallStatus(isStreaming, liveTc, result)
    return (
      <ScaleIn className={liveScaleInClassName}>
        <WidgetOutputBlock input={widgetInput} status={statusValue} />
      </ScaleIn>
    )
  }
  if (TEAM_TOOL_NAMES.has(block.name)) {
    const result = toolResults?.get(block.id)
    return (
      <FadeIn className={liveFadeInClassName}>
        <TeamEventCard
          name={block.name}
          input={block.input}
          output={result?.content}
          status={executionItem?.status}
          error={executionItem?.error}
        />
      </FadeIn>
    )
  }
  if (block.name === TASK_TOOL_NAME) {
    const result = toolResults?.get(block.id)
    return (
      <React.Fragment>
        {orchestrationRun?.kind === 'team' && blockIndex === orchestrationAnchorIndex ? (
          <FadeIn className={liveFadeInClassName}>
            <OrchestrationBlock run={orchestrationRun} />
          </FadeIn>
        ) : null}
        <ScaleIn className={liveScaleInClassName}>
          <SubAgentCard
            name={block.name}
            toolUseId={block.id}
            input={block.input}
            output={result?.content}
            isLive={!!isStreaming}
            sessionId={sessionId}
            isBackground={block.input.background === true || block.input.run_in_background === true}
          />
        </ScaleIn>
      </React.Fragment>
    )
  }
  if (['Write', 'Edit', 'Delete'].includes(block.name)) {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const statusValue =
      executionItem?.status ?? resolveToolCallStatus(isStreaming, liveTc, result)
    return (
      <ScaleIn className={liveScaleInClassName}>
        <FileChangeCard
          name={block.name}
          input={block.input}
          output={result?.content ?? liveTc?.output}
          status={statusValue}
          error={liveTc?.error}
          startedAt={liveTc?.startedAt}
          completedAt={liveTc?.completedAt}
          trackedChange={trackedChangeByToolUseId.get(block.id)}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (block.name === IMAGE_GENERATE_TOOL_NAME) {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const statusValue =
      executionItem?.status ?? resolveToolCallStatus(isStreaming, liveTc, result)
    return (
      <ScaleIn className={liveScaleInClassName}>
        <ImagePluginToolCard
          toolUseId={block.id}
          input={liveTc?.input ?? block.input}
          output={result?.content ?? liveTc?.output}
          status={statusValue}
          error={liveTc?.error}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (isBrowserToolName(block.name)) {
    const toolCallState = buildToolCallRenderState(block, {
      isStreaming,
      toolResults,
      liveToolCallMap: effectiveLiveToolCallMap,
      executionItem
    })
    return (
      <ScaleIn className={liveScaleInClassName}>
        <BrowserToolCard
          name={toolCallState.name}
          input={toolCallState.input}
          output={toolCallState.output}
          status={toolCallState.status}
          error={toolCallState.error}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (block.name.startsWith('codegraph_')) {
    const toolCallState = buildToolCallRenderState(block, {
      isStreaming,
      toolResults,
      liveToolCallMap: effectiveLiveToolCallMap,
      executionItem
    })
    return (
      <ScaleIn className={liveScaleInClassName}>
        <CodeGraphToolCard
          name={toolCallState.name}
          input={toolCallState.input}
          output={toolCallState.output}
          status={toolCallState.status}
          error={toolCallState.error}
          startedAt={toolCallState.startedAt}
          completedAt={toolCallState.completedAt}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (
    block.name === DESKTOP_SCREENSHOT_TOOL_NAME ||
    block.name === DESKTOP_CLICK_TOOL_NAME ||
    block.name === DESKTOP_TYPE_TOOL_NAME ||
    block.name === DESKTOP_SCROLL_TOOL_NAME ||
    block.name === DESKTOP_WAIT_TOOL_NAME
  ) {
    const result = toolResults?.get(block.id)
    const liveTc = effectiveLiveToolCallMap?.get(block.id)
    const statusValue =
      executionItem?.status ?? resolveToolCallStatus(isStreaming, liveTc, result)
    return (
      <ScaleIn className={liveScaleInClassName}>
        <DesktopActionToolCard
          name={block.name}
          input={block.input}
          output={liveTc?.output ?? result?.content}
          status={statusValue}
          error={liveTc?.error}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (block.name === 'Skill') {
    const toolCallState = buildToolCallRenderState(block, {
      isStreaming,
      toolResults,
      liveToolCallMap: effectiveLiveToolCallMap,
      executionItem
    })
    return (
      <ScaleIn className={liveScaleInClassName}>
        <ToolCallCard
          toolUseId={toolCallState.toolUseId}
          name={toolCallState.name}
          input={toolCallState.input}
          output={toolCallState.output}
          status={toolCallState.status}
          error={toolCallState.error}
          startedAt={toolCallState.startedAt}
          completedAt={toolCallState.completedAt}
          forceOpen={executionItem?.forceExpanded}
        />
      </ScaleIn>
    )
  }
  if (block.name === 'Bash' || block.name === 'Shell') {
    const toolCallState = buildToolCallRenderState(block, {
      isStreaming,
      toolResults,
      liveToolCallMap: effectiveLiveToolCallMap,
      executionItem
    })
    const bashArtifacts = decodeBashArtifacts(toolCallState.output)
    return (
      <ScaleIn className={liveScaleInClassName}>
        <ToolCallCard
          toolUseId={toolCallState.toolUseId}
          name={toolCallState.name}
          input={toolCallState.input}
          output={toolCallState.output}
          status={toolCallState.status}
          error={toolCallState.error}
          startedAt={toolCallState.startedAt}
          completedAt={toolCallState.completedAt}
          forceOpen={executionItem?.forceExpanded}
        />
        {bashArtifacts ? (
          <BashArtifactsCard
            artifacts={bashArtifacts.artifacts}
            truncated={bashArtifacts.truncated}
          />
        ) : null}
      </ScaleIn>
    )
  }

  // Generic ToolCallCard
  const toolCallState = buildToolCallRenderState(block, {
    isStreaming,
    toolResults,
    liveToolCallMap: effectiveLiveToolCallMap,
    executionItem
  })
  return (
    <ScaleIn className={liveScaleInClassName}>
      <ToolCallCard
        toolUseId={toolCallState.toolUseId}
        name={toolCallState.name}
        input={toolCallState.input}
        output={toolCallState.output}
        status={toolCallState.status}
        error={toolCallState.error}
        startedAt={toolCallState.startedAt}
        completedAt={toolCallState.completedAt}
        forceOpen={executionItem?.forceExpanded}
      />
    </ScaleIn>
  )
}
