import type { AgentStreamEvent } from '../../../../shared/agent-stream-protocol'
import type { AgentEvent } from './types'
import type { SubAgentEvent } from './sub-agents/types'
import { isUseCapabilityTool, resolveProxyDisplay } from './use-capability-proxy'

/**
 * use_capability proxy rewrite: streaming-phase events carry the raw LLM tool
 * name before the Worker's ToolCallProcessor can rewrite display events. Apply
 * the same resolution here so every downstream store sees the real tool name.
 */
function rewriteProxyEvent<T extends Record<string, unknown>>(event: T): T {
  const name = event.name
  if (typeof name !== 'string' || !isUseCapabilityTool(name)) return event
  const input = event.input
  const resolved = resolveProxyDisplay(
    input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined
  )
  if (!resolved) return event
  return { ...event, name: resolved.name, input: resolved.input }
}

export function toAgentEvent(e: AgentStreamEvent): AgentEvent | null {
  switch (e.type) {
    case 'loop_start':
    case 'iteration_start':
    case 'text_phase':
    case 'text_delta':
    case 'thinking_delta':
    case 'translation_buffer_update':
    case 'image_generation_started':
    case 'context_compression_started':
    case 'context_compression_start':
    case 'tool_use_args_delta':
    case 'request_retry':
      return e as AgentEvent

    case 'thinking_encrypted':
      return {
        type: 'thinking_encrypted',
        thinkingEncryptedContent: e.content,
        thinkingEncryptedProvider: e.provider
      }

    case 'tool_use_streaming_start': {
      const rewritten = rewriteProxyEvent({
        toolCallId: e.toolCallId,
        name: e.toolName,
        input: {}
      })
      return {
        type: 'tool_use_streaming_start',
        toolCallId: e.toolCallId,
        toolName: (rewritten.name as string) ?? e.toolName,
        toolCallExtraContent: e.extraContent
      } as AgentEvent
    }

    case 'error':
      return {
        type: 'error',
        error: new Error(e.message),
        errorType: e.errorType,
        details: e.details,
        stackTrace: e.stackTrace
      }

    case 'image_generation_partial':
    case 'image_generated':
    case 'image_error':
    case 'web_search':
    case 'message_end':
    case 'iteration_end':
    case 'request_debug':
    case 'context_compressed':
    case 'memory_recall':
      return e as unknown as AgentEvent

    case 'tool_use_generated': {
      const block = (e as { toolUseBlock?: { id: string; name: string; input?: Record<string, unknown> } })
        .toolUseBlock
      if (block && isUseCapabilityTool(block.name)) {
        const resolved = resolveProxyDisplay(block.input)
        if (resolved) {
          return {
            ...e,
            toolUseBlock: { ...block, name: resolved.name, input: resolved.input }
          } as unknown as AgentEvent
        }
      }
      return e as unknown as AgentEvent
    }

    case 'tool_call_start':
    case 'tool_call_update':
    case 'tool_call_approval_needed':
    case 'tool_call_result':
      return rewriteProxyEvent(e as unknown as Record<string, unknown>) as unknown as AgentEvent

    case 'loop_end':
      return e as unknown as AgentEvent

    default:
      if ((e as { type: string }).type.startsWith('sub_agent_')) return null
      return null
  }
}

export function toSubAgentEvent(e: AgentStreamEvent): SubAgentEvent | null {
  if (!(e as { type: string }).type.startsWith('sub_agent_')) return null
  return e as unknown as SubAgentEvent
}

// wishful-claw compatibility: type guard for chat stream events
export function isChatStreamEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false
  const e = event as { type?: string }
  return typeof e.type === 'string'
}

// wishful-claw compatibility: type guard for activity panel events
export function isActivityPanelEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false
  const e = event as { type?: string }
  const activityTypes = [
    'tool_call_start',
    'tool_call_result',
    'text_delta',
    'thinking_delta',
    'message_end',
    'loop_start',
    'loop_end',
    'error',
    'context_compression_started',
    'context_compression_start',
    'context_compressed'
  ]
  return typeof e.type === 'string' && activityTypes.includes(e.type)
}
