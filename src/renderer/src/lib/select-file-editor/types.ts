/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export interface SelectedFileItem {
  id: string
  name: string
  originalPath: string
  sendPath: string
  previewPath: string
  isWorkspaceFile: boolean
}

export interface EditorTextNode {
  type: 'text'
  id: string
  text: string
}

export interface EditorFileNode {
  type: 'file'
  id: string
  fileId: string
  fallbackText: string
}

export interface EditorPluginNode {
  type: 'plugin'
  id: string
  pluginId: string
  label: string
  prompt: string
}

/**
 * A collapsed long paste. `text` holds the verbatim pasted content so nothing is
 * lost while the composer only shows a small chip; `label` is the chip caption.
 */
export interface EditorPastedBlockNode {
  type: 'pasted'
  id: string
  label: string
  text: string
}

export type EditorDocumentNode =
  | EditorTextNode
  | EditorFileNode
  | EditorPluginNode
  | EditorPastedBlockNode

export interface SerializeOptions {
  appendUnreferencedFiles?: boolean
  expandPluginPrompts?: boolean
  /** Flatten collapsed pastes back to their verbatim text (used on submit). */
  expandPastedBlocks?: boolean
}
