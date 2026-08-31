import * as React from 'react'
import type { FileAwareEditorHandle } from '../file-aware-editor-utils'
import type { SelectedFileItem } from '@renderer/lib/select-file-editor'

type EditorSelection = { start: number; end: number }

interface UseComposerInteractionsOptions {
  selectedFilesRef: React.MutableRefObject<SelectedFileItem[]>
  editorRef: React.MutableRefObject<FileAwareEditorHandle | null>
  editorSelection: EditorSelection
  setEditorSelection: React.Dispatch<React.SetStateAction<EditorSelection>>
  setHighlightedFileId: (fileId: string | null) => void
  openFilePreview: (path: string) => void
  replaceSelectionWithText: (text: string, selection: EditorSelection) => void
  getPastedImageFiles: (items: DataTransfer) => File[]
  addImages: (files: File[]) => void | Promise<void>
  handleRecommendationSelectionChange: () => void
}

export function useComposerInteractions({
  selectedFilesRef,
  editorRef,
  editorSelection,
  setEditorSelection,
  setHighlightedFileId,
  openFilePreview,
  replaceSelectionWithText,
  getPastedImageFiles,
  addImages,
  handleRecommendationSelectionChange
}: UseComposerInteractionsOptions) {
  const handlePreviewFile = React.useCallback((fileId: string): void => {
    const file = selectedFilesRef.current.find((item) => item.id === fileId)
    if (file) openFilePreview(file.previewPath)
  }, [openFilePreview, selectedFilesRef])

  const handleLocateFileReference = React.useCallback((fileId: string): void => {
    setHighlightedFileId(fileId)
    editorRef.current?.scrollToReference(fileId)
    editorRef.current?.focus()
  }, [editorRef, setHighlightedFileId])

  const handlePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>): void => {
    const imageFiles = getPastedImageFiles(event.clipboardData)
    if (imageFiles.length > 0) {
      event.preventDefault()
      void addImages(imageFiles)
      return
    }

    const plainText = event.clipboardData.getData('text/plain')
    if (!plainText) return
    event.preventDefault()
    const selection = editorRef.current?.getSelectionOffsets() ?? editorSelection
    replaceSelectionWithText(plainText, selection)
  }, [addImages, editorRef, editorSelection, getPastedImageFiles, replaceSelectionWithText])

  const handleEditorSelectionChange = React.useCallback((selection: EditorSelection): void => {
    setEditorSelection((current) => current.start === selection.start && current.end === selection.end ? current : selection)
    handleRecommendationSelectionChange()
  }, [handleRecommendationSelectionChange, setEditorSelection])

  return { handlePreviewFile, handleLocateFileReference, handlePaste, handleEditorSelectionChange }
}
