import { BrowserWindow } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import { safeSendMessagePackToWindow } from '../window-ipc'
import { isAgentStreamEnvelope } from '../../shared/messagepack/agent-stream-codec'
import { AdaptiveEventBatcher } from './batcher/adaptive-event-batcher'

/**
 * Registers a listener on the native worker for 'agent/stream' events
 * and forwards them to all renderer windows as MessagePack-encoded payloads.
 *
 * Forwarding every raw delta saturates the renderer when the model and the
 * tools are both fast, so envelopes go through AdaptiveEventBatcher first:
 * aggregatable deltas are coalesced per frame, control events pass straight
 * through (iter-34 S-135).
 */
export function registerAgentStreamForwarder(): void {
  const worker = getNativeWorker()
  const batcher = new AdaptiveEventBatcher()

  batcher.setHandler((envelope) => {
    for (const win of BrowserWindow.getAllWindows()) {
      safeSendMessagePackToWindow(win, 'agent:stream', envelope)
    }
  })

  worker.onEvent('agent/stream', (payload: unknown) => {
    if (!isAgentStreamEnvelope(payload)) return
    for (const event of payload.events) {
      batcher.push(payload.runId, payload.sessionId, event)
    }
  })
}
