import * as React from 'react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { AgentRunFileChange } from '@renderer/stores/agent-store'
import { useShallow } from 'zustand/react/shallow'
import type {
  ContentBlock, UnifiedMessage
} from '@renderer/lib/api/types'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { TASK_TOOL_NAME } from '@renderer/lib/agent/sub-agents/create-tool'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useMemoizedTokens } from '@renderer/hooks/use-estimated-tokens'
import { getLastDebugInfo } from '@renderer/lib/debug-store'
import {
  getLiveOutputComponentClass
} from '@renderer/lib/live-output-animation'
import type { ToolCallState } from '@renderer/lib/agent/types'
import {
  buildToolExecutionOutline,
  type ToolExecutionRun
} from '../execution-outline'

import { useCompletionSummary } from './use-completion-summary'
import { AssistantActionBar } from './action-bar'
import { ContentRenderer } from './content-renderer'
import type {
  AssistantMessageProps,
  AssistantRenderItem,
  AssistantRenderItemWithInlineSummary, InlineCompactSummaryEntry
} from './types'
import {
  EMPTY_LIVE_TOOL_CALLS, EMPTY_INLINE_COMPACT_SUMMARIES, EMPTY_ID_LIST
} from './types'
import { stripThinkTags, normalizeStructuredBlocks, parseThinkTags } from './think-parser'
import {
  resolveRunChangeSetForMessage, resolveLatestSessionRunChangeSet
} from './run-change-utils'
import { summarizeWorkspaceTools } from './utils'

