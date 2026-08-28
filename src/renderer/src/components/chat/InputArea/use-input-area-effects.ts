// Extracted effects for InputArea to keep index.tsx under 500 lines

import * as React from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { type CollabMode } from '../CollabModeSwitcher'
import { cloneImageAttachments, type ImageAttachment } from '@renderer/lib/image-attachments'
import { deserializeEditorState } from '@renderer/lib/select-file-editor'
import { selectFileTextToPlainText } from '@renderer/lib/select-file-tags'
import type { FileAwareEditorHandle } from '../file-aware-editor-utils'
import { isReferenceOnlyDocument } from './utils'

export interface InputAreaEffectsInput {
  draftSessionId: string | null
  hasActiveGoal: boolean
  workingFolder?: string | null
  isHomeComposer: boolean

  // Auto-accept recommendation
  shouldAutoAcceptRecommendation: boolean
  suggestionText: string
  text: string
  acceptSuggestion: () => string | null
  applyEditorStateFromSerializedText: (text: string, files: unknown[]) => void
  selectedFiles: unknown[]
  focusInputAtEnd: () => void
  handleRecommendationSelectionChange: () => void

  // Draft persistence
  inputDraftHydrated: boolean
  persistedDraft: { text?: string; selectedFiles?: unknown[]; skill?: string | null; images?: ImageAttachment[] } | null
  activeDraftKey: string
  finalSerializedText: string
  attachedImages: ImageAttachment[]
  selectedSkill: string | null
  savePersistedDraft: (draft: unknown) => Promise<void>

  // State setters
  setPendingPlanMode: React.Dispatch<React.SetStateAction<boolean>>
  setPendingGoalMode: React.Dispatch<React.SetStateAction<boolean>>
  pendingCollabMode: CollabMode | null
  setPendingCollabMode: React.Dispatch<React.SetStateAction<CollabMode | null>>
  setAutoAcceptCountdown: React.Dispatch<React.SetStateAction<number | null>>
  setAttachedImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPreviewImage: React.Dispatch<React.SetStateAction<ImageAttachment | null>>
  setSelectedSkill: React.Dispatch<React.SetStateAction<string | null>>
  setHighlightedFileId: React.Dispatch<React.SetStateAction<string | null>>
  setEditorSelection: React.Dispatch<React.SetStateAction<{ start: number; end: number }>>

  // Refs
  editorRef: React.RefObject<FileAwareEditorHandle | null>
  rootRef: React.RefObject<HTMLDivElement | null>
  draftSaveTimerRef: React.RefObject<ReturnType<typeof setTimeout>>
  draftReadyKeyRef: React.RefObject<string | null>

  // Other
  isStreaming: boolean
  disabled: boolean
  replaceSelectionWithText: (text: string, selection: { start: number; end: number }) => void
}

