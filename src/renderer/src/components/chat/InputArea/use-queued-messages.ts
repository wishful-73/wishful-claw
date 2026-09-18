// Queued messages state and handlers for InputArea

import * as React from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { cloneImageAttachments } from '@renderer/lib/image-attachments'
import {
  clearPendingSessionMessages,
  dispatchNextQueuedMessageForSession,
  getPendingSessionMessages,
  insertPendingSessionMessageNow,
  isPendingSessionDispatchPaused,
  removePendingSessionMessage,
  subscribePendingSessionMessages,
  type PendingSessionMessageItem
} from '@renderer/hooks/use-chat-actions'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { EMPTY_QUEUED_MESSAGES } from './types'
import { areQueuedMessagesEqual } from './utils'
import { expandPastedBlocks } from '@renderer/lib/select-file-tags'

export interface UseQueuedMessagesOptions {
  activeSessionId: string | null
  suppressPendingQueue: boolean
  t: TFunction
}

export function useQueuedMessages(opts: UseQueuedMessagesOptions) {
  const { activeSessionId, suppressPendingQueue, t } = opts
  const queuedMessagesSnapshotRef = React.useRef<PendingSessionMessageItem[]>(EMPTY_QUEUED_MESSAGES)

  const getQueuedMessagesSnapshot = React.useCallback(() => {
    if (suppressPendingQueue) return EMPTY_QUEUED_MESSAGES
    const next = activeSessionId
      ? getPendingSessionMessages(activeSessionId)
      : EMPTY_QUEUED_MESSAGES
    const prev = queuedMessagesSnapshotRef.current
    if (prev !== next && areQueuedMessagesEqual(prev, next)) {
      return prev
    }
    queuedMessagesSnapshotRef.current = next
    return next
  }, [activeSessionId, suppressPendingQueue])

  const queuedMessages = React.useSyncExternalStore(
    subscribePendingSessionMessages,
    getQueuedMessagesSnapshot,
    () => EMPTY_QUEUED_MESSAGES
  )

  const isQueueDispatchPaused = React.useSyncExternalStore(
    subscribePendingSessionMessages,
    () =>
      !suppressPendingQueue && activeSessionId
        ? isPendingSessionDispatchPaused(activeSessionId)
        : false,
    () => false
  )

  const [queueClearConfirmOpen, setQueueClearConfirmOpen] = React.useState(false)

  const removeQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeSessionId) return
      removePendingSessionMessage(activeSessionId, id)
    },
    [activeSessionId]
  )

  /**
   * S-57：把排队里的这条「取回」到主输入框 —— 从队列移除，文本与图片送回 composer。
   *
   * 走既有的 `pendingInsertText`（插到光标处，与文件树「添加到会话」同一条路），
   * 图片走本次新增的 `pendingInsertImages`。两者都是**追加**语义：不会覆盖用户
   * 已经打进去的内容。
   */
  const takeBackQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeSessionId) return
      const target = queuedMessages.find((msg) => msg.id === id)
      if (!target) return
      removePendingSessionMessage(activeSessionId, id)
      // T-13：队列里存的是 `<pasted-block>` 标签形态，进输入框前要展开回原文，
      // 否则用户看到的是 chip 的序列化 JSON。
      const text = expandPastedBlocks(target.text)
      const images = cloneImageAttachments(target.images)
      const ui = useUIStore.getState()
      ui.setPendingInsertText(text.trim() ? text : null)
      ui.setPendingInsertImages(images.length > 0 ? images : null)
    },
    [activeSessionId, queuedMessages]
  )

  const clearQueuedMessagesForActiveSession = React.useCallback(() => {
    if (!activeSessionId) return
    const cleared = clearPendingSessionMessages(activeSessionId)
    if (cleared === 0) return
    setQueueClearConfirmOpen(false)
    toast.success(t('input.queueCleared', { defaultValue: 'Queued messages cleared' }))
  }, [activeSessionId, t])

  const handleClearQueuedMessages = React.useCallback(() => {
    if (queuedMessages.length <= 1) {
      clearQueuedMessagesForActiveSession()
      return
    }
    setQueueClearConfirmOpen(true)
  }, [clearQueuedMessagesForActiveSession, queuedMessages.length])

  const resumeQueuedMessages = React.useCallback(() => {
    if (!activeSessionId) return
    dispatchNextQueuedMessageForSession(activeSessionId)
  }, [activeSessionId])

  // S-33: 「立即插入」只在当前会话确实有活跃 run 时才有意义 —— 没有在跑的轮次
  // 就没有可以插进去的地方，按钮不该出现。
  const canInsertQueuedMessageNow = useChatStore((s) =>
    activeSessionId ? Boolean(s.streamingMessages[activeSessionId]) : false
  )

  // S-57：插入动作下放到每条，点哪条插哪条（底层本来就按 id 取）。
  const insertQueuedMessageNow = React.useCallback(
    async (messageId: string) => {
      if (!activeSessionId) return
      const inserted = await insertPendingSessionMessageNow(activeSessionId, messageId)
      if (!inserted) {
        toast.error(
          t('input.queueInsertNowFailed', {
            defaultValue: '插入失败：当前没有正在执行的轮次，或该轮已结束'
          })
        )
      }
    },
    [activeSessionId, t]
  )

  // Close queue clear confirm when queue is empty
  React.useEffect(() => {
    if (queuedMessages.length > 0) return
    setQueueClearConfirmOpen(false)
  }, [queuedMessages.length])

  return {
    queuedMessages,
    isQueueDispatchPaused,
    canInsertQueuedMessageNow,
    insertQueuedMessageNow,
    queueClearConfirmOpen,
    setQueueClearConfirmOpen,
    removeQueuedMessage,
    takeBackQueuedMessage,
    clearQueuedMessagesForActiveSession,
    handleClearQueuedMessages,
    resumeQueuedMessages
  }
}
