/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { ContentBlock, ToolResultContent } from '@renderer/lib/api/types'
import type { ToolCallState, ToolCallStatus } from '@renderer/lib/agent/types'
import { TASK_TOOL_NAME } from '@renderer/lib/agent/sub-agents/create-tool'
import type { ChatRenderDensity } from '@renderer/stores/settings-store-types'
import { deriveToolRunCollapsed } from './render-density'
import { inputSummary } from '@renderer/components/chat/tool-call-summary'

export type ToolExecutionVisibility = 'hidden' | 'ordinary' | 'force'

export type ToolExecutionCategory =
  | 'attention'
  | 'browser'
  | 'command'
  | 'context'
  | 'desktop'
  | 'file-change'
  | 'hidden'
  | 'interactive'
  | 'mcp'
  | 'orchestration'
  | 'skill'
  | 'visual'
  | 'unknown'

export interface ToolExecutionItem {
  toolUseId: string
  name: string
  blockIndex: number
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  summary: string
  category: ToolExecutionCategory
  visibility: ToolExecutionVisibility
  forceExpanded: boolean
  hasError: boolean
  isActive: boolean
  requiresApproval: boolean
  groupKey: string
}

export interface ToolExecutionRun {
  id: string
  startBlockIndex: number
  endBlockIndex: number
  itemIds: string[]
  ordinaryItemIds: string[]
  forceVisibleItemIds: string[]
  activeCount: number
  totalItemCount: number
  ordinaryItemCount: number
  /** S-271：run 内失败项数（折叠头据此出红色徽章，替代「把失败卡拎到面板外」）。 */
  failedCount: number
  /**
   * S-315：这一段是否已经**真的结束**（后面渲染出了下一段输出/思考，或整条消息已结束）。
   *
   * 与 `activeCount === 0` 不是一回事：工具之间那个「上一个跑完、下一个还没来」的
   * 小空隙里 `activeCount` 也是 0，但这一段并没有结束。拿 `activeCount` 当折叠判据，
   * 就是让折叠块每完成一个工具收放一次。
   */
  sealed: boolean
  defaultCollapsed: boolean
  showToggle: boolean
  activeSummary: string | null
}

export interface ToolExecutionOutline {
  items: ToolExecutionItem[]
  runs: ToolExecutionRun[]
  itemByToolUseId: Map<string, ToolExecutionItem>
  runById: Map<string, ToolExecutionRun>
  runByStartBlockIndex: Map<number, ToolExecutionRun>
  ordinaryItemIds: string[]
  forceVisibleItemIds: Set<string>
  activeCount: number
  totalItemCount: number
  ordinaryItemCount: number
  defaultCollapsed: boolean
  showToggle: boolean
  activeSummary: string | null
}

export type ToolResultEntry = { content: ToolResultContent; isError?: boolean }

export type TranslationFn = (key: string, options?: Record<string, unknown>) => string

interface BuildToolExecutionOutlineOptions {
  blocks: ContentBlock[] | null
  isStreaming?: boolean
  toolResults?: Map<string, ToolResultEntry>
  liveToolCallMap?: Map<string, ToolCallState> | null
  boundaryAfterBlockIndices?: Set<number>
  boundaryAfterToolUseIds?: Set<string>
  hiddenToolUseIds?: Set<string>
  /** S-225 渲染档位。缺省按 compact（= 1.0.1 线上行为），既有调用点不传也安全。 */
  density?: ChatRenderDensity
  t: TranslationFn
}

// S-315：分类判据（工具名 → 类别 → 可见性）已拆到 execution-outline.classify.ts，
// 主文件只留「怎么切分段、怎么算折叠」的算法。这里保留同名转出，调用点不用改。
export {
  isHiddenExecutionToolName,
  isOrdinaryContextToolName,
  isCommandToolName,
  INTERACTIVE_TOOL_NAMES
} from './execution-outline.classify'

import {
  buildActiveSummary,
  getToolCategory,
  getToolVisibility,
  hasStructuredOutputError,
  outputTextForSummary,
  resolveToolStatus
} from './execution-outline.classify'