export function AssistantMessage({
  content,
  isStreaming,
  usage,
  toolResults,
  liveToolCallMap,
  inlineCompactSummaries = EMPTY_INLINE_COMPACT_SUMMARIES,
  msgId,
  sessionId,
  sessionAssistantMessageIds = EMPTY_ID_LIST,
  sessionToolUseIds = EMPTY_ID_LIST,
  showRetry,
  showContinue,
  isLastAssistantMessage,
  onRetry,
  onContinue,
  onDelete,
  renderMode = 'default',
  orchestrationRun,
  hiddenToolUseIds,
  requestDebugInfo,
  meta,
  createdAt,
  memoryRecall
}: AssistantMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const devMode = useSettingsStore((s) => s.devMode)
  const liveOutputAnimationStyle = useSettingsStore((s) => s.liveOutputAnimationStyle)
  const liveComponentClassName = isStreaming
    ? getLiveOutputComponentClass(liveOutputAnimationStyle)
    : ''
  const liveScaleInClassName = liveComponentClassName
    ? `w-full origin-left ${liveComponentClassName}`
    : 'w-full origin-left'
  const liveFadeInClassName = liveComponentClassName ? `w-full ${liveComponentClassName}` : 'w-full'
  const debugInfo = devMode
    ? ((msgId ? getLastDebugInfo(msgId) : undefined) ?? requestDebugInfo)
    : undefined
  const [collapsed, setCollapsed] = useState(false)
  const sessionModelBinding = useChatStore(
    useShallow((state) => {
      const sessionIndex = sessionId ? state.sessionsById[sessionId] : undefined
      const session = sessionIndex !== undefined ? state.sessions[sessionIndex] : undefined
      return {
        providerId: session?.providerId ?? null,
        modelId: session?.modelId ?? null
      }
    })
  )
  const thinkingModel = useProviderStore(
    useShallow((state) => {
      const providerId = sessionModelBinding.providerId ?? state.activeProviderId
      const provider = providerId ? state.providers.find((item: any) => item.id === providerId) : null
      const fallbackModelId =
        provider?.defaultModel ??
        provider?.models.find((item: any) => item.enabled)?.id ??
        provider?.models[0]?.id ??
        ''
      const modelId =
        sessionModelBinding.modelId ??
        (provider?.id === state.activeProviderId ? state.activeModelId : fallbackModelId)
      const model = provider?.models.find((item: any) => item.id === modelId)

      return {
        modelId: modelId || null,
        modelName: model?.name ?? modelId ?? 'AI',
        modelIcon: model?.icon,
        providerName: provider?.name ?? null,
        providerBuiltinId: provider?.builtinId
      }
    })
  )
  const canEditGeneratedImages = useProviderStore((state) => {
    if (renderMode !== 'default') return false

    const providerId = sessionModelBinding.providerId ?? state.activeProviderId
    if (!providerId) return false

    const provider = state.providers.find((item: any) => item.id === providerId)
    if (!provider) return false

    const fallbackModelId =
      provider.defaultModel ??
      provider.models.find((item: any) => item.enabled)?.id ??
      provider.models[0]?.id ??
      ''
    const resolvedModelId =
      sessionModelBinding.modelId ??
      (provider.id === state.activeProviderId ? state.activeModelId : fallbackModelId)
    const model = provider.models.find((item: any) => item.id === resolvedModelId)
    const requestType = model?.type ?? provider.type

    return requestType === 'openai-responses'
  })

  // Memoize the plain text extraction for token estimation (used only when no API usage)
  const plainTextForTokens = useMemo(() => {
    if (usage || isStreaming) return '' // skip expensive computation when API provides usage
    if (typeof content === 'string') return stripThinkTags(content)
    if (!Array.isArray(content)) return ''
    return content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => stripThinkTags(b.text))
      .join('\n')
  }, [content, usage, isStreaming])
  const fallbackTokens = useMemoizedTokens(plainTextForTokens)

  const isLiveMode = renderMode === 'default'

  const isGeneratingImage = useChatStore((s) =>
    isLiveMode && msgId ? !!s.generatingImageMessages[msgId] : false
  )
  const imageGenerationTiming = useChatStore((s) =>
    isLiveMode && msgId ? s.imageGenerationTimings[msgId] : undefined
  )
  const generatingImagePreview = useChatStore((s) =>
    isLiveMode && msgId ? s.generatingImagePreviews?.[msgId] : undefined
  )

  const stringSegments = useMemo(
    () => (typeof content === 'string' ? parseThinkTags(content) : null),
    [content]
  )
  const compactSummaryRawBoundaryIndices = useMemo(() => {
    const indices = new Set<number>()
    if (!msgId || inlineCompactSummaries.length === 0 || !Array.isArray(content)) return indices

    for (const message of inlineCompactSummaries) {
      const anchor = message.meta?.compactSummary?.displayAnchor
      if (!anchor || anchor.assistantMessageId !== msgId) continue
      const afterContentBlockCount = Number.isFinite(anchor.afterContentBlockCount)
        ? Math.max(0, Math.floor(anchor.afterContentBlockCount))
        : 0
      if (afterContentBlockCount > 0) indices.add(afterContentBlockCount - 1)
    }

    return indices
  }, [content, inlineCompactSummaries, msgId])
  const normalizedContent = useMemo(
    () =>
      Array.isArray(content)
        ? normalizeStructuredBlocks(content, {
            preserveBoundaryAfterRawIndices: compactSummaryRawBoundaryIndices
          })
        : null,
    [compactSummaryRawBoundaryIndices, content]
  )
  const messageToolUseIds = useMemo(() => {
    if (!normalizedContent) return []
    return normalizedContent
      .filter(
        (block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
      )
      .map((block) => block.id)
  }, [normalizedContent])
  const runChangeSet = useAgentStore((s) => {
    if (!isLiveMode) return undefined

    const directChangeSet = resolveRunChangeSetForMessage(
      s.runChangesByRunId,
      msgId,
      sessionId,
      messageToolUseIds
    )

    if (directChangeSet) return directChangeSet

    return isLastAssistantMessage
      ? resolveLatestSessionRunChangeSet(
          s.runChangesByRunId,
          sessionId,
          sessionAssistantMessageIds,
          sessionToolUseIds
        )
      : undefined
  })
  const refreshRunChanges = useAgentStore((s) => s.refreshRunChanges)
  const refreshSessionRunChanges = useAgentStore((s) => s.refreshSessionRunChanges)

  const liveToolCallIds = useMemo(() => {
    if (!isStreaming) return []
    return messageToolUseIds
  }, [isStreaming, messageToolUseIds])
  const liveToolCalls = useAgentStore(
    useShallow((s) => {
      if (!isLiveMode || liveToolCallMap || !isStreaming || liveToolCallIds.length === 0) {
        return EMPTY_LIVE_TOOL_CALLS
      }
      const idSet = new Set(liveToolCallIds)
      const matches: ToolCallState[] = []
      for (const toolCall of s.pendingToolCalls) {
        if (idSet.has(toolCall.id)) matches.push(toolCall)
      }
      for (const toolCall of s.executedToolCalls) {
        if (idSet.has(toolCall.id)) matches.push(toolCall)
      }
      return matches
    })
  )
  const effectiveLiveToolCallMap = useMemo(() => {
    if (liveToolCallMap) return liveToolCallMap
    if (!isStreaming || liveToolCalls.length === 0) return null
    const map = new Map<string, ToolCallState>()
    for (const toolCall of liveToolCalls) {
      map.set(toolCall.id, toolCall)
    }
    return map
  }, [isStreaming, liveToolCalls, liveToolCallMap])
  const orchestrationAnchorIndex = useMemo(() => {
    if (!normalizedContent || orchestrationRun?.kind !== 'team') return -1
    return normalizedContent.findIndex(
      (block) =>
        block.type === 'tool_use' && block.name === TASK_TOOL_NAME && !block.input.run_in_background
    )
  }, [normalizedContent, orchestrationRun])
  const outlineHiddenToolUseIds = useMemo(() => {
    if (!hiddenToolUseIds) return undefined

    const ids = new Set(hiddenToolUseIds)
    for (const block of normalizedContent ?? []) {
      if (block.type === 'tool_use' && block.name === TASK_TOOL_NAME) {
        ids.delete(block.id)
      }
    }
    return ids.size === hiddenToolUseIds.size ? hiddenToolUseIds : ids
  }, [hiddenToolUseIds, normalizedContent])
  const trackedChangeByToolUseId = useMemo(() => {
    const map = new Map<string, AgentRunFileChange>()
    for (const change of runChangeSet?.changes ?? []) {
      if (change.toolUseId) {
        map.set(change.toolUseId, change)
      }
    }
    return map
  }, [runChangeSet])
  const inlineCompactSummaryEntries = useMemo(() => {
    if (!msgId || inlineCompactSummaries.length === 0) return []
    const rawBlocks = Array.isArray(content) ? content : null

    const entries: InlineCompactSummaryEntry[] = []
    for (const message of inlineCompactSummaries) {
      const anchor = message.meta?.compactSummary?.displayAnchor
      if (!anchor || anchor.assistantMessageId !== msgId) continue

      const afterContentBlockCount = Number.isFinite(anchor.afterContentBlockCount)
        ? Math.max(0, Math.floor(anchor.afterContentBlockCount))
        : 0
      const normalizedPrefixCount = rawBlocks
        ? normalizeStructuredBlocks(rawBlocks.slice(0, afterContentBlockCount), {
            preserveBoundaryAfterRawIndices: compactSummaryRawBoundaryIndices
          }).length
        : afterContentBlockCount

      entries.push({
        message,
        afterContentBlockCount,
        afterNormalizedBlockIndex: Math.max(-1, normalizedPrefixCount - 1),
        ...(anchor.afterToolUseId ? { afterToolUseId: anchor.afterToolUseId } : {})
      })
    }

    return entries.sort((a, b) => a.afterNormalizedBlockIndex - b.afterNormalizedBlockIndex)
  }, [compactSummaryRawBoundaryIndices, content, inlineCompactSummaries, msgId])
  const toolRunBoundaryAfterToolUseIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of inlineCompactSummaryEntries) {
      if (entry.afterToolUseId) ids.add(entry.afterToolUseId)
    }
    return ids
  }, [inlineCompactSummaryEntries])
  const toolRunBoundaryAfterBlockIndices = useMemo(() => {
    const indices = new Set<number>()
    for (const entry of inlineCompactSummaryEntries) {
      if (entry.afterNormalizedBlockIndex >= 0) indices.add(entry.afterNormalizedBlockIndex)
    }
    return indices
  }, [inlineCompactSummaryEntries])
  const toolExecutionOutline = useMemo(
    () =>
      buildToolExecutionOutline({
        blocks: normalizedContent,
        isStreaming,
        toolResults,
        liveToolCallMap: effectiveLiveToolCallMap,
        boundaryAfterBlockIndices: toolRunBoundaryAfterBlockIndices,
        boundaryAfterToolUseIds: toolRunBoundaryAfterToolUseIds,
        hiddenToolUseIds: outlineHiddenToolUseIds,
        t
      }),
    [
      effectiveLiveToolCallMap,
      normalizedContent,
      isStreaming,
      outlineHiddenToolUseIds,
      t,
      toolResults,
      toolRunBoundaryAfterBlockIndices,
      toolRunBoundaryAfterToolUseIds
    ]
  )
  const toolRunSummaryById = useMemo(() => {
    const summaryById = new Map<string, string>()
    for (const run of toolExecutionOutline.runs) {
      const ordinaryIds = new Set(run.ordinaryItemIds)
      const runBlocks = run.itemIds
        .map((toolUseId) => toolExecutionOutline.itemByToolUseId.get(toolUseId))
        .map((item) => (item ? normalizedContent?.[item.blockIndex] : null))
        .filter((block): block is ContentBlock => !!block)
      summaryById.set(
        run.id,
        summarizeWorkspaceTools(runBlocks, t, {
          toolResults,
          liveToolCallMap: effectiveLiveToolCallMap,
          shouldIncludeTool: (block) => ordinaryIds.has(block.id)
        })
      )
    }
    return summaryById
  }, [
    effectiveLiveToolCallMap,
    normalizedContent,
    t,
    toolExecutionOutline.itemByToolUseId,
    toolExecutionOutline.runs,
    toolResults
  ])
  const [toolRunCollapseState, setToolRunCollapseState] = useState<{
    msgId?: string
    collapsedByRunId: Record<string, boolean>
  }>({
    msgId,
    collapsedByRunId: {}
  })
  const getToolRunCollapsed = useCallback(
    (run: ToolExecutionRun): boolean => {
      if (toolRunCollapseState.msgId !== msgId) return run.defaultCollapsed
      return toolRunCollapseState.collapsedByRunId[run.id] ?? run.defaultCollapsed
    },
    [msgId, toolRunCollapseState]
  )
  const toggleToolRunCollapsed = useCallback(
    (run: ToolExecutionRun): void => {
      setToolRunCollapseState((current) => {
        const currentCollapsed =
          current.msgId === msgId
            ? (current.collapsedByRunId[run.id] ?? run.defaultCollapsed)
            : run.defaultCollapsed
        return {
          msgId,
          collapsedByRunId: {
            ...(current.msgId === msgId ? current.collapsedByRunId : {}),
            [run.id]: !currentCollapsed
          }
        }
      })
    },
    [msgId]
  )
  const hasStructuredThinkingBlocks = useMemo(
    () => normalizedContent?.some((block) => block.type === 'thinking') ?? false,
    [normalizedContent]
  )
  const lastStructuredTextIdx = useMemo(() => {
    if (!isStreaming || !normalizedContent) return -1
    return normalizedContent.reduce(
      (acc: number, block, idx) => (block.type === 'text' ? idx : acc),
      -1
    )
  }, [isStreaming, normalizedContent])
  useEffect(() => {
    if (!isLiveMode || !msgId || isStreaming) return
    void refreshRunChanges(msgId, {
      ...(sessionId ? { sessionId } : {}),
      ...(messageToolUseIds.length > 0 ? { toolUseIds: messageToolUseIds } : {})
    })
    if (isLastAssistantMessage && sessionId) {
      void refreshSessionRunChanges(sessionId, {
        ...(sessionAssistantMessageIds.length > 0
          ? { assistantMessageIds: [...sessionAssistantMessageIds] }
          : {}),
        ...(sessionToolUseIds.length > 0 ? { toolUseIds: [...sessionToolUseIds] } : {})
      })
    }
  }, [
    isLastAssistantMessage,
    isLiveMode,
    isStreaming,
    messageToolUseIds,
    msgId,
    refreshRunChanges,
    refreshSessionRunChanges,
    sessionAssistantMessageIds,
    sessionId,
    sessionToolUseIds
  ])

  const renderItems = useMemo(() => {
    if (!normalizedContent) return []

    const items: AssistantRenderItem[] = []
    for (let i = 0; i < normalizedContent.length; i++) {
      const block = normalizedContent[i]
      if (block.type === 'tool_use') {
        const run = toolExecutionOutline.runByStartBlockIndex.get(i)
        if (run) {
          items.push({ kind: 'tool-run', runId: run.id })
          i = run.endBlockIndex
          continue
        }

        const executionItem = toolExecutionOutline.itemByToolUseId.get(block.id)
        if (executionItem && executionItem.visibility !== 'hidden') {
          items.push({ kind: 'block', index: i })
        }
        continue
      }
      items.push({ kind: 'block', index: i })
    }
    return items
  }, [normalizedContent, toolExecutionOutline])
  const renderItemsWithInlineSummaries = useMemo<AssistantRenderItemWithInlineSummary[]>(() => {
    if (!normalizedContent || inlineCompactSummaryEntries.length === 0) return renderItems

    const summariesByInsertIndex = new Map<number, UnifiedMessage[]>()

    const getItemMaxBlockIndex = (item: AssistantRenderItem): number => {
      if (item.kind === 'block') return item.index
      return toolExecutionOutline.runById.get(item.runId)?.endBlockIndex ?? -1
    }

    const itemContainsToolUseId = (item: AssistantRenderItem, toolUseId: string): boolean => {
      if (item.kind === 'tool-run') {
        return toolExecutionOutline.runById.get(item.runId)?.itemIds.includes(toolUseId) ?? false
      }
      return [item.index].some((index) => {
        const block = normalizedContent[index]
        return block?.type === 'tool_use' && block.id === toolUseId
      })
    }

    const findLastItemAtOrBeforeBlockIndex = (afterBlockIndex: number): number => {
      let insertAfterIndex = -1
      for (let index = 0; index < renderItems.length; index += 1) {
        if (getItemMaxBlockIndex(renderItems[index]) <= afterBlockIndex) {
          insertAfterIndex = index
        }
      }
      return insertAfterIndex
    }

    for (const entry of inlineCompactSummaryEntries) {
      let insertAfterIndex = findLastItemAtOrBeforeBlockIndex(entry.afterNormalizedBlockIndex)
      const afterToolUseId = entry.afterToolUseId
      if (insertAfterIndex < 0 && afterToolUseId) {
        insertAfterIndex = renderItems.findIndex((item) =>
          itemContainsToolUseId(item, afterToolUseId)
        )
      }

      const existing = summariesByInsertIndex.get(insertAfterIndex)
      if (existing) {
        existing.push(entry.message)
      } else {
        summariesByInsertIndex.set(insertAfterIndex, [entry.message])
      }
    }

    const items: AssistantRenderItemWithInlineSummary[] = []
    const pushSummaries = (insertAfterIndex: number): void => {
      for (const message of summariesByInsertIndex.get(insertAfterIndex) ?? []) {
        items.push({ kind: 'compact-summary', message })
      }
    }

    pushSummaries(-1)
    for (let index = 0; index < renderItems.length; index += 1) {
      items.push(renderItems[index])
      pushSummaries(index)
    }

    return items
  }, [inlineCompactSummaryEntries, normalizedContent, renderItems, toolExecutionOutline.runById])

  const renderContent = (): React.JSX.Element => {
    return (
      <ContentRenderer
        content={content}
        isStreaming={isStreaming}
        normalizedContent={normalizedContent}
        stringSegments={stringSegments}
        renderItemsWithInlineSummaries={renderItemsWithInlineSummaries}
        renderMode={renderMode}
        thinkingModelName={thinkingModel.modelName}
        liveComponentClassName={liveComponentClassName}
        liveScaleInClassName={liveScaleInClassName}
        liveFadeInClassName={liveFadeInClassName}
        liveOutputAnimationStyle={liveOutputAnimationStyle}
        hasStructuredThinkingBlocks={hasStructuredThinkingBlocks}
        lastStructuredTextIdx={lastStructuredTextIdx}
        isGeneratingImage={isGeneratingImage}
        imageGenerationTiming={imageGenerationTiming}
        generatingImagePreview={generatingImagePreview as { source: { type: string; data?: string; mediaType?: string; url?: string; filePath?: string } } | null | undefined}
        toolExecutionOutline={toolExecutionOutline}
        toolRunSummaryById={toolRunSummaryById}
        getToolRunCollapsed={getToolRunCollapsed}
        toggleToolRunCollapsed={toggleToolRunCollapsed}
        orchestrationRun={orchestrationRun}
        orchestrationAnchorIndex={orchestrationAnchorIndex}
        toolResults={toolResults}
        effectiveLiveToolCallMap={effectiveLiveToolCallMap}
        isLastAssistantMessage={isLastAssistantMessage}
        hiddenToolUseIds={outlineHiddenToolUseIds}
        sessionId={sessionId}
        trackedChangeByToolUseId={trackedChangeByToolUseId}
        canEditGeneratedImages={canEditGeneratedImages}
        t={t}
      />
    )
  }

  const plainText =
    typeof content === 'string'
      ? stripThinkTags(content)
      : Array.isArray(content)
        ? content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => stripThinkTags(b.text))
            .join('\n')
        : ''

  const completionSummary = useCompletionSummary({
    usage,
    fallbackTokens,
    meta,
    renderMode,
    requestDebugInfo,
    msgId,
    sessionModelBinding,
    thinkingModel
  })

  return (
    <AssistantActionBar
      isStreaming={!!isStreaming}
      plainText={plainText}
      isLiveMode={isLiveMode}
      sessionId={sessionId}
      msgId={msgId}
      showRetry={showRetry}
      showContinue={showContinue}
      onRetry={onRetry}
      onContinue={onContinue}
      onDelete={onDelete}
      devMode={devMode}
      debugInfo={debugInfo}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      renderMode={renderMode}
      renderContent={renderContent}
      completionSummary={completionSummary}
      createdAt={createdAt}
      t={t}
      memoryRecall={memoryRecall}
    />
  )
}