export function useInputAreaEffects(input: InputAreaEffectsInput): void {
  const {
    draftSessionId, hasActiveGoal, workingFolder,
    isHomeComposer,
    shouldAutoAcceptRecommendation, suggestionText, text, acceptSuggestion,
    applyEditorStateFromSerializedText, selectedFiles, focusInputAtEnd,
    handleRecommendationSelectionChange,
    inputDraftHydrated, persistedDraft, activeDraftKey, finalSerializedText,
    attachedImages, selectedSkill, savePersistedDraft,
    setPendingPlanMode, setPendingGoalMode, pendingCollabMode, setPendingCollabMode, setAutoAcceptCountdown,
    setAttachedImages, setPreviewImage, setSelectedSkill, setHighlightedFileId, setEditorSelection,
    editorRef, rootRef, draftSaveTimerRef, draftReadyKeyRef,
    isStreaming, disabled, replaceSelectionWithText,
  } = input

  // ── Mode reset ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (draftSessionId) setPendingPlanMode(false)
    setPendingGoalMode(false)
  }, [draftSessionId, setPendingPlanMode, setPendingGoalMode])

  // Apply pending collab mode when session is created
  React.useEffect(() => {
    if (draftSessionId && pendingCollabMode) {
      useUIStore.getState().setCollabMode(draftSessionId, pendingCollabMode)
      setPendingCollabMode(null)
    }
  }, [draftSessionId, pendingCollabMode, setPendingCollabMode])

  React.useEffect(() => {
    if (hasActiveGoal) setPendingGoalMode(false)
  }, [hasActiveGoal, setPendingGoalMode])

  // ── Auto-accept recommendation ──────────────────────────────────
  React.useEffect(() => {
    if (!shouldAutoAcceptRecommendation || !suggestionText || !text.trim()) {
      setAutoAcceptCountdown(null); return
    }
    setAutoAcceptCountdown(8)
    const intervalId = window.setInterval(() => {
      setAutoAcceptCountdown((prev) => prev === null ? null : prev > 1 ? prev - 1 : 0)
    }, 1000)
    const timeoutId = window.setTimeout(() => {
      const accepted = acceptSuggestion()
      if (!accepted) return
      applyEditorStateFromSerializedText(accepted, selectedFiles)
      setAutoAcceptCountdown(null)
      requestAnimationFrame(() => { focusInputAtEnd(); handleRecommendationSelectionChange() })
    }, 8000)
    return () => { window.clearInterval(intervalId); window.clearTimeout(timeoutId) }
  }, [acceptSuggestion, applyEditorStateFromSerializedText, focusInputAtEnd,
      handleRecommendationSelectionChange, selectedFiles, shouldAutoAcceptRecommendation,
      setAutoAcceptCountdown, suggestionText, text])

  // ── Draft hydration ─────────────────────────────────────────────
  React.useEffect(() => {
    if (!inputDraftHydrated) return
    clearTimeout(draftSaveTimerRef.current)
    const persistedText = persistedDraft?.text ?? ''
    const persistedSelectedFiles = persistedDraft?.selectedFiles ?? []
    const shouldReset = isHomeComposer && !persistedDraft?.skill &&
      (persistedDraft?.images?.length ?? 0) === 0 &&
      isReferenceOnlyDocument(deserializeEditorState(persistedText, workingFolder ?? undefined, persistedSelectedFiles as any).document)
    draftReadyKeyRef.current = null
    applyEditorStateFromSerializedText(shouldReset ? '' : persistedText, shouldReset ? [] : persistedSelectedFiles)
    setAttachedImages(persistedDraft?.images ? cloneImageAttachments(persistedDraft.images) : [])
    setPreviewImage(null)
    setSelectedSkill(persistedDraft?.skill ?? null)
    setHighlightedFileId(null)
    setEditorSelection({ start: 0, end: 0 })
    const rafId = window.requestAnimationFrame(() => { draftReadyKeyRef.current = activeDraftKey })
    return () => window.cancelAnimationFrame(rafId)
  }, [activeDraftKey, applyEditorStateFromSerializedText, inputDraftHydrated, isHomeComposer,
      persistedDraft, workingFolder, setAttachedImages, setPreviewImage, setSelectedSkill,
      setHighlightedFileId, setEditorSelection, draftSaveTimerRef, draftReadyKeyRef])

  // ── Auto-focus ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (isStreaming || disabled || !inputDraftHydrated) return
    const rafId = window.requestAnimationFrame(() => {
      if (activeDraftKey && draftReadyKeyRef.current !== activeDraftKey) return
      const activeElement = document.activeElement
      if (activeElement && activeElement !== document.body && !rootRef.current?.contains(activeElement)) return
      editorRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [activeDraftKey, disabled, inputDraftHydrated, isStreaming, rootRef, editorRef, draftReadyKeyRef])

  // ── Draft save ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (!activeDraftKey || !inputDraftHydrated) return
    if (draftReadyKeyRef.current !== activeDraftKey) return
    clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = setTimeout(() => {
      void savePersistedDraft({
        text: finalSerializedText, images: cloneImageAttachments(attachedImages),
        skill: selectedSkill, selectedFiles: selectedFiles.map((f: any) => ({ ...f }))
      })
    }, 400)
    return () => clearTimeout(draftSaveTimerRef.current)
  }, [activeDraftKey, attachedImages, finalSerializedText, inputDraftHydrated,
      selectedFiles, selectedSkill, savePersistedDraft, draftSaveTimerRef, draftReadyKeyRef])

  // ── Pending insert ──────────────────────────────────────────────
  const pendingInsert = useUIStore((s) => s.pendingInsertText)
  React.useEffect(() => {
    if (!pendingInsert) return
    const selection = editorRef.current?.getSelectionOffsets() ?? { start: text.length, end: text.length }
    const plainText = selectFileTextToPlainText(pendingInsert)
    const needsPrefix = selection.start === selection.end && selection.start > 0 &&
      !/\s$/.test(text.slice(0, selection.start)) && plainText.length > 0 && !/^\s/.test(plainText)
    replaceSelectionWithText(`${needsPrefix ? ' ' : ''}${pendingInsert}`, selection)
    useUIStore.getState().setPendingInsertText(null)
  }, [pendingInsert, replaceSelectionWithText, text, editorRef])
}
