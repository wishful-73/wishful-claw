import * as React from 'react'
import type { EditorDocumentNode, SelectedFileItem } from '@renderer/lib/select-file-editor'

export interface EditorSelectionOffsets {
  start: number
  end: number
}

export interface FileAwareEditorHandle {
  focus: () => void
  focusAtEnd: () => void
  setSelectionOffsets: (start: number, end?: number) => void
  getSelectionOffsets: () => EditorSelectionOffsets
  getDocumentSnapshot: () => EditorDocumentNode[]
  /** Commit the current DOM before an action that resets or submits the editor. */
  flushPendingInput: () => void
  getScrollMetrics: () => { scrollHeight: number; clientHeight: number }
  scrollToReference: (fileId: string) => boolean
}

export interface FileAwareEditorProps {
  document: EditorDocumentNode[]
  files: SelectedFileItem[]
  disabled?: boolean
  placeholder?: string
  suggestionText?: string
  showSuggestion?: boolean
  highlightedFileId?: string | null
  onDocumentChange: (document: EditorDocumentNode[]) => void
  onSelectionChange?: (selection: EditorSelectionOffsets) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  onUserEdit?: () => void
  onCompositionStart?: React.CompositionEventHandler<HTMLDivElement>
  onCompositionEnd?: React.CompositionEventHandler<HTMLDivElement>
  onReferencePreview?: (fileId: string) => void
  onReferenceLocate?: (fileId: string) => void
  onReferenceDelete?: (nodeId: string) => void
  /** Expand a collapsed paste back to its verbatim text. */
  onPastedBlockExpand?: (nodeId: string) => void
  className?: string
}
