import { create } from 'zustand'
import type { AgentStreamEnvelope } from '@shared/agent-stream-protocol'
import { isActivityPanelEvent } from '@renderer/lib/agent/stream-event-adapter'

export interface ActivityItem {
  id: string
  type: string
  iteration?: number
  stopReason?: string
  timestamp: number
  details?: string
  debugInfo?: {
    url: string
    model?: string
    bodyBytes?: number
  }
}

interface ActivityState {
  activities: ActivityItem[]
  currentIteration: number

  addActivity: (item: ActivityItem) => void
  clearActivities: () => void
  handleEnvelope: (envelope: AgentStreamEnvelope) => void
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  currentIteration: 0,

  addActivity: (item) => {
    set((state) => ({ activities: [...state.activities, item] }))
  },

  clearActivities: () => {
    set({ activities: [], currentIteration: 0 })
  },

  handleEnvelope: (envelope) => {
    for (const event of envelope.events) {
      if (!isActivityPanelEvent(event)) continue

      switch (event.type) {
        case 'iteration_start':
          set({ currentIteration: event.iteration })
          get().addActivity({
            id: `iter_start_${envelope.seq}_${event.iteration}`,
            type: 'iteration_start',
            iteration: event.iteration,
            timestamp: Date.now()
          })
          break

        case 'iteration_end':
          get().addActivity({
            id: `iter_end_${envelope.seq}_${get().currentIteration}`,
            type: 'iteration_end',
            iteration: get().currentIteration,
            stopReason: event.stopReason,
            timestamp: Date.now()
          })
          break

        case 'context_compression_started':
        case 'context_compression_start':
          get().addActivity({
            id: `compress_start_${envelope.seq}`,
            type: 'context_compression_started',
            timestamp: Date.now(),
            details: event.originalCount !== undefined
              ? `${event.originalCount} messages`
              : undefined
          })
          break

        case 'context_compressed':
          get().addActivity({
            id: `compress_done_${envelope.seq}`,
            type: 'context_compressed',
            timestamp: Date.now(),
            details: `${event.originalCount} → ${event.newCount} messages`
          })
          break

        case 'request_debug':
          get().addActivity({
            id: `debug_${envelope.seq}`,
            type: 'request_debug',
            timestamp: Date.now(),
            debugInfo: {
              url: event.debugInfo.url,
              model: event.debugInfo.model,
              bodyBytes: event.debugInfo.bodyBytes
            }
          })
          break

        case 'tool_use_streaming_start':
        case 'tool_call_start':
        case 'tool_call_result':
          get().addActivity({
            id: `tool_${envelope.seq}`,
            type: event.type,
            timestamp: Date.now(),
            details: 'toolName' in event ? event.toolName : undefined
          })
          break
      }
    }
  }
}))
