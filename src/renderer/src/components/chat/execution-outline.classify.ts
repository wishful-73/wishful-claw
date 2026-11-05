/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

/*
 * 「一次工具调用属于哪一类、该不该给用户看」—— 从 execution-outline.ts 拆出来的。
 *
 * 拆的理由很实在：构建 run 的算法和这些分类判据是两件事，混在一起主文件已经贴着
 * 500 行硬线（AGENTS.md §大文件拆分），S-315 加两行就顶过去了。分类判据本身很少改，
 * 算法那块才常动 —— 分开之后各改各的，不用每次都在两百行常量表里找落点。
 *
 * 类型仍留在 execution-outline.ts，这里只做 type-only import，运行时不会形成循环依赖。
 */

import type { ToolResultContent } from '@renderer/lib/api/types'
import type { ToolCallState, ToolCallStatus } from '@renderer/lib/agent/types'
import { TASK_TOOL_NAME } from '@renderer/lib/agent/sub-agents/create-tool'
import { TEAM_TOOL_NAMES } from '@renderer/lib/agent/teams/register'
import { IMAGE_GENERATE_TOOL_NAME, DESKTOP_SCREENSHOT_TOOL_NAME } from '@renderer/lib/app-plugin/types'
import { isBrowserToolName } from '@renderer/lib/app-plugin/browser-tool-names'
import { isDesktopControlToolName } from '@renderer/lib/app-plugin/desktop-routing'
import { isMcpTool } from '@renderer/lib/mcp/mcp-tools'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { resolveToolDisplayName } from '@renderer/lib/tools/tool-display-name'
import type {
  ToolExecutionCategory,
  ToolExecutionItem,
  ToolExecutionVisibility,
  ToolResultEntry,
  TranslationFn
} from './execution-outline'

const COMMAND_TOOL_NAMES = new Set(['Bash', 'Shell', 'PowerShell'])
const HIDDEN_TOOL_NAMES = new Set([
  'TodoTaskCreate', 'TodoTaskGet', 'TodoTaskUpdate', 'TodoTaskList',
  // Legacy names for old persisted transcripts.
  'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
  // Plan step tracking is internal -- not user-facing
  'UpdatePlanStep',
  // Memory tools are internal agent operations — not user-facing
  'memory_hot_read', 'memory_hot_write',
  'memory_append', 'memory_update', 'memory_search',
  // Capability proxy: successfully resolved calls are re-emitted with the real
  // tool name; an unresolved use_capability card is noise, so hide it.
  'use_capability',
])
const ORDINARY_CONTEXT_TOOL_NAMES = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
  'BrowserSearch',
])
const FILE_CHANGE_TOOL_NAMES = new Set(['Write', 'Edit', 'Delete', 'NotebookEdit', 'SavePlan'])
export const INTERACTIVE_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'EnterPlanMode',
  'SubmitPlanReview',
  'Notify'
])

export function isHiddenExecutionToolName(name: string): boolean {
  return HIDDEN_TOOL_NAMES.has(name)
}

export function isOrdinaryContextToolName(name: string): boolean {
  return (
    ORDINARY_CONTEXT_TOOL_NAMES.has(name) ||
    COMMAND_TOOL_NAMES.has(name) ||
    FILE_CHANGE_TOOL_NAMES.has(name) ||
    isMcpTool(name)
  )
}

export function isCommandToolName(name: string): boolean {
  return COMMAND_TOOL_NAMES.has(name)
}

export function outputAsString(output: ToolResultContent | undefined): string | undefined {
  if (output === undefined) return undefined
  if (typeof output === 'string') return output
  const texts = output
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
  return texts.join('\n') || undefined
}

/**
 * S-286：喂给 `inputSummary` 的 output 文本（**只给摘要用**，别拿它去解析错误）。
 *
 * 摘要是「一行说清发生了什么」，只该看小且像人话的输出。截图类工具的 output 是一段
 * 字符串化的 content 数组，image 块里塞着几百 KB base64 —— 让 `inputSummary` 在上面
 * 跑正则等于大海捞针，命中什么全看运气（S-286 就是这么撞出个 `8×5` 的）。
 *
 * 两处**必须豁免**，别「顺手统一」掉：
 *
 * 1. **桌面截图** —— 它的尺寸就写在那段 text 里，必须拿原串；取对尺寸是
 *    `summarizeDesktopAction` 里那条锚定正则的活。
 * 2. **Bash / Shell / PowerShell** —— 它们的输出本身就是结构化 JSON
 *    （`{"exitCode":0,…}`），摘要要从里面取退出码和错误，短路等于丢信息。
 *
 * 判据刻意廉价、**不做 JSON.parse**：`inputSummary` 挂在渲染热路径上
 * （`ToolCallGroup` / `ToolCallCard` / 本文件三处都调），6 MB 串 parse 一次 30~60 ms。
 * 只用「长度 + 开头两字符 + 是否含 `"base64"`」三个零成本判断。
 *
 * ⚠️ 这条判据对**现有分支没有可观察效果**（读 output 的三个分支：桌面截图豁免、
 * 命令行豁免、`LS` 的输出是文件名列表）。它是给「将来新增一个读 output 的工具摘要」
 * 留的护栏 —— 到时候不必再去查 base64 撞正则这个坑。
 */
