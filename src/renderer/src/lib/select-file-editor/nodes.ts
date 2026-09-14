/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { nanoid } from 'nanoid'
import { buildPastedBlockLabel } from '../select-file-tags'
import type {
  EditorDocumentNode,
  EditorFileNode,
  EditorPastedBlockNode,
  EditorPluginNode,
  EditorTextNode
} from './types'

export function createTextNode(text: string): EditorTextNode {
  return {
    type: 'text',
    id: nanoid(),
    text
  }
}

export function createFileNode(fileId: string, fallbackText: string): EditorFileNode {
  return {
    type: 'file',
    id: nanoid(),
    fileId,
    fallbackText
  }
}

export function createPluginNode(pluginId: string, label: string, prompt: string): EditorPluginNode {
  return {
    type: 'plugin',
    id: nanoid(),
    pluginId,
    label,
    prompt
  }
}

/**
 * Fold adjacent text nodes into one. Every structural edit (insert / remove /
 * range replace) can leave neighbouring text fragments behind; normalizing here
 * keeps the document shape stable so `isSameDocument` does not see phantom edits.
 */
export function mergeTextNodes(nodes: EditorDocumentNode[]): EditorDocumentNode[] {
  const merged: EditorDocumentNode[] = []

  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue
      const last = merged[merged.length - 1]
      if (last?.type === 'text') {
        last.text += node.text
      } else {
        merged.push({ ...node })
      }
      continue
    }

    merged.push({ ...node })
  }

  return merged
}

export function createTextReplacementNode(text: string): EditorTextNode {
  return createTextNode(text)
}

export function createFileReferenceNode(fileId: string, fallbackText: string): EditorFileNode {
  return createFileNode(fileId, fallbackText)
}

export function createPluginReferenceNode(
  pluginId: string,
  label: string,
  prompt: string
): EditorPluginNode {
  return createPluginNode(pluginId, label, prompt)
}

export function createPastedBlockNode(label: string, text: string): EditorPastedBlockNode {
  return {
    type: 'pasted',
    id: nanoid(),
    label: label.trim() || buildPastedBlockLabel(text),
    text
  }
}
