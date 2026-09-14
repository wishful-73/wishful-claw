/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { nanoid } from 'nanoid'
import { createTextNode, mergeTextNodes } from './nodes'
import type { EditorDocumentNode, SelectedFileItem } from './types'

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').trim()
}

export function normalizePathKey(value: string): string {
  return normalizePath(value).toLowerCase()
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

function getBaseName(value: string): string {
  const normalized = normalizePath(value)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

function toPreviewPath(sendPath: string, workingFolder?: string): string {
  if (isAbsolutePath(sendPath) || !workingFolder) return sendPath
  const normalizedWorkingFolder = workingFolder.replace(/[\\/]+$/, '')
  return `${normalizedWorkingFolder}/${sendPath}`
}

export function buildFileKey(file: Pick<SelectedFileItem, 'previewPath' | 'sendPath'>): string {
  return `${normalizePathKey(file.previewPath)}::${normalizePathKey(file.sendPath)}`
}

export function compareFiles(left: SelectedFileItem, right: SelectedFileItem): number {
  const nameCompare = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  if (nameCompare !== 0) return nameCompare
  return left.sendPath.localeCompare(right.sendPath, undefined, { sensitivity: 'base' })
}

export function createSelectedFileItem(
  filePath: string,
  workingFolder?: string
): SelectedFileItem | null {
  const normalizedOriginalPath = normalizePath(filePath)
  if (!normalizedOriginalPath) return null

  const normalizedWorkingFolder = workingFolder
    ? normalizePath(workingFolder).replace(/\/+$/, '')
    : ''
  const workingFolderKey = normalizedWorkingFolder
    ? `${normalizePathKey(normalizedWorkingFolder)}/`
    : ''
  const originalPathKey = normalizePathKey(normalizedOriginalPath)
  const isWorkspaceFile = Boolean(workingFolderKey) && originalPathKey.startsWith(workingFolderKey)
  const sendPath = isWorkspaceFile
    ? normalizedOriginalPath.slice(normalizedWorkingFolder.length).replace(/^\/+/, '')
    : normalizedOriginalPath

  return {
    id: nanoid(),
    name: getBaseName(normalizedOriginalPath),
    originalPath: normalizedOriginalPath,
    sendPath,
    previewPath: normalizedOriginalPath,
    isWorkspaceFile
  }
}

export function createSelectedFileItemFromTagPath(
  tagPath: string,
  workingFolder?: string
): SelectedFileItem | null {
  const normalizedSendPath = normalizePath(tagPath)
  if (!normalizedSendPath) return null

  return {
    id: nanoid(),
    name: getBaseName(normalizedSendPath),
    originalPath: normalizedSendPath,
    sendPath: normalizedSendPath,
    previewPath: toPreviewPath(normalizedSendPath, workingFolder),
    isWorkspaceFile: !isAbsolutePath(normalizedSendPath) && Boolean(workingFolder)
  }
}

export function mergeSelectedFiles(
  currentFiles: SelectedFileItem[],
  nextFiles: SelectedFileItem[]
): SelectedFileItem[] {
  const merged = new Map<string, SelectedFileItem>()

  for (const file of currentFiles) {
    merged.set(buildFileKey(file), file)
  }

  for (const file of nextFiles) {
    const key = buildFileKey(file)
    const existing = merged.get(key)
    if (existing) {
      merged.set(key, {
        ...existing,
        ...file,
        id: existing.id
      })
      continue
    }
    merged.set(key, file)
  }

  return Array.from(merged.values()).sort(compareFiles)
}

export function addFilesToSelection(
  currentFiles: SelectedFileItem[],
  filePaths: string[],
  workingFolder?: string
): SelectedFileItem[] {
  const nextFiles = filePaths
    .map((filePath) => createSelectedFileItem(filePath, workingFolder))
    .filter((file): file is SelectedFileItem => Boolean(file))

  return mergeSelectedFiles(currentFiles, nextFiles)
}

export function ensureSelectedFile(
  currentFiles: SelectedFileItem[],
  filePath: string,
  workingFolder?: string
): { files: SelectedFileItem[]; file: SelectedFileItem | null } {
  const created = createSelectedFileItem(filePath, workingFolder)
  if (!created) return { files: currentFiles, file: null }

  const merged = mergeSelectedFiles(currentFiles, [created])
  const file =
    merged.find((item) => buildFileKey(item) === buildFileKey(created)) ||
    merged.find((item) => normalizePathKey(item.sendPath) === normalizePathKey(created.sendPath)) ||
    null

  return { files: merged, file }
}

export function removeSelectedFile(
  currentFiles: SelectedFileItem[],
  document: EditorDocumentNode[],
  fileId: string
): { files: SelectedFileItem[]; document: EditorDocumentNode[] } {
  const removedFile = currentFiles.find((file) => file.id === fileId)
  const files = currentFiles.filter((file) => file.id !== fileId)
  if (!removedFile) return { files, document }

  const nextDocument = mergeTextNodes(
    document.map((node) => {
      if (node.type === 'file' && node.fileId === fileId) {
        return createTextNode(removedFile.sendPath)
      }
      return node
    })
  )

  return { files, document: nextDocument }
}
