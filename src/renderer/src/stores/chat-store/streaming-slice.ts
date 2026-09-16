import type { StateCreator } from 'zustand'
import type { SessionSlice } from './session-slice'
import type { ProjectSlice as _ProjectSlice } from './project-slice'
import type { ContentBlock, ToolUseBlock } from '@renderer/lib/api/types'

export interface ImageGenerationTiming {
  startedAt: number
  completedAt?: number
}

interface StreamingSliceState {
  streamingMessageId: string | null
  streamingMessages: Record<string, string>
  generatingImageMessages: Record<string, boolean>
  generatingImagePreviews: Record<string, unknown>
  imageGenerationTimings: Record<string, ImageGenerationTiming>

  setStreamingMessageId: (sessionId: string, id: string | null) => void
  setGeneratingImage: (msgId: string, generating: boolean, occurredAt?: number) => void

  // ─── Runtime sync stubs (to be implemented in later iterations) ───
  setGeneratingImagePreview: (msgId: string, preview: ContentBlock | null) => void
  setThinkingEncryptedContent: (sessionId: string, msgId: string, encryptedContent: string, provider: string) => void
  completeThinking: (sessionId: string, msgId: string) => void
  appendToolUse: (sessionId: string, msgId: string, toolUse: ToolUseBlock) => void
  updateToolUseInput: (sessionId: string, msgId: string, toolUseId: string, input: Record<string, unknown>) => void
  appendContentBlock: (sessionId: string, msgId: string, block: ContentBlock) => void
}

export type StreamingSlice = StreamingSliceState

export const createStreamingSlice: StateCreator<
  SessionSlice & StreamingSliceState,
  [['zustand/immer', never]],
  [],
  StreamingSliceState
> = (set, get) => ({
  streamingMessageId: null,
  streamingMessages: {},
  generatingImageMessages: {},
  generatingImagePreviews: {},
  imageGenerationTimings: {},

  setStreamingMessageId: (sessionId, id) => {
    set((state) => {
      const existing = state.streamingMessages[sessionId]
      if (id) {
        // iter-30 BUG-B：已有活跃 run 时不覆盖。覆盖等于把正在跑的 run 从渲染端
        // 抹掉 —— 它后续的事件全部路由不到位，聊天窗不再渲染（状态还在动、内容
        // 不再出）。同值重复赋值无害，随手放行。
        if (existing && existing !== id) return
        state.streamingMessages[sessionId] = id
      } else if (existing) {
        delete state.streamingMessages[sessionId]
      }
      if (sessionId === state.activeSessionId) {
        state.streamingMessageId = id
      }
    })
    // Sync streamingMessageId with active session
    void get
  },

  setGeneratingImage: (msgId, generating, occurredAt) => {
    set((state) => {
      if (generating) {
        state.generatingImageMessages[msgId] = true
        state.imageGenerationTimings[msgId] = { startedAt: occurredAt ?? Date.now() }
      } else {
        delete state.generatingImageMessages[msgId]
        const timing = state.imageGenerationTimings[msgId]
        if (timing) {
          timing.completedAt = Date.now()
        }
      }
    })
  },

  // ─── Runtime sync stubs (to be implemented in later iterations) ───
  setGeneratingImagePreview: (msgId, preview) => {
    set((state) => {
      if (preview) {
        state.generatingImagePreviews[msgId] = preview
      } else {
        delete state.generatingImagePreviews[msgId]
      }
    })
  },

  setThinkingEncryptedContent: (_sessionId, _msgId, _encryptedContent, _provider) => {
    // Stub - to be implemented when migrating thinking encryption from WishfulClaw
  },

  completeThinking: (_sessionId, _msgId) => {
    // Stub - to be implemented when migrating thinking completion from WishfulClaw
  },

  appendToolUse: (_sessionId, _msgId, _toolUse) => {
    // Stub - to be implemented when migrating tool use streaming from WishfulClaw
  },

  updateToolUseInput: (_sessionId, _msgId, _toolUseId, _input) => {
    // Stub - to be implemented when migrating tool use streaming from WishfulClaw
  },

  appendContentBlock: (_sessionId, _msgId, _block) => {
    // Stub - to be implemented when migrating content block streaming from WishfulClaw
  }
})
