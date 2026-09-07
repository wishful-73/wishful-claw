import type { AgentStreamEvent } from '../../../../shared/agent-stream-protocol'

/**
 * Channel replies expose only assistant output and terminal error feedback.
 * Thinking, tool execution, retries, compression, diagnostics and UI-only
 * events stay inside the desktop transcript.
 */
export const CHANNEL_REPLY_EVENT_TYPES = new Set<AgentStreamEvent['type']>([
  'text_delta',
  'message_end',
  'loop_end',
  'error'
])

export function isChannelReplyEvent(event: AgentStreamEvent): boolean {
  return CHANNEL_REPLY_EVENT_TYPES.has(event.type)
}

export function isChannelReplyTextDelta(
  event: AgentStreamEvent
): event is Extract<AgentStreamEvent, { type: 'text_delta' }> {
  return event.type === 'text_delta'
}

export function isChannelReplyBoundary(event: AgentStreamEvent): boolean {
  return event.type === 'message_end' || event.type === 'loop_end'
}
