// process-summary.ts — generate a human-readable summary of the execution process
// for display in the collapsed ExecutionProcessBlock header.
//
// Example output: "运行了3个命令，查看了2个文件，编辑了1个文件"
// With other tools: "运行了1个命令，2个浏览器操作"

import type { ToolExecutionOutline, ToolExecutionItem } from '../execution-outline'
import type { ContentBlock } from '@renderer/lib/api/types'
import type { AssistantRenderItem } from './types'
import type { TFunction } from 'i18next'

const WEB_CONTEXT_TOOL_NAMES = new Set(['WebFetch', 'WebSearch', 'BrowserSearch'])

interface CategoryCount {
  commands: number
  reads: number
  edits: number
  browser: number
  desktop: number
  orchestration: number
  mcp: number
  interactive: number
  visual: number
  skill: number
  other: number
}

function classifyItem(item: ToolExecutionItem): keyof CategoryCount {
  if (WEB_CONTEXT_TOOL_NAMES.has(item.name) || item.name.startsWith('Browser')) return 'browser'

  switch (item.category) {
    case 'command': return 'commands'
    case 'context': return 'reads'
    case 'file-change': return 'edits'
    case 'browser': return 'browser'
    case 'desktop': return 'desktop'
    case 'orchestration': return 'orchestration'
    case 'mcp': return 'mcp'
    case 'interactive': return 'interactive'
    case 'visual': return 'visual'
    case 'skill': return 'skill'
    case 'attention':
    case 'unknown':
    default:
      return 'other'
  }
}

/**
 * Extract a file path from a tool execution item's input.
 * Returns null for tools without a file path (e.g. WebSearch, Grep without path).
 */
function getItemFilePath(item: ToolExecutionItem): string | null {
  const input = item.input
  if (!input || typeof input !== 'object') return null
  // Read/Write/Edit/Delete use file_path
  const filePath = input.file_path ?? input.filePath ?? input.path
  if (typeof filePath === 'string' && filePath.length > 0) return filePath
  return null
}

/**
 * Generate a compact summary string from the tool execution outline.
 */
export function buildProcessSummary(
  outline: ToolExecutionOutline | null,
  _thinkingBlockCount: number,
  t: TFunction
): string | null {
  if (!outline) return null

  const visibleItems = outline.items.filter((item) => item.visibility !== 'hidden')
  if (visibleItems.length === 0) return null

  const counts: CategoryCount = {
    commands: 0, reads: 0, edits: 0,
    browser: 0, desktop: 0, orchestration: 0,
    mcp: 0, interactive: 0, visual: 0, skill: 0, other: 0,
  }

  // Deduplicate reads and edits by file path — same file accessed multiple
  // times should only count as 1 in the summary.
  const seenReadFiles = new Set<string>()
  const seenEditFiles = new Set<string>()

  for (const item of visibleItems) {
    const category = classifyItem(item)
    if (category === 'reads') {
      const fp = getItemFilePath(item)
      if (fp) {
        if (seenReadFiles.has(fp)) continue
        seenReadFiles.add(fp)
      }
    } else if (category === 'edits') {
      const fp = getItemFilePath(item)
      if (fp) {
        if (seenEditFiles.has(fp)) continue
        seenEditFiles.add(fp)
      }
    }
    counts[category] += 1
  }

  const parts: string[] = []

  if (counts.commands > 0)
    parts.push(t('workbench.summaryCommands', { count: counts.commands, defaultValue: `运行了${counts.commands}个命令` }))
  if (counts.reads > 0)
    parts.push(t('workbench.summaryReads', { count: counts.reads, defaultValue: `查看了${counts.reads}个文件` }))
  if (counts.edits > 0)
    parts.push(t('workbench.summaryEdits', { count: counts.edits, defaultValue: `编辑了${counts.edits}个文件` }))
  if (counts.browser > 0)
    parts.push(t('workbench.summaryBrowser', { count: counts.browser, defaultValue: `${counts.browser}个浏览器操作` }))
  if (counts.desktop > 0)
    parts.push(t('workbench.summaryDesktop', { count: counts.desktop, defaultValue: `${counts.desktop}个桌面操作` }))
  if (counts.orchestration > 0)
    parts.push(t('workbench.summaryOrchestration', { count: counts.orchestration, defaultValue: `调用了${counts.orchestration}个子Agent` }))
  if (counts.mcp > 0)
    parts.push(t('workbench.summaryMcp', { count: counts.mcp, defaultValue: `${counts.mcp}个MCP工具` }))
  if (counts.interactive > 0)
    parts.push(t('workbench.summaryInteractive', { count: counts.interactive, defaultValue: `${counts.interactive}个用户交互` }))
  if (counts.visual > 0)
    parts.push(t('workbench.summaryVisual', { count: counts.visual, defaultValue: `生成了${counts.visual}个可视化` }))
  if (counts.skill > 0)
    parts.push(t('workbench.summarySkill', { count: counts.skill, defaultValue: `${counts.skill}个技能调用` }))
  if (counts.other > 0)
    parts.push(t('workbench.summaryOther', { count: counts.other, defaultValue: `执行了${counts.other}个操作` }))

  return parts.length > 0 ? parts.join('，') : null
}


/**
 * Split render items into "process" (thinking/tool_use/tool-run/compact-summary)
 * and "final output" (text/image/image_error/agent_error) segments.
 *
 * From the end, skip text/image/image_error/agent_error blocks to find
 * the first "process" item. Items before and including that = process.
 * Items after = final output.
 *
 * hasProcessContent is true only when there are tool calls in the process —
 * thinking-only without tools is too simple to collapse.
 */
export function splitProcessAndFinal(
  items: AssistantRenderItem[],
  normalizedContent: ContentBlock[] | null
): {
  processItems: AssistantRenderItem[]
  finalItems: AssistantRenderItem[]
  hasProcessContent: boolean
} {
  const finalOutputStartIndex = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'block') {
        const block = normalizedContent?.[item.index]
        if (block && (block.type === 'text' || block.type === 'image' || block.type === 'image_error' || block.type === 'agent_error')) {
          continue
        }
      }
      return i + 1
    }
    return 0
  })()

  const processItems = items.slice(0, finalOutputStartIndex)
  const finalItems = items.slice(finalOutputStartIndex)

  const hasToolCallsInProcess = processItems.some((item) => {
    if (item.kind === 'tool-run') return true
    if (item.kind === 'block') {
      const block = normalizedContent?.[item.index]
      return block?.type === 'tool_use'
    }
    return false
  })

  return {
    processItems,
    finalItems,
    hasProcessContent: hasToolCallsInProcess
  }
}
