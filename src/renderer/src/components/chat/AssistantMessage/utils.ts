// Extracted pure utility functions for AssistantMessage

import type { ContentBlock, ToolResultContent } from '@renderer/lib/api/types'
import type { ToolCallState, ToolCallStatus } from '@renderer/lib/agent/types'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { formatDurationMs } from '@renderer/lib/format-duration'
import { isMcpTool } from '@renderer/lib/mcp/mcp-tools'
import {
  isHiddenExecutionToolName,
  isOrdinaryContextToolName
} from '../execution-outline'
import type { ToolCallRenderState, BashArtifactEntry } from './types'

export function formatRetryDelay(delayMs: number): string {
  // S-245：秒档不带小数 —— 统一走 formatDurationMs（ms 档保精度，1s 以上取整）。
  return formatDurationMs(delayMs)
}

export function resolveToolCallStatus(
  isStreaming: boolean | undefined,
  liveToolCall: ToolCallState | undefined,
  result?: { isError?: boolean }
): ToolCallStatus | 'completed' {
  if (result) return result.isError ? 'error' : 'completed'
  if (liveToolCall?.status) return liveToolCall.status
  return isStreaming ? 'streaming' : 'canceled'
}

export function resolvePendingToolCallStatus(
  isRunningFallback: boolean | undefined,
  liveToolCall: ToolCallState | undefined,
  result?: { isError?: boolean; content?: ToolResultContent }
): ToolCallStatus | 'completed' {
  if (result) return result.isError ? 'error' : 'completed'
  if (liveToolCall?.status) return liveToolCall.status
  return isRunningFallback ? 'running' : 'canceled'
}

function getWidgetRenderCode(input?: Record<string, unknown>): string {
  if (!input) return ''
  if (typeof input.widget_code === 'string') return input.widget_code
  if (typeof input.widget_code_preview === 'string') return input.widget_code_preview
  return ''
}

export function mergeWidgetToolInput(
  blockInput: Record<string, unknown>,
  liveInput?: Record<string, unknown>
): Record<string, unknown> {
  if (!liveInput || Object.keys(liveInput).length === 0) return blockInput
  if (!blockInput || Object.keys(blockInput).length === 0) return liveInput

  const merged: Record<string, unknown> = { ...blockInput, ...liveInput }
  const blockCode = getWidgetRenderCode(blockInput)
  const liveCode = getWidgetRenderCode(liveInput)

  if (blockCode && (!liveCode || blockCode.length > liveCode.length)) {
    if (typeof blockInput.widget_code === 'string') {
      merged.widget_code = blockInput.widget_code
    } else if (typeof blockInput.widget_code_preview === 'string') {
      merged.widget_code_preview = blockInput.widget_code_preview
    }
  }

  if (
    typeof blockInput.widget_code_chars === 'number' &&
    typeof liveInput.widget_code_chars === 'number'
  ) {
    merged.widget_code_chars = Math.max(blockInput.widget_code_chars, liveInput.widget_code_chars)
  }

  return merged
}

export function buildToolCallRenderState(
  block: Extract<ContentBlock, { type: 'tool_use' }>,
  options: {
    isStreaming?: boolean
    toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
    liveToolCallMap?: Map<string, ToolCallState> | null
    executionItem?: { status?: ToolCallStatus | 'completed'; error?: string; forceExpanded?: boolean }
  }
): ToolCallRenderState {
  const result = options.toolResults?.get(block.id)
  const liveToolCall = options.liveToolCallMap?.get(block.id)
  const liveInput = liveToolCall?.input
  const effectiveInput = liveInput && Object.keys(liveInput).length > 0 ? liveInput : block.input
  const status =
    options.executionItem?.status ??
    resolveToolCallStatus(options.isStreaming, liveToolCall, result)
  return {
    id: block.id,
    toolUseId: block.id,
    name: block.name,
    input: effectiveInput,
    output: result?.content ?? liveToolCall?.output,
    status,
    error: options.executionItem?.error ?? liveToolCall?.error,
    startedAt: liveToolCall?.startedAt,
    completedAt: liveToolCall?.completedAt
  }
}

