// InputArea: main composer component with editor, toolbar, and controls

import * as React from 'react'
import type { SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { updateWebSearchToolRegistration } from '@renderer/lib/tools'
import { useDebouncedTokens } from '@renderer/hooks/use-estimated-tokens'
import { usePromptRecommendation } from '@renderer/hooks/use-prompt-recommendation'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { type CollabMode } from '../CollabModeSwitcher'
import { useTranslation } from 'react-i18next'
import { type ImageAttachment } from '@renderer/lib/image-attachments'
import { type FileAwareEditorHandle } from '../file-aware-editor-utils'
import { GoalSessionBar } from '@renderer/components/goal/GoalSessionControls'
import { useGoalStore } from '@renderer/stores/goal-store'
import { cn } from '@renderer/lib/utils'
import type { AppPluginId } from '@renderer/lib/app-plugin/types'
import {
  getHomeInputDraftKey, getProjectInputDraftKey, getSessionInputDraftKey,
  type InputDraftContext
} from '@renderer/lib/input-drafts'
import { useInputDraftPersistence } from '@renderer/hooks/use-input-draft-persistence'

// Extracted modules
import { InputAreaProps } from './types'
import {
  MIN_INPUT_HEIGHT, DEFAULT_SESSION_INPUT_HEIGHT, placeholderKeys, defaultRecommendationKeys
} from './types'
import {
  summarizeQueuedMessage, selectedFileItemToReference
} from './utils'
import { ComposerRuntimeStatus, ComposerStatusIndicator } from './runtime-status'
import { useComposerHeight } from './use-composer-height'
import { useImageAttachments } from './use-image-attachments'
import { useQueuedMessages } from './use-queued-messages'
import { usePromptOptimizer } from './use-prompt-optimizer'
import { QueuedMessagesPanel } from './queued-messages-panel'
import { ImagePreviewStrip } from './image-preview-strip'
import { ComposerBanners } from './composer-banners'
import { ComposerToolbar } from './composer-toolbar'
import { useComposerKeydown } from './use-composer-keydown'
import { useDragDrop } from './use-drag-drop'
import { useComposerEditor } from './use-composer-editor'
import { useSlashCommands } from './use-slash-commands'
import { useFileSearch } from './use-file-search'
import { useContextCompression } from './use-context-compression'
import { usePermissionMode } from './use-permission-mode'
import { useModeControls } from './use-mode-controls'
import { ComposerEditorArea } from './composer-editor-area'
import { useInputAreaSelectors } from './use-input-area-selectors'
import { useInputAreaEffects } from './use-input-area-effects'
import { composerEvents } from '@renderer/lib/composer-events'

export function InputArea({
  sessionId, onSend, onStop, onSelectFolder, isStreaming = false, workingFolder,
  hideWorkingFolderIndicator = false, hideWorkingFolderPicker = false, onCompressContext,
  disabled = false, draftKeyOverride, suppressPendingQueue = false,
  hideGoalSessionBar = false, hideModeSwitch = false, modelRoute = 'main',
  readOnlyModel, attachedFooter = false, fullWidth = false
}: InputAreaProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const defaultSessionInputHeight = Math.max(DEFAULT_SESSION_INPUT_HEIGHT, MIN_INPUT_HEIGHT)

  const sel = useInputAreaSelectors({ sessionId: sessionId ?? undefined, workingFolder: workingFolder as any, modelRoute })
  const {
    chatView, isHomeComposer,
    language: currentLanguage, autoApprove,
    clarifyAutoAcceptRecommended, animationsEnabled,
    webSearchEnabled, canToggleWebSearch,
    supportsVision, composerModelCfg,
    mode, openSettings, openFilePreview,
    activeProjectId, activeSessionId, hasMessages, clearSessionMessages,
    draftSessionId, projectScoped,
    planMode, hasActiveGoal, pendingReviewPlanId, hasApiKey
  } = sel
  const [pendingCollabMode, setPendingCollabMode] = React.useState<CollabMode | null>(null)
  const collabMode = useUIStore((s) =>
    draftSessionId ? (s.collabModesBySession[draftSessionId] ?? 'normal') : 'normal'
  )
  const isGoalMode = collabMode === 'goal' || pendingCollabMode === 'goal'
  const effectiveCollabMode: CollabMode = draftSessionId ? collabMode : (pendingCollabMode ?? 'normal')

  const needsWorkingFolder = projectScoped && !workingFolder && Boolean(onSelectFolder)

  const [selectedSkill, setSelectedSkill] = React.useState<string | null>(null)
  const [autoAcceptCountdown, setAutoAcceptCountdown] = React.useState<number | null>(null)
  const [, setPendingPlanMode] = React.useState(false)
  const [, setPendingGoalMode] = React.useState(false)
  const removePersistedDraftRef = React.useRef<(() => void) | null>(null)
  const flyoutPointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const slashListRef = React.useRef<HTMLDivElement | null>(null)
  const fileListRef = React.useRef<HTMLDivElement | null>(null)
  const draftReadyKeyRef = React.useRef<string | null>(null)
  const userEditedDraftKeyRef = React.useRef<string | null>(null)
  const editorRef = React.useRef<FileAwareEditorHandle | null>(null)
  const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [attachedImages, setAttachedImages] = React.useState<ImageAttachment[]>([])
  const [previewImage, setPreviewImage] = React.useState<ImageAttachment | null>(null)
  const [pendingImageReads, setPendingImageReads] = React.useState(0)

  const {
    documentNodes, setDocumentNodes,
    selectedFiles, setSelectedFiles,
    highlightedFileId, setHighlightedFileId,
    editorSelection, setEditorSelection,
    text, finalSerializedText,
    documentRef, selectedFilesRef,
    applyEditorStateFromSerializedText, setText, focusInputAtEnd,
    replaceSelectionWithText, addFilesToEditor,
    getLiveEditorState, resetComposer,
    handleEditorDocumentChange, handleRemoveFileReference
  } = useComposerEditor({
    workingFolder, editorRef, attachedImages,
    draftSaveTimerRef,
    removePersistedDraft: () => removePersistedDraftRef.current?.(),
    setSelectedSkill, setAttachedImages, setPreviewImage
  })

  const toggleWebSearch = React.useCallback(() => {
    const newEnabled = !useSettingsStore.getState().webSearchEnabled
    useSettingsStore.getState().updateSettings({ webSearchEnabled: newEnabled })
    updateWebSearchToolRegistration(newEnabled)
  }, [])

  const getSessionMessages = React.useCallback(
    () => useChatStore.getState().getSessionMessages(activeSessionId ?? ''),
    [activeSessionId]
  )

  const {
    rootRef, containerRef, imagePreviewRef, bottomToolbarRef,
    inputHeight, autoInputHeight, autoMaxInputHeight, handleDragStart
  } = useComposerHeight({
    isSessionComposer: chatView === 'session' || Boolean(sessionId),
    defaultSessionInputHeight, editorRef,
    attachedImagesCount: attachedImages.length, selectedSkill,
    documentNodes, selectedFiles
  })

  const {
    isOptimizing, optimizingText, optimizationOptions, showOptimizationDialog,
    setShowOptimizationDialog, selectedOptionIndex, setSelectedOptionIndex,
    handleOptimizePrompt, handleSelectOption, handleCancelOptimization
  } = usePromptOptimizer({ text, currentLanguage: currentLanguage as 'en' | 'zh', setText, focusInputAtEnd })
  const isOptimizingLocked = isOptimizing || showOptimizationDialog

  const {
    fileSearchResults, fileSearchLoading,
    selectedFileSearchIndex, setSelectedFileSearchIndex,
    activeFileMention, fileMenuOpen, insertSelectedFile
  } = useFileSearch({
    text, editorSelection, projectScoped, workingFolder,
    selectedFilesRef, replaceSelectionWithText,
    setSelectedSkill, fileListRef
  })

  const hasFileReferences = React.useMemo(() => selectedFiles.length > 0, [selectedFiles])
  const recommendationFallback = t(defaultRecommendationKeys[mode as never])
  const shouldAutoAcceptRecommendation =
    mode === 'clarify' && clarifyAutoAcceptRecommended && !disabled && !isOptimizingLocked && !isStreaming
  const getCaretAtEnd = React.useCallback(() => {
    return editorSelection.start === editorSelection.end && editorSelection.end === text.length
  }, [editorSelection.end, editorSelection.start, text.length])
  const {
    suggestionText, effectivePlaceholder, acceptSuggestion,
    cancelPendingRequest: cancelPromptRecommendation,
    handleFocus: handleRecommendationFocus, handleBlur: handleRecommendationBlur,
    handleSelectionChange: handleRecommendationSelectionChange,
    handleCompositionStart: handleRecommendationCompositionStart,
    handleCompositionEnd: handleRecommendationCompositionEnd
  } = usePromptRecommendation({
    mode, sessionId: activeSessionId, text, getRecentMessages: getSessionMessages,
    selectedSkill, images: attachedImages, disabled: disabled || isOptimizingLocked,
    isStreaming, fallbackSuggestion: recommendationFallback, getCaretAtEnd
  })

  const activeDraftKey = React.useMemo(() => {
    if (draftKeyOverride) return draftKeyOverride
    if (draftSessionId) return getSessionInputDraftKey(draftSessionId)
    if (activeProjectId) return getProjectInputDraftKey(activeProjectId)
    return getHomeInputDraftKey()
  }, [activeProjectId, draftKeyOverride, draftSessionId])

  const draftContext = React.useMemo<InputDraftContext>(() => {
    const wf = workingFolder ?? null
    if (draftKeyOverride) return { scope: draftKeyOverride.startsWith('subagent:') ? 'subagent' : 'custom', sessionId: draftSessionId, projectId: activeProjectId, mode, workingFolder: wf }
    if (draftSessionId) return { scope: 'session', sessionId: draftSessionId, projectId: activeProjectId, mode, workingFolder: wf }
    if (activeProjectId) return { scope: 'project', projectId: activeProjectId, mode, workingFolder: wf }
    return { scope: 'home', mode, workingFolder: wf }
  }, [activeProjectId, draftKeyOverride, draftSessionId, mode, workingFolder])

  const handleUserEdit = React.useCallback(() => {
    userEditedDraftKeyRef.current = activeDraftKey
  }, [activeDraftKey])

  React.useEffect(() => {
    if (userEditedDraftKeyRef.current !== activeDraftKey) {
      userEditedDraftKeyRef.current = null
    }
  }, [activeDraftKey])

  const {
    hydrated: inputDraftHydrated, loadedDraft: persistedDraft,
    saveDraft: savePersistedDraft, removeDraft: removePersistedDraft
  } = useInputDraftPersistence({ draftKey: activeDraftKey, context: draftContext })
  removePersistedDraftRef.current = removePersistedDraft

  const {
    slashQuery, slashMenuOpen, slashSuggestionsLoading,
    filteredSlashSuggestions, selectedSlashIndex, setSelectedSlashIndex,
    insertSlashCommand, insertPluginPrompt, applySlashSuggestion
  } = useSlashCommands({
    text, workingFolder, activeProjectId,
    editorRef, editorSelection, selectedFiles, selectedFilesRef, documentRef,
    applyEditorStateFromSerializedText, focusInputAtEnd,
    setSelectedSkill, setSelectedFiles, setDocumentNodes, slashListRef
  })

  const hasPendingGoalMode = isGoalMode && !hasActiveGoal && !useGoalStore.getState().goalProgressBySession[draftSessionId ?? '']
  const goalModeEnabled = isGoalMode
  const composerWidthClass = fullWidth ? 'mx-auto w-full max-w-none' : 'mx-auto w-full max-w-[820px]'

  ;(useInputAreaEffects as any)({
    draftSessionId, hasActiveGoal, workingFolder, isHomeComposer,
    shouldAutoAcceptRecommendation, suggestionText, text, acceptSuggestion,
    applyEditorStateFromSerializedText, selectedFiles, focusInputAtEnd, handleRecommendationSelectionChange,
    inputDraftHydrated, persistedDraft, activeDraftKey, finalSerializedText,
    userEditedDraftKeyRef,
    attachedImages, selectedSkill, savePersistedDraft,
    setPendingPlanMode, setPendingGoalMode, pendingCollabMode, setPendingCollabMode, setAutoAcceptCountdown,
    setAttachedImages, setPreviewImage, setSelectedSkill, setHighlightedFileId, setEditorSelection,
    editorRef, rootRef, draftSaveTimerRef, draftReadyKeyRef, isStreaming, disabled, replaceSelectionWithText,
  })

  const { addImages, removeImage, getPastedImageFiles, handleAttachMedia } = useImageAttachments({
    supportsVision, t, addFilesToEditor, setAttachedImages, setPreviewImage, setPendingImageReads
  })

  const {
    queuedMessages, editingQueueItemId, editingQueueText, setEditingQueueText,
    editingQueueImages, setEditingQueueImages, queueClearConfirmOpen, setQueueClearConfirmOpen,
    queueFileInputRef, startEditQueuedMessage, cancelEditQueuedMessage, removeQueuedMessage,
    addQueuedImages, removeQueuedImage, saveQueuedMessage, clearQueuedMessagesForActiveSession,
    handleClearQueuedMessages, resumeQueuedMessages, isQueueDispatchPaused, handleQueueEditPaste
  } = useQueuedMessages({
    activeSessionId, suppressPendingQueue, t, isStreaming, getPastedImageFiles, setPreviewImage
  })

  const handlePreviewFile = React.useCallback((fileId: string) => {
    const file = selectedFilesRef.current.find((item) => item.id === fileId)
    if (file) openFilePreview(file.previewPath)
  }, [openFilePreview])

  const handleLocateFileReference = React.useCallback((fileId: string) => {
    setHighlightedFileId(fileId); editorRef.current?.scrollToReference(fileId); editorRef.current?.focus()
  }, [])

  const handleEditorSelectionChange = React.useCallback((sel: { start: number; end: number }) => {
    setEditorSelection((cur) => cur.start === sel.start && cur.end === sel.end ? cur : sel)
    handleRecommendationSelectionChange()
  }, [handleRecommendationSelectionChange])

  const handleSend = React.useCallback((): void => {
    const liveEditorState = getLiveEditorState()
    const promptText = liveEditorState.promptText.trim()
    if (!promptText && attachedImages.length === 0) return
    if (disabled || needsWorkingFolder || pendingImageReads > 0) return
    const hasLeadingSlashCommand = liveEditorState.plainText.trimStart().startsWith('/')
    const message = selectedSkill && !hasLeadingSlashCommand ? `[Skill: ${selectedSkill}]\n${promptText}` : promptText
    const sendOptions: SendMessageOptions = { clearCompletedTasksOnTurnStart: true, enablePlanMode: planMode || undefined }
    const selectedFileReferences = liveEditorState.selectedFiles.map(selectedFileItemToReference)
    if (selectedFileReferences.length > 0) sendOptions.selectedFileReferences = selectedFileReferences
    sendOptions.sessionMode = isGoalMode ? 'goal' : (!activeProjectId ? 'global' : 'normal')
    onSend?.(message, attachedImages.length > 0 ? attachedImages : undefined, sendOptions)
    resetComposer()
  }, [getLiveEditorState, attachedImages, disabled, needsWorkingFolder, pendingImageReads,
      isGoalMode, cancelPromptRecommendation, selectedSkill, onSend, planMode, resetComposer, t])

  const { handlePlanModeChange, handleGoalModeChange } = useModeControls({
    projectScoped, draftSessionId, disabled, isStreaming, isOptimizingLocked, pendingImageReads, hasActiveGoal, focusInputAtEnd, setPendingPlanMode, setPendingGoalMode, t
  })

  const handleCollabModeChange = React.useCallback((nextMode: CollabMode): void => {
    if (disabled || isStreaming || isOptimizingLocked || pendingImageReads > 0) return
    if (nextMode === 'normal') {
      if (draftSessionId) useUIStore.getState().setCollabMode(draftSessionId, 'normal')
      setPendingCollabMode(null)
    } else {
      if (draftSessionId) useUIStore.getState().setCollabMode(draftSessionId, 'goal')
      else setPendingCollabMode('goal')
      requestAnimationFrame(() => focusInputAtEnd())
    }
  }, [disabled, isStreaming, isOptimizingLocked, pendingImageReads, draftSessionId, hasActiveGoal, focusInputAtEnd])

  const handleKeyDown = useComposerKeydown({
    isOptimizingLocked, fileMenuOpen, slashMenuOpen, fileSearchResults, selectedFileSearchIndex,
    setSelectedFileSearchIndex, filteredSlashSuggestions, selectedSlashIndex, setSelectedSlashIndex,
    activeFileMention, editorRef, setEditorSelection, insertSelectedFile, applySlashSuggestion,
    acceptSuggestion, applyEditorStateFromSerializedText, selectedFiles, focusInputAtEnd,
    handleRecommendationSelectionChange, handleSend
  })

  const handlePaste = React.useCallback((e: React.ClipboardEvent<HTMLDivElement>): void => {
    const imageFiles = getPastedImageFiles(e.clipboardData)
    if (imageFiles.length > 0) { e.preventDefault(); void addImages(imageFiles); return }
    const plainText = e.clipboardData.getData('text/plain')
    if (!plainText) return
    e.preventDefault()
    const selection = editorRef.current?.getSelectionOffsets() ?? editorSelection
    replaceSelectionWithText(plainText, selection)
  }, [addImages, editorSelection, getPastedImageFiles, replaceSelectionWithText])

  const { dragging, handleDragOver, handleDragLeave, handleDropWrapped } = useDragDrop({ addFilesToEditor })
  const { contextCompressionStatus, isContextCompressing, handleCompressContext, contextCompressionStatusLabel } = useContextCompression({ onCompressContext, t })
  const { permissionMode, handleSelectPermissionMode } = usePermissionMode({ autoApprove, t })

  // Subscribe to external composer inject requests (e.g. from PreviewPanel)
  React.useEffect(() => {
    const unsub = composerEvents.on((event) => {
      setText(event.text)
      focusInputAtEnd()
    })
    return unsub
  }, [setText, focusInputAtEnd])

  const editorPlaceholder = pendingReviewPlanId
    ? t('input.placeholderPlanReview', { defaultValue: 'Enter suggestions for this plan...' })
    : (effectivePlaceholder ?? t(placeholderKeys[mode as never] ?? 'input.placeholder'))

  const composerIconControlClass = 'composer-control rounded-xl'
  const debouncedTokens = useDebouncedTokens(finalSerializedText)

  return (
    <div ref={rootRef} data-tour="composer" className={cn('px-4 py-3', attachedFooter ? 'pb-0' : 'pb-4')}>
      <ComposerBanners
        hasApiKey={hasApiKey}
        needsWorkingFolder={needsWorkingFolder}
        onSelectFolder={onSelectFolder}
        mode={mode}
        planMode={planMode}
        projectScoped={projectScoped}
        draftSessionId={draftSessionId}
        workingFolder={workingFolder}
        hideWorkingFolderIndicator={hideWorkingFolderIndicator}
        hasPendingGoalMode={hasPendingGoalMode}
        composerWidthClass={composerWidthClass}
        onOpenSettings={(tab) => openSettings(tab as never)}
      />

      <QueuedMessagesPanel
        queuedMessages={queuedMessages} composerWidthClass={composerWidthClass} animationsEnabled={animationsEnabled}
        editingQueueItemId={editingQueueItemId} editingQueueText={editingQueueText} editingQueueImages={editingQueueImages}
        setEditingQueueText={setEditingQueueText} setEditingQueueImages={setEditingQueueImages} setPreviewImage={setPreviewImage}
        saveQueuedMessage={saveQueuedMessage} cancelEditQueuedMessage={cancelEditQueuedMessage}
        removeQueuedImage={removeQueuedImage} handleQueueEditPaste={handleQueueEditPaste}
        editQueuedMessage={startEditQueuedMessage} removePendingSessionMessage={removeQueuedMessage}
        isQueueDispatchPaused={isQueueDispatchPaused} resumeQueuedMessages={resumeQueuedMessages}
        handleClearQueuedMessages={handleClearQueuedMessages} queueClearConfirmOpen={queueClearConfirmOpen}
        setQueueClearConfirmOpen={setQueueClearConfirmOpen} clearQueuedMessagesForActiveSession={clearQueuedMessagesForActiveSession}
        summarizeQueuedMessage={summarizeQueuedMessage}
      />

      {!hideGoalSessionBar && draftSessionId && (
        <GoalSessionBar sessionId={draftSessionId} className={cn('mb-2', fullWidth && 'max-w-none')} />
      )}

      <div className={composerWidthClass}>
        <div
          ref={containerRef}
          className={cn(
            'composer-shell relative flex flex-col transition-[box-shadow,border-color] duration-200',
            fileMenuOpen || slashMenuOpen ? 'overflow-visible' : 'overflow-hidden',
            attachedFooter && 'composer-shell--attached-footer',
            dragging && 'ring-2 ring-primary/50'
          )}
          data-composer-variant="session"
          style={inputHeight !== null ? { height: inputHeight } : { height: autoInputHeight, maxHeight: autoMaxInputHeight }}
        >
          {chatView === 'session' || Boolean(sessionId) ? (
            <div className="composer-drag-handle flex h-3 cursor-row-resize items-center justify-center" onMouseDown={handleDragStart}>
              <div className="composer-drag-grip h-1 w-11 rounded-full" />
            </div>
          ) : null}
          {draftSessionId && (
            <ComposerStatusIndicator
              sessionId={draftSessionId}
              isStreaming={isStreaming}
              draftInputTokens={debouncedTokens}
              isOptimizing={isOptimizing}
              pendingImageReads={pendingImageReads}
              contextCompressionStatus={contextCompressionStatus}
              contextCompressionStatusLabel={contextCompressionStatusLabel}
            />
          )}
          <ImagePreviewStrip
            attachedImages={attachedImages}
            animationsEnabled={animationsEnabled}
            imagePreviewRef={imagePreviewRef}
            setPreviewImage={setPreviewImage}
            removeImage={removeImage}
            previewImage={previewImage}
          />
          <ComposerEditorArea
            dragging={dragging}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleDropWrapped={handleDropWrapped}
            editorRef={editorRef}
            documentNodes={documentNodes}
            selectedFiles={selectedFiles}
            disabled={disabled}
            isOptimizingLocked={isOptimizingLocked}
            isOptimizing={isOptimizing}
            selectedSkill={selectedSkill}
            onClearSelectedSkill={() => setSelectedSkill(null)}
            attachedImages={attachedImages}
            supportsVision={supportsVision}
            placeholder={editorPlaceholder}
            suggestionText={suggestionText}
            showSuggestion={Boolean(suggestionText && text.length > 0 && !hasFileReferences && !activeFileMention && !slashMenuOpen)}
            shouldAutoAcceptRecommendation={shouldAutoAcceptRecommendation}
            autoAcceptCountdown={autoAcceptCountdown}
            hasFileReferences={hasFileReferences}
            highlightedFileId={highlightedFileId}
            onDocumentChange={handleEditorDocumentChange}
            onSelectionChange={handleEditorSelectionChange}
            onUserEdit={handleUserEdit}
            onFocus={handleRecommendationFocus}
            onBlur={handleRecommendationBlur}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={handleRecommendationCompositionStart}
            onCompositionEnd={() => handleRecommendationCompositionEnd()}
            onReferencePreview={handlePreviewFile}
            onReferenceLocate={handleLocateFileReference}
            onReferenceDelete={handleRemoveFileReference}
            showOptimizationDialog={showOptimizationDialog}
            setShowOptimizationDialog={setShowOptimizationDialog}
            optimizationOptions={optimizationOptions}
            optimizingText={optimizingText}
            selectedOptionIndex={selectedOptionIndex}
            setSelectedOptionIndex={setSelectedOptionIndex}
            onUseOption={handleSelectOption}
            onCancelOptimization={handleCancelOptimization}
            fileMenuOpen={fileMenuOpen}
            fileSearchLoading={fileSearchLoading}
            fileSearchResults={fileSearchResults}
            selectedFileSearchIndex={selectedFileSearchIndex}
            setSelectedFileSearchIndex={setSelectedFileSearchIndex}
            flyoutPointerRef={flyoutPointerRef}
            insertSelectedFile={insertSelectedFile}
            needsWorkingFolder={needsWorkingFolder}
            onSelectFolder={onSelectFolder}
            slashMenuOpen={slashMenuOpen}
            slashQuery={slashQuery}
            slashSuggestionsLoading={slashSuggestionsLoading}
            filteredSlashSuggestions={filteredSlashSuggestions}
            selectedSlashIndex={selectedSlashIndex}
            setSelectedSlashIndex={setSelectedSlashIndex}
            slashListRef={slashListRef}
            applySlashSuggestion={applySlashSuggestion}
            queueFileInputRef={queueFileInputRef}
            addQueuedImages={addQueuedImages}
          />
          <ComposerToolbar
            readOnlyModel={readOnlyModel}
            modelRoute={modelRoute}
            draftSessionId={draftSessionId}
            canToggleWebSearch={canToggleWebSearch}
            webSearchEnabled={webSearchEnabled}
            toggleWebSearch={toggleWebSearch}
            disabled={disabled}
            isStreaming={isStreaming}
            setSelectedSkill={setSelectedSkill}
            insertSlashCommand={insertSlashCommand}
            insertPluginPrompt={(id, _focus) => insertPluginPrompt(id as AppPluginId)}
            handleAttachMedia={handleAttachMedia}
            activeProjectId={activeProjectId}
            mode={mode}
            hideModeSwitch={hideModeSwitch}
            planMode={planMode}
            goalModeEnabled={goalModeEnabled}
            planModeDisabled={disabled || isStreaming || !projectScoped}
            goalModeDisabled={disabled || isStreaming || isOptimizingLocked || pendingImageReads > 0}
            onPlanModeChange={handlePlanModeChange}
            onGoalModeChange={handleGoalModeChange}
            draftSessionIdCollab={draftSessionId}
            collabModeDisabled={disabled || isStreaming || isOptimizingLocked || pendingImageReads > 0}
            collabModeOverride={effectiveCollabMode}
            onCollabModeChange={projectScoped ? handleCollabModeChange : undefined}
            onSelectFolder={onSelectFolder}
            hideWorkingFolderPicker={hideWorkingFolderPicker}
            isOptimizing={isOptimizing}
            isOptimizingLocked={isOptimizingLocked}
            handleOptimizePrompt={handleOptimizePrompt}
            hasText={Boolean(text.trim())}
            permissionMode={permissionMode}
            onSelectPermissionMode={handleSelectPermissionMode}
            onOpenSettings={(tab) => openSettings(tab as never)}
            onStop={onStop}
            onSend={handleSend}
            finalSerializedText={finalSerializedText}
            attachedImagesCount={attachedImages.length}
            needsWorkingFolder={needsWorkingFolder}
            pendingImageReads={pendingImageReads}
            onCompressContext={onCompressContext ? handleCompressContext : undefined}
            isContextCompressing={isContextCompressing}
            showInlineClearConversation={false}
            hasMessages={hasMessages}
            activeSessionId={activeSessionId}
            queuedMessagesCount={queuedMessages.length}
            onClearSession={clearSessionMessages}
            composerIconControlClass={composerIconControlClass}
            toolbarRef={bottomToolbarRef}
          />
        </div>
        {draftSessionId && (
          <ComposerRuntimeStatus
            sessionId={draftSessionId}
            isStreaming={isStreaming}
            draftInputTokens={debouncedTokens}
            isOptimizing={isOptimizing}
            pendingImageReads={pendingImageReads}
            contextCompressionStatus={contextCompressionStatus}
            contextCompressionStatusLabel={contextCompressionStatusLabel}
            model={composerModelCfg}
            className="mt-1.5 px-3"
            showStatus={false}
          />
        )}
      </div>
    </div>
  )
}

// Re-export RuntimeTokenStatistics for external consumers
export { RuntimeTokenStatistics } from './runtime-status'
