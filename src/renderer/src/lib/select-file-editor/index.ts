/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 *
 * Composer document model: node types, the selected-file set, and the
 * serialization round-trip that turns a document into the plain text sent to
 * the model. Split out of a single 548-line module; the public surface is
 * unchanged — every consumer keeps importing from `@renderer/lib/select-file-editor`.
 */

export type {
  EditorDocumentNode,
  EditorFileNode,
  EditorPastedBlockNode,
  EditorPluginNode,
  EditorTextNode,
  SelectedFileItem
} from './types'

export {
  createFileReferenceNode,
  createPastedBlockNode,
  createPluginReferenceNode,
  createTextReplacementNode
} from './nodes'

export {
  addFilesToSelection,
  createSelectedFileItem,
  createSelectedFileItemFromTagPath,
  ensureSelectedFile,
  mergeSelectedFiles,
  removeSelectedFile
} from './files'

export {
  deserializeEditorState,
  editorDocumentToPlainText,
  getFilePlainText,
  getNodePlainText,
  getNodePlainTextLength,
  serializeEditorDocument
} from './serialize'

export {
  documentHasFileReferences,
  normalizeSelectionToFileBoundaries,
  removeReferenceNode,
  replaceEditorRange
} from './document'
