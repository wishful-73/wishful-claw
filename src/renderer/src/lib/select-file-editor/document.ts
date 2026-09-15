/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { createTextNode, mergeTextNodes } from './nodes'
import { getFilePlainText, getNodePlainText, getNodePlainTextLength } from './serialize'
import type { EditorDocumentNode, SelectedFileItem } from './types'

export function removeReferenceNode(
  currentDocument: EditorDocumentNode[],
  nodeId: string,
  files: SelectedFileItem[]
): EditorDocumentNode[] {
  const nextNodes: EditorDocumentNode[] = []

  for (const node of currentDocument) {
    if (node.id === nodeId && node.type !== 'text') {
      continue
    }

    if (node.type === 'text') {
      nextNodes.push({ ...node })
      continue
    }

    if (node.type === 'file') {
      nextNodes.push({ ...node, fallbackText: getFilePlainText(node, files) })
    } else {
      nextNodes.push({ ...node })
    }
  }

  return mergeTextNodes(nextNodes)
}

export function normalizeSelectionToFileBoundaries(
  document: EditorDocumentNode[],
  files: SelectedFileItem[],
  start: number,
  end: number
): { start: number; end: number } {
  let cursor = 0
  let nextStart = start
  let nextEnd = end

  for (const node of document) {
    const length = getNodePlainTextLength(node, files)
    const nodeStart = cursor
    const nodeEnd = cursor + length
    cursor = nodeEnd

    if (node.type === 'text' || length === 0) continue

    if (nextStart > nodeStart && nextStart < nodeEnd) {
      nextStart = nextStart - nodeStart <= nodeEnd - nextStart ? nodeStart : nodeEnd
    }

    if (nextEnd > nodeStart && nextEnd < nodeEnd) {
      nextEnd = nextEnd - nodeStart <= nodeEnd - nextEnd ? nodeStart : nodeEnd
    }

    if (nextStart < nodeEnd && nextEnd > nodeStart) {
      nextStart = Math.min(nextStart, nodeStart)
      nextEnd = Math.max(nextEnd, nodeEnd)
    }
  }

  return { start: nextStart, end: nextEnd }
}

export function replaceEditorRange(
  document: EditorDocumentNode[],
  files: SelectedFileItem[],
  start: number,
  end: number,
  replacement: EditorDocumentNode[]
): EditorDocumentNode[] {
  const normalized = normalizeSelectionToFileBoundaries(document, files, start, end)
  const nextDocument: EditorDocumentNode[] = []
  let cursor = 0
  let inserted = false

  for (const node of document) {
    const text = getNodePlainText(node, files)
    const length = text.length
    const nodeStart = cursor
    const nodeEnd = cursor + length
    cursor = nodeEnd

    if (nodeEnd <= normalized.start || nodeStart >= normalized.end) {
      if (!inserted && nodeStart >= normalized.end) {
        nextDocument.push(...replacement.map((item) => ({ ...item })))
        inserted = true
      }
      nextDocument.push({ ...node })
      continue
    }

    if (node.type === 'text') {
      const keepLeft = Math.max(0, normalized.start - nodeStart)
      const keepRight = Math.max(0, nodeEnd - normalized.end)
      const leftText = keepLeft > 0 ? node.text.slice(0, keepLeft) : ''
      const rightText = keepRight > 0 ? node.text.slice(node.text.length - keepRight) : ''
      if (leftText) nextDocument.push(createTextNode(leftText))
      if (!inserted) {
        nextDocument.push(...replacement.map((item) => ({ ...item })))
        inserted = true
      }
      if (rightText) nextDocument.push(createTextNode(rightText))
      continue
    }

    if (!inserted) {
      nextDocument.push(...replacement.map((item) => ({ ...item })))
      inserted = true
    }
  }

  if (!inserted) {
    nextDocument.push(...replacement.map((item) => ({ ...item })))
  }

  return mergeTextNodes(nextDocument)
}

export function documentHasFileReferences(
  document: EditorDocumentNode[],
  fileId?: string
): boolean {
  return document.some(
    (node) => node.type === 'file' && (typeof fileId === 'undefined' || node.fileId === fileId)
  )
}
