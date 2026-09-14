/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import {
  createPastedBlockTag,
  createSelectFileTag,
  createSelectPluginTag,
  parseSelectFileText
} from '../select-file-tags'
import { createFileNode, createPastedBlockNode, createPluginNode, createTextNode, mergeTextNodes } from './nodes'
import {
  compareFiles,
  createSelectedFileItemFromTagPath,
  mergeSelectedFiles,
  normalizePath,
  normalizePathKey
} from './files'
import type { EditorDocumentNode, EditorFileNode, SelectedFileItem, SerializeOptions } from './types'

export function getFilePlainText(node: EditorFileNode, files: SelectedFileItem[]): string {
  const file = files.find((item) => item.id === node.fileId)
  return file?.sendPath || node.fallbackText
}

export function getNodePlainText(node: EditorDocumentNode, files: SelectedFileItem[]): string {
  if (node.type === 'text') return node.text
  if (node.type === 'file') return getFilePlainText(node, files)
  if (node.type === 'pasted') return node.text
  return node.label || node.pluginId
}

export function getNodePlainTextLength(
  node: EditorDocumentNode,
  files: SelectedFileItem[]
): number {
  return getNodePlainText(node, files).length
}

export function editorDocumentToPlainText(
  document: EditorDocumentNode[],
  files: SelectedFileItem[]
): string {
  return document.map((node) => getNodePlainText(node, files)).join('')
}

export function serializeEditorDocument(
  document: EditorDocumentNode[],
  files: SelectedFileItem[],
  options?: SerializeOptions
): string {
  const referencedFileIds = new Set<string>()
  const base = document
    .map((node) => {
      if (node.type === 'text') return node.text
      if (node.type === 'plugin') {
        if (options?.expandPluginPrompts) return node.prompt
        return createSelectPluginTag({
          pluginId: node.pluginId,
          label: node.label,
          prompt: node.prompt
        })
      }
      // A collapsed paste keeps its verbatim text inside the tag so the draft
      // round-trips; expandPastedBlocks is what flattens it for submission.
      if (node.type === 'pasted') {
        if (options?.expandPastedBlocks) return node.text
        return createPastedBlockTag({ label: node.label, text: node.text })
      }
      const file = files.find((item) => item.id === node.fileId)
      if (!file) return node.fallbackText
      referencedFileIds.add(file.id)
      return createSelectFileTag(file.sendPath)
    })
    .join('')

  if (!options?.appendUnreferencedFiles) return base

  const danglingTags = files
    .filter((file) => !referencedFileIds.has(file.id))
    .map((file) => createSelectFileTag(file.sendPath))
    .filter(Boolean)

  if (danglingTags.length === 0) return base
  if (!base.trim()) return danglingTags.join('\n')
  return `${base}${base.endsWith('\n') ? '' : '\n'}${danglingTags.join('\n')}`
}

export function deserializeEditorState(
  text: string,
  workingFolder?: string,
  baseFiles: SelectedFileItem[] = []
): {
  document: EditorDocumentNode[]
  selectedFiles: SelectedFileItem[]
} {
  const reusableFiles = mergeSelectedFiles([], baseFiles)
  const selectedFiles: SelectedFileItem[] = []
  const selectedFileIds = new Set<string>()
  const bySendPath = new Map(reusableFiles.map((file) => [normalizePathKey(file.sendPath), file]))
  const document: EditorDocumentNode[] = []

  for (const segment of parseSelectFileText(text)) {
    if (segment.type === 'text') {
      if (segment.text) document.push(createTextNode(segment.text))
      continue
    }

    if (segment.type === 'plugin') {
      document.push(createPluginNode(segment.pluginId, segment.label, segment.prompt))
      continue
    }

    if (segment.type === 'pasted') {
      document.push(createPastedBlockNode(segment.label, segment.pastedText))
      continue
    }

    const normalizedPath = normalizePath(segment.text)
    if (!normalizedPath) continue

    const existingFile = bySendPath.get(normalizePathKey(normalizedPath))
    const file = existingFile ?? createSelectedFileItemFromTagPath(normalizedPath, workingFolder)
    if (!file) continue

    if (!existingFile) {
      bySendPath.set(normalizePathKey(file.sendPath), file)
    }

    if (!selectedFileIds.has(file.id)) {
      selectedFileIds.add(file.id)
      selectedFiles.push(file)
    }

    document.push(createFileNode(file.id, file.sendPath))
  }

  return {
    document: mergeTextNodes(document),
    selectedFiles: selectedFiles.sort(compareFiles)
  }
}
