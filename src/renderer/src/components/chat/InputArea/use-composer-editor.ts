import * as React from 'react'
import {
  deserializeEditorState, documentHasFileReferences,
  editorDocumentToPlainText, ensureSelectedFile, mergeSelectedFiles,
  removeReferenceNode, replaceEditorRange, serializeEditorDocument,
  type EditorDocumentNode, type SelectedFileItem
} from '@renderer/lib/select-file-editor'
import { createSelectFileToken } from '@renderer/lib/select-file-tags'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import type { FileAwareEditorHandle } from '../file-aware-editor-utils'

interface UseComposerEditorOptions {
  workingFolder?: string
  editorRef: React.RefObject<FileAwareEditorHandle | null>
  attachedImages: ImageAttachment[]
  draftSaveTimerRef: React.RefObject<ReturnType<typeof setTimeout> | undefined>
  removePersistedDraft: () => void
  setSelectedSkill: (name: string | null) => void
  setAttachedImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPreviewImage: (img: ImageAttachment | null) => void
}

export function useComposerEditor(opts: UseComposerEditorOptions) {
  const [documentNodes, setDocumentNodes] = React.useState<EditorDocumentNode[]>([])
  const [selectedFiles, setSelectedFiles] = React.useState<SelectedFileItem[]>([])
  const [highlightedFileId, setHighlightedFileId] = React.useState<string | null>(null)
  const [editorSelection, setEditorSelection] = React.useState({ start: 0, end: 0 })

  const text = React.useMemo(
    () => editorDocumentToPlainText(documentNodes, selectedFiles),
    [documentNodes, selectedFiles]
  )
  const finalSerializedText = React.useMemo(
    () => serializeEditorDocument(documentNodes, selectedFiles),
    [documentNodes, selectedFiles]
  )

  const documentRef = React.useRef(documentNodes)
  const selectedFilesRef = React.useRef(selectedFiles)
  documentRef.current = documentNodes
  selectedFilesRef.current = selectedFiles
  documentRef.current = documentNodes
  selectedFilesRef.current = selectedFiles

  const applyEditorStateFromSerializedText = React.useCallback(
    (nextText: string, baseFiles: SelectedFileItem[] = selectedFilesRef.current) => {
      const nextState = deserializeEditorState(nextText, opts.workingFolder, baseFiles)
      setDocumentNodes(nextState.document)
      setSelectedFiles(nextState.selectedFiles)
    },
    [opts.workingFolder]
  )

  const setText = React.useCallback(
    (value: string | ((prev: string) => string)) => {
      const nextText = typeof value === 'function' ? value(text) : value
      applyEditorStateFromSerializedText(nextText, selectedFilesRef.current)
    },
    [applyEditorStateFromSerializedText, text]
  )

  const focusInputAtEnd = React.useCallback(() => {
    opts.editorRef.current?.focusAtEnd()
  }, [opts.editorRef])

  const replaceSelectionWithText = React.useCallback(
    (
      replacement: string,
      selection: { start: number; end: number } = editorSelection,
      cursorOffset = 0,
      nextSelectedFiles?: SelectedFileItem[]
    ) => {
      const replacementState = deserializeEditorState(
        replacement, opts.workingFolder,
        nextSelectedFiles ?? selectedFilesRef.current
      )
      const candidateFiles = mergeSelectedFiles(
        nextSelectedFiles ?? selectedFilesRef.current,
        replacementState.selectedFiles
      )
      const nextDocument = replaceEditorRange(
        documentRef.current, selectedFilesRef.current,
        selection.start, selection.end, replacementState.document
      )
      const referencedFileIds = new Set(
        nextDocument
          .filter((node): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file')
          .map((node) => node.fileId)
      )
      const nextFiles = candidateFiles.filter((file) => referencedFileIds.has(file.id))
      const nextCursor =
        selection.start +
        editorDocumentToPlainText(replacementState.document, candidateFiles).length +
        cursorOffset

      setDocumentNodes(nextDocument)
      setSelectedFiles(nextFiles)
      requestAnimationFrame(() => {
        opts.editorRef.current?.focus()
        opts.editorRef.current?.setSelectionOffsets(nextCursor, nextCursor)
        setEditorSelection({ start: nextCursor, end: nextCursor })
      })
    },
    [editorSelection, opts.workingFolder, opts.editorRef]
  )

  const addFilesToEditor = React.useCallback(
    (filePaths: string[], selection?: { start: number; end: number }) => {
      const nextSelection = selection ??
        opts.editorRef.current?.getSelectionOffsets() ?? {
          start: editorSelection.start,
          end: editorSelection.end
        }
      const filesToInsert: SelectedFileItem[] = []
      let mergedFiles = selectedFilesRef.current

      for (const filePath of filePaths) {
        const ensured = ensureSelectedFile(mergedFiles, filePath, opts.workingFolder)
        mergedFiles = ensured.files
        if (ensured.file) {
          filesToInsert.push(ensured.file)
        }
      }

      if (filesToInsert.length === 0) return

      const replacement = filesToInsert
        .map((file) => createSelectFileToken(file.sendPath))
        .filter(Boolean)
        .join('\n')

      replaceSelectionWithText(replacement, nextSelection, 0, mergedFiles)
    },
    [editorSelection.end, editorSelection.start, opts.workingFolder, replaceSelectionWithText]
  )

  const getLiveEditorState = React.useCallback(() => {
    const liveDocument = opts.editorRef.current?.getDocumentSnapshot() ?? documentRef.current
    const referencedFileIds = new Set(
      liveDocument
        .filter((node: any): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file')
        .map((node: any) => node.fileId)
    )
    const liveSelectedFiles = selectedFilesRef.current.filter((file) => referencedFileIds.has(file.id))

    return {
      plainText: editorDocumentToPlainText(liveDocument, liveSelectedFiles),
      // serializedText keeps the pasted-block tag so the draft round-trips with
      // its chip intact; promptText is what the model receives, so collapsed
      // pastes must be flattened back to their verbatim text there.
      serializedText: serializeEditorDocument(liveDocument, liveSelectedFiles),
      promptText: serializeEditorDocument(liveDocument, liveSelectedFiles, {
        expandPluginPrompts: true,
        expandPastedBlocks: true
      }),
      selectedFiles: liveSelectedFiles
    }
  }, [opts.editorRef])

  /**
   * Expand a collapsed paste back into its verbatim text, replacing the chip in
   * place. Offsets are in the plain-text coordinate system that
   * `replaceEditorRange` expects, so the whole pasted node is swapped for one
   * text node in a single edit — which also makes it one native undo step.
   */
  const expandPastedBlock = React.useCallback(
    (nodeId: string): void => {
      const liveDocument = documentRef.current
      const liveFiles = selectedFilesRef.current
      const index = liveDocument.findIndex((node) => node.type === 'pasted' && node.id === nodeId)
      if (index < 0) return
      const node = liveDocument[index]
      if (node.type !== 'pasted') return
      const start = editorDocumentToPlainText(liveDocument.slice(0, index), liveFiles).length
      replaceSelectionWithText(node.text, { start, end: start + node.text.length })
    },
    [replaceSelectionWithText]
  )

  const resetComposer = React.useCallback((): void => {
    clearTimeout(opts.draftSaveTimerRef.current)
    void opts.removePersistedDraft()

    setDocumentNodes([])
    setSelectedFiles([])
    setHighlightedFileId(null)
    setEditorSelection({ start: 0, end: 0 })
    opts.setAttachedImages([])
    opts.setPreviewImage(null)
    opts.setSelectedSkill(null)
    requestAnimationFrame(() => {
      opts.editorRef.current?.setSelectionOffsets(0, 0)
    })
  }, [opts])

  const handleEditorDocumentChange = React.useCallback((nextDocument: EditorDocumentNode[]) => {
    const referencedFileIds = new Set(
      nextDocument
        .filter((node): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file')
        .map((node) => node.fileId)
    )
    setDocumentNodes(nextDocument)
    setSelectedFiles((currentFiles) => currentFiles.filter((file) => referencedFileIds.has(file.id)))
  }, [])

  const handleRemoveFileReference = React.useCallback((nodeId: string) => {
    const currentDocument = documentRef.current
    const targetNode = currentDocument.find((node) => node.type !== 'text' && node.id === nodeId)
    if (!targetNode) return

    const nextDocument = removeReferenceNode(currentDocument, nodeId, selectedFilesRef.current)
    const nextFiles =
      targetNode.type === 'file' && !documentHasFileReferences(nextDocument, targetNode.fileId)
        ? selectedFilesRef.current.filter((file) => file.id !== targetNode.fileId)
        : selectedFilesRef.current

    setDocumentNodes(nextDocument)
    setSelectedFiles(nextFiles)
  }, [])

  return {
    documentNodes, setDocumentNodes,
    selectedFiles, setSelectedFiles,
    highlightedFileId, setHighlightedFileId,
    editorSelection, setEditorSelection,
    text, finalSerializedText,
    documentRef, selectedFilesRef,
    applyEditorStateFromSerializedText, setText, focusInputAtEnd,
    replaceSelectionWithText, addFilesToEditor,
    getLiveEditorState, expandPastedBlock, resetComposer,
    handleEditorDocumentChange, handleRemoveFileReference
  }
}