const OVERSIZED_STRUCTURED_MIN_LENGTH = 4096

function isOversizedStructuredPayload(text: string): boolean {
  if (text.length <= OVERSIZED_STRUCTURED_MIN_LENGTH) return false
  const head = text.slice(0, 2)
  if (head !== '[{' && head !== '{"') return false
  return text.includes('"base64"')
}

export function outputTextForSummary(
  name: string,
  output: ToolResultContent | undefined
): string | undefined {
  const text = outputAsString(output)
  if (text === undefined) return undefined
  if (name === DESKTOP_SCREENSHOT_TOOL_NAME) return text
  if (COMMAND_TOOL_NAMES.has(name)) return text
  return isOversizedStructuredPayload(text) ? undefined : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function hasStructuredOutputError(
  name: string,
  output: ToolResultContent | undefined
): boolean {
  const text = outputAsString(output)?.trim()
  if (!text) return false

  const decoded = decodeStructuredToolResult(text)
  if (!isRecord(decoded)) return false

  if (decoded.success === false) return true
  if (typeof decoded.error === 'string' && decoded.error.trim()) return true

  return (
    COMMAND_TOOL_NAMES.has(name) && typeof decoded.exitCode === 'number' && decoded.exitCode !== 0
  )
}

export function resolveToolStatus(
  isStreaming: boolean | undefined,
  liveToolCall: ToolCallState | undefined,
  result: ToolResultEntry | undefined
): ToolCallStatus | 'completed' {
  if (result?.isError) return 'error'
  if (liveToolCall?.status) return liveToolCall.status
  if (!result) return isStreaming ? 'streaming' : 'canceled'
  return 'completed'
}

export function getToolCategory(options: {
  name: string
  status: ToolCallStatus | 'completed'
  requiresApproval: boolean
}): ToolExecutionCategory {
  const { name, status, requiresApproval } = options
  if (HIDDEN_TOOL_NAMES.has(name)) return 'hidden'

  // S-271：错误不再单独把一项拉出折叠块。
  //
  // S-225 §8 的原意是「档位不得藏错误」，它的做法是 hasError ⇒ attention ⇒ force
  // ⇒ 渲染在折叠面板外。问题在于「渲染在面板外」会把一次失败从一段连续调用里硬拔出来，
  // 视觉上等于把连续操作劈成两段 —— 失败越少，劈得越突兀。
  // 现在改由 run 级的 `failedCount` 在折叠头给出信号（红色徽章 + 图标变红），
  // 错误本身仍然在面板里以错误态渲染，既不藏也不劈。
  //
  // 仍然必须露在面板外的只有「用户此刻必须做点什么」的两类：待审批 / 需要批准。
  if (status === 'pending_approval' || requiresApproval) {
    return 'attention'
  }

  // Classify by tool name first — ordinary context/command/file-change tools keep
  // their category even while running/streaming, so they stay grouped in a
  // collapsible run during concurrent execution instead of showing individually.
  if (isMcpTool(name)) return 'mcp'
  if (ORDINARY_CONTEXT_TOOL_NAMES.has(name)) return 'context'
  if (FILE_CHANGE_TOOL_NAMES.has(name)) return 'file-change'
  if (COMMAND_TOOL_NAMES.has(name)) return 'command'
  if (isBrowserToolName(name)) return 'browser'
  if (isDesktopControlToolName(name)) return 'desktop'
  if (INTERACTIVE_TOOL_NAMES.has(name)) return 'interactive'
  if (name === TASK_TOOL_NAME || TEAM_TOOL_NAMES.has(name)) return 'orchestration'
  if (name === IMAGE_GENERATE_TOOL_NAME || name === 'visualize_show_widget') return 'visual'
  if (name === 'Skill') return 'skill'

  // For non-ordinary (unknown) tools, running/streaming/canceled still needs attention
  if (status === 'streaming' || status === 'running' || status === 'canceled') {
    return 'attention'
  }
  return 'unknown'
}

export function getToolVisibility(category: ToolExecutionCategory): ToolExecutionVisibility {
  if (category === 'hidden') return 'hidden'
  if (
    category === 'context' ||
    category === 'mcp' ||
    category === 'command' ||
    category === 'file-change'
  ) {
    return 'ordinary'
  }
  return 'force'
}

export function buildActiveSummary(item: ToolExecutionItem, t: TranslationFn): string | null {
  if (!item.isActive) return null

  // S-270：走统一出口，缺中文标签时兜底成「工具 · 原名」，不再裸回退 camelCase。
  const tool = resolveToolDisplayName(item.name, t)
  const detail = item.summary ? `: ${item.summary}` : ''

  if (item.status === 'pending_approval' || item.requiresApproval) {
    return t('executionOutline.awaitingApproval', {
      tool,
      detail,
      defaultValue: 'Awaiting approval: {{tool}}{{detail}}'
    })
  }

  if (item.status === 'streaming') {
    return t('executionOutline.receiving', {
      tool,
      detail,
      defaultValue: 'Receiving {{tool}}{{detail}}'
    })
  }

  return t('executionOutline.running', {
    tool,
    detail,
    defaultValue: 'Running {{tool}}{{detail}}'
  })
}
