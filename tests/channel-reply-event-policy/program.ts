import assert from 'node:assert/strict'
import type { AgentStreamEvent } from '../../src/shared/agent-stream-protocol'
import {
  isChannelReplyBoundary,
  isChannelReplyEvent,
  isChannelReplyTextDelta
} from '../../src/renderer/src/lib/channel/channel-reply-event-policy'

const textDelta: AgentStreamEvent = { type: 'text_delta', text: 'reply' }
const messageEnd: AgentStreamEvent = { type: 'message_end' }
const loopEnd: AgentStreamEvent = { type: 'loop_end', reason: 'completed' }
const error: AgentStreamEvent = { type: 'error', message: 'failed' }

for (const event of [textDelta, messageEnd, loopEnd, error]) {
  assert.equal(isChannelReplyEvent(event), true, `${event.type} should be channel-visible`)
}

for (const event of [
  { type: 'thinking_delta', thinking: 'internal reasoning' },
  { type: 'tool_call_start', toolCall: {} },
  { type: 'tool_call_result', toolCall: {} },
  { type: 'request_retry', attempt: 1, maxAttempts: 2, delayMs: 100, reason: 'busy' },
  { type: 'context_compression_start' }
] as AgentStreamEvent[]) {
  assert.equal(isChannelReplyEvent(event), false, `${event.type} should stay internal`)
}

assert.equal(isChannelReplyTextDelta(textDelta), true)
assert.equal(isChannelReplyTextDelta(messageEnd), false)
assert.equal(isChannelReplyBoundary(messageEnd), true)
assert.equal(isChannelReplyBoundary(loopEnd), true)
assert.equal(isChannelReplyBoundary(textDelta), false)

console.log('channel reply event policy regression passed')
