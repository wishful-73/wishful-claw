import * as React from 'react'
import type { FileAwareEditorHandle } from '../file-aware-editor-utils'
import type { SelectedFileItem } from '@renderer/lib/select-file-editor'
import { buildPastedBlockLabel, createPastedBlockTag } from '@renderer/lib/select-file-tags'

type EditorSelection = { start: number; end: number }

/**
 * A paste longer than either bound collapses into a chip instead of expanding
 * inline. Either bound alone is enough — 2000 short lines or 20 very long ones
 * both wreck the composer.
 */
const PASTE_COLLAPSE_CHAR_THRESHOLD = 2000
const PASTE_COLLAPSE_LINE_THRESHOLD = 20

function shouldCollapsePaste(text: string): boolean {
  if (text.length > PASTE_COLLAPSE_CHAR_THRESHOLD) return true
  let lines = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1
      if (lines > PASTE_COLLAPSE_LINE_THRESHOLD) return true
    }
  }
  return false
}

const clipboardTextToHtml = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

/**
 * Flattens an HTML clipboard flavour into plain text.
 *
 * `textContent` alone concatenates adjacent blocks with no separator — a copied
 * `<ul><li>a</li><li>b</li></ul>` would collapse to `ab` — so block boundaries are turned
 * into newlines first, then runs of blank lines are squeezed back down.
 */
function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return ''
  for (const br of Array.from(body.querySelectorAll('br'))) {
    br.replaceWith('\n')
  }
  for (const block of Array.from(
    body.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote')
  )) {
    block.append('\n')
  }
  return (body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Picks the paste payload off the clipboard.
 *
 * Plain text is preferred. When the source offered only HTML the HTML is flattened instead —
 * that is the case that used to look like "Ctrl+V does nothing", because `handlePaste` bailed
 * out before `preventDefault` and left the default insertion to be swallowed by the
 * controlled editor. The clipboard-enhancer path never hit it, since it writes plain text
 * back via `clipboard.writeText`.
 *
 * `htmlToText` is injectable purely so this stays unit-testable: node has no `DOMParser`.
 */
export function composePastedText(
  plain: string | null | undefined,
  html: string | null | undefined,
  htmlToText: (html: string) => string = htmlToPlainText
): string {
  if (plain) return plain
  if (!html) return ''
  return htmlToText(html)
}

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

    // Plain text is the common case. An HTML-only clipboard (a manual Ctrl+V from a rich
    // source) used to fall straight into `return` *without* preventDefault, leaving the
    // browser's default insertion to be swallowed by this controlled editor — which is
    // exactly what "Ctrl+V does nothing" looked like. The clipboard-enhancer path never hit
    // it, because it writes plain text back via `clipboard.writeText` (S-100).
    const plainText = composePastedText(
      event.clipboardData.getData('text/plain'),
      event.clipboardData.getData('text/html')
    )
    if (!plainText) return

    event.preventDefault()
    editorRef.current?.focus()

    // Long paste: collapse into a chip. Goes through the normal controlled
    // replacement path (the tag deserializes into a pasted node), because
    // insertHTML would bypass the document state entirely.
    if (shouldCollapsePaste(plainText)) {
      const selection = editorRef.current?.getSelectionOffsets() ?? editorSelection
      replaceSelectionWithText(
        createPastedBlockTag({
          label: buildPastedBlockLabel(plainText),
          text: plainText
        }),
        selection
      )
      return
    }

    try {
      // 不用 insertText：它把换行交给 Blink 拆成 <div> 块，解析器只补块后换行会吞掉换行，
      // 且选区未变更的连续 insertText 会被并入同一撤销组。
      const inserted = document.execCommand('insertHTML', false, clipboardTextToHtml(plainText))
      if (inserted) return
    } catch {
      // Fall through to the controlled editor replacement path.
    }
    const selection = editorRef.current?.getSelectionOffsets() ?? editorSelection
    replaceSelectionWithText(plainText, selection)
  }, [addImages, editorRef, editorSelection, getPastedImageFiles, replaceSelectionWithText])

  const handleEditorSelectionChange = React.useCallback((selection: EditorSelection): void => {
    setEditorSelection((current) => current.start === selection.start && current.end === selection.end ? current : selection)
    handleRecommendationSelectionChange()
  }, [handleRecommendationSelectionChange, setEditorSelection])

  return { handlePreviewFile, handleLocateFileReference, handlePaste, handleEditorSelectionChange }
}