export function shouldShowToolInMessageList(name: string): boolean {
  return !isHiddenExecutionToolName(name)
}

export function decodeBashArtifacts(
  output: ToolResultContent | undefined
): { artifacts: BashArtifactEntry[]; truncated?: number } | null {
  if (typeof output !== 'string') return null
  const decoded = decodeStructuredToolResult(output)
  if (!decoded || Array.isArray(decoded)) return null
  const artifacts = decoded.artifacts
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null

  const entries = artifacts.filter(
    (entry): entry is BashArtifactEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as BashArtifactEntry).path === 'string' &&
      typeof (entry as BashArtifactEntry).size === 'number'
  )
  if (entries.length === 0) return null

  const truncated =
    typeof decoded.artifactsTruncated === 'number' ? decoded.artifactsTruncated : undefined
  return { artifacts: entries, truncated }
}

function isWorkspaceCollapsibleTool(name: string): boolean {
  return shouldShowToolInMessageList(name) && isOrdinaryContextToolName(name)
}

export function summarizeWorkspaceTools(
  blocks: ContentBlock[] | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  options: {
    aggregatedChanges?: Array<{ op: string; filePath: string }>
    toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
    liveToolCallMap?: Map<string, ToolCallState> | null
    shouldIncludeTool?: (block: Extract<ContentBlock, { type: 'tool_use' }>) => boolean
  } = {}
): string {
  if (!blocks) return ''

  const counts = new Map<string, number>()
  const createdPaths = new Set<string>()
  const editedPaths = new Set<string>()
  const deletedPaths = new Set<string>()

  const toolResultText = (content: ToolResultContent | undefined): string | null => {
    if (!content) return null
    if (typeof content === 'string') return content
    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim()
    return text || null
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  const inferWriteKind = (
    block: Extract<ContentBlock, { type: 'tool_use' }>
  ): 'create' | 'edit' => {
    const output =
      options.liveToolCallMap?.get(block.id)?.output ?? options.toolResults?.get(block.id)?.content
    const outputText = toolResultText(output)
    if (outputText) {
      const decoded = decodeStructuredToolResult(outputText)
      if (isRecord(decoded) && decoded.op === 'modify') {
        return 'edit'
      }
    }
    return 'create'
  }

  const isFailedFileTool = (block: Extract<ContentBlock, { type: 'tool_use' }>): boolean => {
    const liveToolCall = options.liveToolCallMap?.get(block.id)
    if (liveToolCall?.status === 'error' || liveToolCall?.error) return true

    const result = options.toolResults?.get(block.id)
    if (result?.isError) return true

    const outputText = toolResultText(liveToolCall?.output ?? result?.content)
    if (!outputText) return false

    const decoded = decodeStructuredToolResult(outputText)
    if (!isRecord(decoded) || typeof decoded.error !== 'string') return false

    return decoded.success === false || Object.keys(decoded).length === 1
  }

  for (const change of options.aggregatedChanges ?? []) {
    if (change.op === 'create') {
      createdPaths.add(change.filePath)
    } else {
      editedPaths.add(change.filePath)
    }
  }

  for (const block of blocks) {
    if (block.type !== 'tool_use' || !isWorkspaceCollapsibleTool(block.name)) continue
    if (options.shouldIncludeTool && !options.shouldIncludeTool(block)) continue
    counts.set(block.name, (counts.get(block.name) ?? 0) + 1)

    const filePath = block.input.file_path ?? block.input.path
    if (typeof filePath !== 'string' || !filePath.trim()) continue

    if (['Write', 'Edit', 'Delete'].includes(block.name) && isFailedFileTool(block)) {
      continue
    }

    if (block.name === 'Delete') {
      deletedPaths.add(filePath)
      continue
    }

    if ((options.aggregatedChanges?.length ?? 0) > 0) continue

    if (block.name === 'Edit') {
      editedPaths.add(filePath)
      continue
    }

    if (block.name === 'Write') {
      if (inferWriteKind(block) === 'edit') {
        editedPaths.add(filePath)
      } else {
        createdPaths.add(filePath)
      }
    }
  }

  const parts: string[] = []
  const createdCount = createdPaths.size
  const editedCount = editedPaths.size
  const deletedCount = deletedPaths.size
  const changedFileCount = createdCount + editedCount + deletedCount

  if (createdCount > 0) {
    parts.push(t('assistantMessage.createdFiles', { count: createdCount }))
  }
  if (editedCount > 0) {
    parts.push(t('assistantMessage.editedFiles', { count: editedCount }))
  }
  if (deletedCount > 0) {
    parts.push(t('assistantMessage.deletedFiles', { count: deletedCount }))
  }
  if (parts.length === 0 && changedFileCount > 0) {
    parts.push(t('assistantMessage.changedFiles', { count: changedFileCount }))
  }

  const commandCount =
    (counts.get('Bash') ?? 0) + (counts.get('Shell') ?? 0) + (counts.get('PowerShell') ?? 0)
  if (commandCount > 0) parts.push(t('assistantMessage.ranCommandsInline', { count: commandCount }))

  const readCount = counts.get('Read') ?? 0
  if (readCount > 0) {
    parts.push(t('toolGroup.readActions', { count: readCount, defaultValue: '读取 {{count}} 次' }))
  }

  const searchCount = (counts.get('Grep') ?? 0) + (counts.get('Glob') ?? 0)
  if (searchCount > 0) {
    parts.push(
      t('toolGroup.searchActions', { count: searchCount, defaultValue: '搜索 {{count}} 次' })
    )
  }

  const listDirCount = counts.get('LS') ?? 0
  if (listDirCount > 0) {
    parts.push(
      t('toolGroup.listDirActions', { count: listDirCount, defaultValue: '列目录 {{count}} 次' })
    )
  }

  const mcpCallCount = [...counts.entries()].reduce(
    (total, [name, count]) => total + (isMcpTool(name) ? count : 0),
    0
  )
  if (mcpCallCount > 0) {
    parts.push(
      t('toolGroup.mcpCalls', { count: mcpCallCount, defaultValue: '调用 MCP {{count}} 次' })
    )
  }

  const coveredTools = new Set([
    'Write', 'Edit', 'Delete', 'NotebookEdit', 'SavePlan',
    'Bash', 'Shell', 'PowerShell', 'Read', 'Grep', 'Glob', 'LS'
  ])
  const fallbackEntries = [...counts.entries()]
    .filter(([name]) => !coveredTools.has(name) && !isMcpTool(name))
    .sort(([a], [b]) => a.localeCompare(b))
  parts.push(...fallbackEntries.map(([name, count]) => `${name}${count > 1 ? ` x${count}` : ''}`))

  const visibleParts = parts.slice(0, 3)
  const summary = visibleParts.join(t('assistantMessage.summarySeparator', { defaultValue: ', ' }))
  const hiddenKinds = parts.length - visibleParts.length

  return hiddenKinds > 0
    ? `${summary}${t('assistantMessage.summarySeparator', { defaultValue: ', ' })}${t(
        'assistantMessage.moreKinds',
        {
          count: hiddenKinds,
          defaultValue: `+${hiddenKinds}`
        }
      )}`
    : summary
}

export function stripThinkTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*think\s*>/gi, '')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function formatTokenMetric(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0
  if (safeValue < 1_000) return String(Math.round(safeValue))
  if (safeValue < 1_000_000) return `${(safeValue / 1_000).toFixed(1)}K`
  return `${(safeValue / 1_000_000).toFixed(safeValue < 10_000_000 ? 2 : 1)}M`
}

export function formatPreciseDurationMs(ms: number): string {
  // S-245 有意**不**收敛到 formatDurationMs：本函数唯一的调用点是
  // `use-completion-summary.ts` 的 TTFT（首字延迟）。那是**性能指标不是耗时读数** ——
  // 1.2s 与 1.8s 的差别对排查有意义，取整就把信号抹平了。
  // 口径分界：这件事做了多久 → 取整（formatDurationMs）；快不快 → 保留精度（本函数）。
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds - minutes * 60
  return `${minutes}m ${remaining.toFixed(0)}s`
}

export function formatThroughput(value: number): string {
  if (value < 1) return value.toFixed(2)
  if (value < 10) return value.toFixed(1)
  return Math.round(value).toString()
}
