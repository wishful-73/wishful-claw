// Composer editor area: skill tag, optimizing indicator, optimization dialog,
// drag overlay, FileAwareEditor, flyovers, hidden file input

import * as React from 'react'
import { Sparkles, X, FileUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'
import { ACCEPTED_IMAGE_TYPES, type ImageAttachment } from '@renderer/lib/image-attachments'
import { FileAwareEditor } from '../FileAwareEditor'
import type { FileAwareEditorHandle } from '../file-aware-editor-utils'
import type { EditorDocumentNode, SelectedFileItem } from '@renderer/lib/select-file-editor'
import { OptimizationDialog } from './optimization-dialog'
import { ComposerFlyovers } from './composer-flyovers'
import type { FileSearchItem, SlashSuggestionItem } from './types'
import type { OptimizationOption } from './use-prompt-optimizer'

export interface ComposerEditorAreaProps {
  // Drag state
  dragging: boolean
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void
  handleDropWrapped: (e: React.DragEvent<HTMLDivElement>) => void

  // Editor state
  editorRef: React.RefObject<FileAwareEditorHandle | null>
  documentNodes: EditorDocumentNode[]
  selectedFiles: SelectedFileItem[]
  disabled: boolean
  isOptimizingLocked: boolean
  isOptimizing: boolean
  selectedSkill: string | null
  onClearSelectedSkill: () => void
  attachedImages: ImageAttachment[]
  supportsVision: boolean

  // Placeholder (pre-computed by parent)
  placeholder: string

  // Suggestion / recommendation
  suggestionText: string | null | undefined
  showSuggestion: boolean
  shouldAutoAcceptRecommendation: boolean
  autoAcceptCountdown: number | null
  hasFileReferences: boolean

  // Editor callbacks
  highlightedFileId: string | null
  onDocumentChange: (doc: EditorDocumentNode[]) => void
  onSelectionChange: (selection: { start: number; end: number }) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onReferencePreview: (fileId: string) => void
  onReferenceLocate: (fileId: string) => void
  onReferenceDelete: (nodeId: string) => void

  // Optimization dialog
  showOptimizationDialog: boolean
  setShowOptimizationDialog: (open: boolean) => void
  optimizationOptions: OptimizationOption[]
  optimizingText?: string
  selectedOptionIndex: number
  setSelectedOptionIndex: React.Dispatch<React.SetStateAction<number>>
  onUseOption: (content: string) => void
  onCancelOptimization: () => void

  // File search flyover
  fileMenuOpen: boolean
  fileSearchLoading: boolean
  fileSearchResults: FileSearchItem[]
  selectedFileSearchIndex: number
  setSelectedFileSearchIndex: React.Dispatch<React.SetStateAction<number>>
  flyoutPointerRef: React.MutableRefObject<{ x: number; y: number } | null>
  insertSelectedFile: (path: string) => void
  needsWorkingFolder: boolean
  onSelectFolder?: (() => void) | undefined

  // Slash command flyover
  slashMenuOpen: boolean
  slashQuery: string | null
  slashSuggestionsLoading: boolean
  filteredSlashSuggestions: SlashSuggestionItem[]
  selectedSlashIndex: number
  setSelectedSlashIndex: React.Dispatch<React.SetStateAction<number>>
  slashListRef: React.RefObject<HTMLDivElement | null>
  applySlashSuggestion: (item: import('./types').SlashSuggestionItem) => void

  // Hidden file input for queue images
  queueFileInputRef: React.RefObject<HTMLInputElement | null>
  addQueuedImages: (files: File[]) => void
}

export function ComposerEditorArea(props: ComposerEditorAreaProps) {
  const { t } = useTranslation('chat')

  return (
    <>
      {/* Skill tag */}
      {props.selectedSkill && (
        <div className="shrink-0 px-3 pt-3 pb-0">
          <span className="composer-skill-tag inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
            <Sparkles className="size-3" />
            {props.selectedSkill}
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={props.onClearSelectedSkill}
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}

      {/* Optimizing indicator */}
      {props.isOptimizing && (
        <div className="shrink-0 px-3 pt-3 pb-1">
          <div className="composer-panel rounded-[14px] px-3 py-2">
            <div className="flex items-center gap-2 text-[var(--composer-chip-text)]">
              <Spinner className="size-3.5" />
              <span className="text-xs font-semibold">
                {t('input.optimizing', { defaultValue: 'Optimizing your prompt...' })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Optimization Dialog */}
      <OptimizationDialog
        open={props.showOptimizationDialog}
        onOpenChange={props.setShowOptimizationDialog}
        options={props.optimizationOptions}
        optimizingText={props.optimizingText}
        selectedOptionIndex={props.selectedOptionIndex}
        onSelectOption={props.setSelectedOptionIndex}
        onUseOption={props.onUseOption}
        onCancel={props.onCancelOptimization}
        isOptimizing={props.isOptimizing}
      />

      {/* Text input area */}
      <div
        className={cn(
          'composer-editor-region relative flex min-h-0 flex-1 flex-col px-3',
          props.selectedSkill || props.attachedImages.length > 0 ? 'pt-1.5' : 'pt-3'
        )}
        onDrop={props.handleDropWrapped}
        onDragOver={props.handleDragOver}
        onDragLeave={props.handleDragLeave}
      >
        {props.dragging && (
          <div className="composer-drop-overlay absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <span className="flex items-center gap-1.5 text-xs text-primary/70 font-medium">
              <FileUp className="size-3.5" />
              {props.supportsVision ? t('input.dropImages') : t('input.dropFiles')}
            </span>
          </div>
        )}
        <div className="relative flex-1 min-h-0 overflow-visible">
          {props.shouldAutoAcceptRecommendation &&
            props.autoAcceptCountdown !== null &&
            props.suggestionText &&
            !props.hasFileReferences && (
              <div className="pointer-events-none absolute right-2 top-2 z-20 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                {props.autoAcceptCountdown}s
              </div>
            )}
          <FileAwareEditor
            ref={props.editorRef}
            document={props.documentNodes}
            files={props.selectedFiles}
            disabled={props.disabled || props.isOptimizingLocked}
            placeholder={props.placeholder}
            suggestionText={props.suggestionText ?? undefined}
            showSuggestion={props.showSuggestion}
            highlightedFileId={props.highlightedFileId}
            onDocumentChange={props.onDocumentChange}
            onSelectionChange={props.onSelectionChange}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            onKeyDown={props.onKeyDown}
            onPaste={props.onPaste}
            onCompositionStart={props.onCompositionStart}
            onCompositionEnd={props.onCompositionEnd}
            onReferencePreview={props.onReferencePreview}
            onReferenceLocate={props.onReferenceLocate}
            onReferenceDelete={props.onReferenceDelete}
            className="h-full w-full"
          />
          <ComposerFlyovers
            fileMenuOpen={props.fileMenuOpen}
            fileSearchLoading={props.fileSearchLoading}
            fileSearchResults={props.fileSearchResults}
            selectedFileSearchIndex={props.selectedFileSearchIndex}
            setSelectedFileSearchIndex={props.setSelectedFileSearchIndex}
            flyoutPointerRef={props.flyoutPointerRef}
            insertSelectedFile={props.insertSelectedFile}
            needsWorkingFolder={props.needsWorkingFolder}
            onSelectFolder={props.onSelectFolder}
            slashMenuOpen={props.slashMenuOpen}
            slashQuery={props.slashQuery}
            slashSuggestionsLoading={props.slashSuggestionsLoading}
            slashSuggestions={props.filteredSlashSuggestions}
            selectedSlashIndex={props.selectedSlashIndex}
            setSelectedSlashIndex={props.setSelectedSlashIndex}
            slashListRef={props.slashListRef}
            applySlashSuggestion={props.applySlashSuggestion}
          />
        </div>
      </div>

      {/* Hidden file input for queue image upload */}
      <input
        ref={props.queueFileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            void props.addQueuedImages(Array.from(e.target.files))
          }
          e.target.value = ''
        }}
      />
    </>
  )
}
