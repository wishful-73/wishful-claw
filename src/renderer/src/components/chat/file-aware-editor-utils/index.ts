/*
 * Composer contenteditable bridge: node types, chip builders, DOM ⇄ document
 * round-trip, and selection math. Split out of a single 612-line module; the
 * public surface is unchanged — consumers keep importing from
 * `@renderer/components/chat/file-aware-editor-utils`.
 */

export type { EditorSelectionOffsets, FileAwareEditorHandle, FileAwareEditorProps } from './types'

export {
  appendTextContent,
  buildFileChip,
  buildPastedChip,
  buildPluginChip,
  getFileChipLabel
} from './chips'

export {
  collectTextContent,
  isSameDocument,
  parseDomToDocument,
  renderDocument
} from './dom'

export { getSelectionOffsets, setSelectionFromPoint, setSelectionOffsets } from './selection'

export { editorDocumentToPlainText } from '@renderer/lib/select-file-editor'
