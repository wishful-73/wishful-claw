// Queued messages state and handlers for InputArea

import * as React from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  cloneImageAttachments,
  fileToImageAttachment,
  hasEditableDraftContent,
  type EditableUserMessageDraft,
  type ImageAttachment
} from '@renderer/lib/image-attachments'
import {
  clearPendingSessionMessages,
  dispatchNextQueuedMessageForSession,
  getPendingSessionMessages,
  isPendingSessionDispatchPaused,
  removePendingSessionMessage,
  subscribePendingSessionMessages,
  updatePendingSessionMessageDraft,
  type PendingSessionMessageItem
} from '@renderer/hooks/use-chat-actions'
import { EMPTY_QUEUED_MESSAGES } from './types'
import { areQueuedMessagesEqual } from './utils'

export interface UseQueuedMessagesOptions {
  activeSessionId: string | null
  suppressPendingQueue: boolean
  t: TFunction
  isStreaming: boolean
  getPastedImageFiles: (clipboardData: DataTransfer | null | undefined) => File[]
  setPreviewImage: React.Dispatch<React.SetStateAction<ImageAttachment | null>>
}

export function useQueuedMessages(opts: UseQueuedMessagesOptions) {
  const { activeSessionId, suppressPendingQueue, t, isStreaming, getPastedImageFiles, setPreviewImage } = opts
  const queueFileInputRef = React.useRef<HTMLInputElement>(null)
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

  const [editingQueueItemId, setEditingQueueItemId] = React.useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = React.useState('')
  const [editingQueueImages, setEditingQueueImages] = React.useState<ImageAttachment[]>([])
  const [queueClearConfirmOpen, setQueueClearConfirmOpen] = React.useState(false)

  const startEditQueuedMessage = React.useCallback((msg: PendingSessionMessageItem) => {
    setEditingQueueItemId(msg.id)
    setEditingQueueText(msg.text)
    setEditingQueueImages(cloneImageAttachments(msg.images))
  }, [])

  const cancelEditQueuedMessage = React.useCallback(() => {
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
  }, [])

  const removeQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeSessionId) return
      removePendingSessionMessage(activeSessionId, id)
      if (editingQueueItemId === id) {
        setEditingQueueItemId(null)
        setEditingQueueText('')
        setEditingQueueImages([])
      }
    },
    [activeSessionId, editingQueueItemId]
  )

  const addQueuedImages = React.useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToImageAttachment))
    const valid = results.filter(Boolean) as ImageAttachment[]
    if (valid.length > 0) {
      setEditingQueueImages((prev) => [...prev, ...valid])
    }
  }, [])

  const removeQueuedImage = React.useCallback((id: string) => {
    setEditingQueueImages((prev) => prev.filter((img) => img.id !== id))
    setPreviewImage((current) => (current?.id === id ? null : current))
  }, [setPreviewImage])

  const saveQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeSessionId) return
      const targetMessage = queuedMessages.find((msg) => msg.id === id)
      if (!targetMessage) return

      const nextDraft: EditableUserMessageDraft = {
        text: editingQueueText.trim(),
        images: cloneImageAttachments(editingQueueImages),
        command: (targetMessage.command as any) ?? null
      }

      if (!hasEditableDraftContent(nextDraft)) {
        removePendingSessionMessage(activeSessionId, id)
        setEditingQueueItemId(null)
        setEditingQueueText('')
        setEditingQueueImages([])
        return
      }

      updatePendingSessionMessageDraft(activeSessionId, id, nextDraft)
      setEditingQueueItemId(null)
      setEditingQueueText('')
      setEditingQueueImages([])
    },
    [activeSessionId, queuedMessages, editingQueueText, editingQueueImages]
  )

  const clearQueuedMessagesForActiveSession = React.useCallback(() => {
    if (!activeSessionId) return
    const cleared = clearPendingSessionMessages(activeSessionId)
    if (cleared === 0) return
    setQueueClearConfirmOpen(false)
    cancelEditQueuedMessage()
    toast.success(t('input.queueCleared', { defaultValue: 'Queued messages cleared' }))
  }, [activeSessionId, cancelEditQueuedMessage, t])

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

  const handleQueueEditPaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      const imageFiles = getPastedImageFiles(e.clipboardData)
      if (imageFiles.length === 0) return
      e.preventDefault()
      void addQueuedImages(imageFiles)
    },
    [addQueuedImages, getPastedImageFiles]
  )

  // Reset queue editing state on session change
  React.useEffect(() => {
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
    setQueueClearConfirmOpen(false)
  }, [activeSessionId])

  // Clear queue editing if item disappears
  React.useEffect(() => {
    if (!editingQueueItemId) return
    if (queuedMessages.some((msg) => msg.id === editingQueueItemId)) return
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
  }, [queuedMessages, editingQueueItemId])

  // Cancel queue editing on stream stop
  React.useEffect(() => {
    if (!isStreaming) {
      cancelEditQueuedMessage()
    }
  }, [isStreaming, cancelEditQueuedMessage])

  // Close queue clear confirm when queue is empty
  React.useEffect(() => {
    if (queuedMessages.length > 0) return
    setQueueClearConfirmOpen(false)
  }, [queuedMessages.length])

  return {
    queuedMessages,
    isQueueDispatchPaused,
    editingQueueItemId,
    editingQueueText,
    setEditingQueueText,
    editingQueueImages,
    setEditingQueueImages,
    queueClearConfirmOpen,
    setQueueClearConfirmOpen,
    queueFileInputRef,
    startEditQueuedMessage,
    cancelEditQueuedMessage,
    removeQueuedMessage,
    addQueuedImages,
    removeQueuedImage,
    saveQueuedMessage,
    clearQueuedMessagesForActiveSession,
    handleClearQueuedMessages,
    resumeQueuedMessages,
    handleQueueEditPaste
  }
}
