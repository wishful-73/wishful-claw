import type {
  ContentBlock,
  ToolResultContent,
  ToolUseBlock,
  UnifiedMessage
} from '@renderer/lib/api/types'
import { isEditableUserMessage } from '@renderer/lib/image-attachments'
import {
  isCompactBoundaryMessage,
  isCompactSummaryLikeMessage
} from '@renderer/lib/agent/context-compression'
import { THINK_OPEN_TAG_RE } from './AssistantMessage/types'
import { TailToolExecutionState } from './transcript-utils'
import { HIDDEN_MESSAGE_LIST_TOOL_NAMES } from './transcript-utils'

export function isToolResultOnlyUserMessage(message: UnifiedMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

export function isRealUserMessage(message: UnifiedMessage): boolean {
  return isEditableUserMessage(message) && !isCompactSummaryLikeMessage(message)
}

export function hasVisibleAssistantBlock(block: ContentBlock): boolean {
  if (block.type === 'tool_use') {
    return !HIDDEN_MESSAGE_LIST_TOOL_NAMES.has(block.name)
  }

  if (block.type === 'text') {
    return block.text.trim().length > 0
  }

  if (block.type === 'thinking') {
    return block.thinking.trim().length > 0
  }

  return true
}

export function hasVisibleAssistantStringContent(content: string): boolean {
  if (!THINK_OPEN_TAG_RE.test(content)) {
    return content.trim().length > 0
  }

  const textWithoutThinking = content
    .replace(/<\s*think\s*>[\s\S]*?(<\s*\/\s*think\s*>|$)/gi, '')
    .replace(/<\s*\/?\s*think\s*>/gi, '')
    .trim()
  if (textWithoutThinking.length > 0) return true

  const thinkBlocks = content.matchAll(/<\s*think\s*>([\s\S]*?)(<\s*\/\s*think\s*>|$)/gi)
  for (const match of thinkBlocks) {
    if ((match[1] ?? '').replace(/<\s*\/?\s*think\s*>/gi, '').trim().length > 0) {
      return true
    }
  }

  return false
}

export function shouldRenderInMessageList(
  message: UnifiedMessage,
  activeCompactSummaryId: string | null,
  compressionStatusSummaryIds: ReadonlySet<string>
): boolean {
  if (message.role === 'system') {
    return Boolean(message.meta?.compressionStatus && !message.meta.compressionStatus.displayAnchor)
  }
  if (isCompactSummaryLikeMessage(message)) {
    return (
      !compressionStatusSummaryIds.has(message.id) && message.id === activeCompactSummaryId
    )
  }
  if (isToolResultOnlyUserMessage(message)) return false
  if (message.role !== 'assistant') return true
  if (typeof message.content === 'string') {
    return hasVisibleAssistantStringContent(message.content)
  }
  if (!Array.isArray(message.content)) return true
  return message.content.some(hasVisibleAssistantBlock)
}

export function isTransparentSystemMessage(message: UnifiedMessage): boolean {
  return message.role === 'system' && !isCompactBoundaryMessage(message)
}

export function collectToolResults(
  blocks: ContentBlock[],
  target: Map<string, { content: ToolResultContent; isError?: boolean }>
): void {
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      target.set(block.toolUseId, { content: block.content, isError: block.isError })
    }
  }
}

export function buildOrchestrationMessageBindingEntry(message: UnifiedMessage): string {
  if (message.role !== 'assistant') {
    return `${message.id}:${message.role}`
  }

  if (!Array.isArray(message.content)) {
    return `${message.id}:${message.role}:string`
  }

  const toolUseSignature = message.content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
    )
    .map((block) => {
      const teamName = typeof block.input.team_name === 'string' ? block.input.team_name.trim() : ''
      const runsInBackground = block.input.run_in_background === true ? 'bg' : 'fg'
      return `${block.id}:${block.name}:${teamName}:${runsInBackground}`
    })
    .join(',')

  return `${message.id}:${message.role}:blocks:${message.content.length}:${toolUseSignature}`
}

export function buildTailToolExecutionState(messages: UnifiedMessage[]): TailToolExecutionState | null {
  if (messages.length === 0) return null

  const toolResultMap = new Map<string, { content: ToolResultContent; isError?: boolean }>()
  let trailingToolResultMessageCount = 0
  let assistantIndex = messages.length - 1

  while (assistantIndex >= 0) {
    const message = messages[assistantIndex]
    if (isToolResultOnlyUserMessage(message)) {
      collectToolResults(message.content as ContentBlock[], toolResultMap)
      trailingToolResultMessageCount += 1
      assistantIndex -= 1
      continue
    }
    if (isTransparentSystemMessage(message)) {
      assistantIndex -= 1
      continue
    }
    break
  }

  if (assistantIndex < 0) return null

  const assistantMessage = messages[assistantIndex]
  if (assistantMessage.role !== 'assistant' || !Array.isArray(assistantMessage.content)) {
    return null
  }

  const toolUseBlocks = assistantMessage.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  )
  if (toolUseBlocks.length === 0) return null

  // If the model produced a final text response after its last tool call, the
  // turn is already complete and there is nothing to continue.
  const lastToolUseIndex = assistantMessage.content.reduce(
    (last, block, index) => (block.type === 'tool_use' ? index : last),
    -1
  )
  const hasTrailingText = assistantMessage.content.some(
    (block, index) =>
      index > lastToolUseIndex && block.type === 'text' && block.text.trim().length > 0
  )
  if (hasTrailingText) return null

  return {
    assistantIndex,
    assistantMessageId: assistantMessage.id,
    toolUseBlocks,
    toolResultMap,
    trailingToolResultMessageCount
  }
}