export function buildToolExecutionOutline({
  blocks,
  isStreaming,
  toolResults,
  liveToolCallMap,
  boundaryAfterBlockIndices,
  boundaryAfterToolUseIds,
  hiddenToolUseIds,
  density = 'compact',
  t
}: BuildToolExecutionOutlineOptions): ToolExecutionOutline {
  const items: ToolExecutionItem[] = []
  const runs: ToolExecutionRun[] = []
  const itemByToolUseId = new Map<string, ToolExecutionItem>()
  const runById = new Map<string, ToolExecutionRun>()
  const runByStartBlockIndex = new Map<number, ToolExecutionRun>()
  const ordinaryItemIds: string[] = []
  const forceVisibleItemIds = new Set<string>()
  let pendingRun: {
    startBlockIndex: number
    endBlockIndex: number
    itemIds: string[]
  } | null = null

  /**
   * 收掉当前这一段连续工具调用。
   *
   * `sealed` 由调用方给出（S-315）：只有「后面真的出现了其它内容」或「整条消息已结束」
   * 才算这一段结束。子 agent 卡片的隔离、流未结束时的兜底收尾都不算 —— 那只是把 run
   * 切开、让子 agent 卡站在正确的位置，之后随时可能还有工具进来。
   */
  const closePendingRun = (sealed: boolean): void => {
    if (!pendingRun) return

    const runItems = pendingRun.itemIds
      .map((toolUseId) => itemByToolUseId.get(toolUseId))
      .filter((item): item is ToolExecutionItem => !!item)
    const visibleItems = runItems.filter((item) => item.visibility !== 'hidden')

    if (visibleItems.length > 0) {
      const ordinaryRunItemIds = runItems
        .filter((item) => item.visibility === 'ordinary')
        .map((item) => item.toolUseId)
      const forceRunItemIds = runItems
        .filter((item) => item.visibility === 'force')
        .map((item) => item.toolUseId)
      const activeItems = visibleItems.filter((item) => item.isActive)
      const activeItem = activeItems[activeItems.length - 1]
      // S-271：失败信号收在 run 上 —— 只数可见项，hidden 的失败用户本来也看不见。
      const failedCount = visibleItems.filter((item) => item.hasError).length
      const run: ToolExecutionRun = {
        id: `tool-run:${visibleItems[0].toolUseId}`,
        startBlockIndex: pendingRun.startBlockIndex,
        endBlockIndex: pendingRun.endBlockIndex,
        itemIds: [...pendingRun.itemIds],
        ordinaryItemIds: ordinaryRunItemIds,
        forceVisibleItemIds: forceRunItemIds,
        activeCount: activeItems.length,
        totalItemCount: visibleItems.length,
        ordinaryItemCount: ordinaryRunItemIds.length,
        failedCount,
        sealed,
        defaultCollapsed: deriveToolRunCollapsed(
          density,
          ordinaryRunItemIds.length,
          sealed
        ),
        showToggle: ordinaryRunItemIds.length > 0,
        activeSummary: activeItem ? buildActiveSummary(activeItem, t) : null
      }

      runs.push(run)
      runById.set(run.id, run)
      runByStartBlockIndex.set(run.startBlockIndex, run)
    }

    pendingRun = null
  }

  for (let blockIndex = 0; blockIndex < (blocks?.length ?? 0); blockIndex += 1) {
    const block = blocks?.[blockIndex]
    if (!block || (block.type !== 'tool_use' && block.type !== 'tool_result')) {
      // 这就是「下一段输出或思考来了」—— 唯一真正的封口信号（S-315）。
      closePendingRun(true)
      continue
    }
    // tool_result blocks are inline results appended after their tool_use;
    // skip them without breaking the current tool run.
    if (block.type === 'tool_result') {
      continue
    }

    // A Task owns a visible SubAgent card at this exact content position. Isolate it from
    // adjacent ordinary tools so a collapsed Read/Edit run can never hide or move the card.
    const isSubAgentTask = block.name === TASK_TOOL_NAME
    // 只是为了让子 agent 卡站在正确的位置，不等于这一段结束了（S-315）。
    if (isSubAgentTask) closePendingRun(false)

    const result = toolResults?.get(block.id)
    const liveToolCall = liveToolCallMap?.get(block.id)
    const liveInput = liveToolCall?.input
    const input = liveInput && Object.keys(liveInput).length > 0 ? liveInput : block.input
    const output = result?.content ?? liveToolCall?.output
    const baseStatus = resolveToolStatus(isStreaming, liveToolCall, result)
    const hasError =
      baseStatus === 'error' ||
      !!result?.isError ||
      !!liveToolCall?.error ||
      hasStructuredOutputError(block.name, output)
    const status: ToolCallStatus | 'completed' = hasError ? 'error' : baseStatus
    const requiresApproval = liveToolCall?.requiresApproval === true
    const category = getToolCategory({
      name: block.name,
      status,
      requiresApproval
    })
    const visibility = hiddenToolUseIds?.has(block.id) ? 'hidden' : getToolVisibility(category)
    const isActive = status === 'streaming' || status === 'running' || status === 'pending_approval'
    const summary = inputSummary(block.name, input, outputTextForSummary(block.name, output))
    const item: ToolExecutionItem = {
      toolUseId: block.id,
      name: block.name,
      blockIndex,
      input,
      output,
      status,
      error: liveToolCall?.error,
      summary,
      category,
      visibility,
      forceExpanded: isActive || requiresApproval,
      hasError,
      isActive,
      requiresApproval,
      groupKey: visibility === 'ordinary' ? `context:${block.name}` : `tool:${block.id}`
    }

    items.push(item)
    itemByToolUseId.set(block.id, item)

    if (!pendingRun) {
      pendingRun = {
        startBlockIndex: blockIndex,
        endBlockIndex: blockIndex,
        itemIds: []
      }
    }
    pendingRun.endBlockIndex = blockIndex
    pendingRun.itemIds.push(block.id)

    if (visibility === 'ordinary') {
      ordinaryItemIds.push(block.id)
    } else if (visibility === 'force') {
      forceVisibleItemIds.add(block.id)
    }

    if (
      isSubAgentTask ||
      boundaryAfterToolUseIds?.has(block.id) ||
      boundaryAfterBlockIndices?.has(blockIndex)
    ) {
      // 强制分段同理：切开不等于结束（S-315）。
      closePendingRun(false)
    }
  }

  // 流还没结束时兜底收尾，这一段随时可能有新工具进来 ⇒ 未封口；
  // 流已结束则这就是最后一段，可以收起（S-315）。
  closePendingRun(!isStreaming)

  const activeItems = items.filter((item) => item.visibility !== 'hidden' && item.isActive)
  const activeItem = activeItems[activeItems.length - 1]
  const activeSummary = activeItem ? buildActiveSummary(activeItem, t) : null
  const totalItemCount = items.filter((item) => item.visibility !== 'hidden').length

  return {
    items,
    runs,
    itemByToolUseId,
    runById,
    runByStartBlockIndex,
    ordinaryItemIds,
    forceVisibleItemIds,
    activeCount: activeItems.length,
    totalItemCount,
    ordinaryItemCount: ordinaryItemIds.length,
    defaultCollapsed: deriveToolRunCollapsed(density, ordinaryItemIds.length, !isStreaming),
    showToggle: ordinaryItemIds.length > 0,
    activeSummary
  }
}
