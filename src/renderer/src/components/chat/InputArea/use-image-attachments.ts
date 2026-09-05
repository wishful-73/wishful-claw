// Image attachment callbacks for InputArea
// State remains in the main component; this hook provides callbacks only

import * as React from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  ACCEPTED_IMAGE_TYPES,
  fileToImageAttachment,
  type ImageAttachment
} from '@renderer/lib/image-attachments'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { getImageMediaTypeForPath, createImageAttachmentId } from './utils'

export interface UseImageAttachmentsOptions {
  supportsVision: boolean
  t: TFunction
  addFilesToEditor: (filePaths: string[], selection?: { start: number; end: number }) => void
  setAttachedImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPreviewImage: React.Dispatch<React.SetStateAction<ImageAttachment | null>>
  setPendingImageReads: React.Dispatch<React.SetStateAction<number>>
}

export function useImageAttachments(opts: UseImageAttachmentsOptions) {
  const { supportsVision, t, addFilesToEditor, setAttachedImages, setPreviewImage, setPendingImageReads } = opts

  const addImages = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setPendingImageReads((prev) => prev + files.length)
    try {
      const results = await Promise.all(files.map(fileToImageAttachment))
      const valid = results.filter(Boolean) as ImageAttachment[]
      if (valid.length > 0) {
        setAttachedImages((prev) => [...prev, ...valid])
      }
    } finally {
      setPendingImageReads((prev) => Math.max(0, prev - files.length))
    }
  }, [setAttachedImages, setPendingImageReads])

  const removeImage = React.useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id))
    setPreviewImage((current) => (current?.id === id ? null : current))
  }, [setAttachedImages, setPreviewImage])

  const readImagePathAsAttachment = React.useCallback(
    async (filePath: string): Promise<ImageAttachment | null> => {
      const mediaType = getImageMediaTypeForPath(filePath)
      if (!mediaType) return null

      const result = (await ipcClient.invoke(IPC.FS_READ_FILE_BINARY, { path: filePath })) as {
        data?: string
        error?: string
      }
      if (result.error || !result.data) {
        console.warn('[InputArea] Failed to read selected image:', result.error ?? filePath)
        return null
      }

      return {
        id: createImageAttachmentId(),
        dataUrl: `data:${mediaType};base64,${result.data}`,
        mediaType
      }
    },
    []
  )

  const getPastedImageFiles = React.useCallback(
    (clipboardData: DataTransfer | null | undefined): File[] => {
      if (!clipboardData) return []
      return Array.from(clipboardData.items)
        .filter((item) => item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type))
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[]
    },
    []
  )

  const handleAttachMedia = React.useCallback(async (): Promise<void> => {
    try {
      const result = (await ipcClient.invoke(IPC.FS_SELECT_FILE, {
        multiSelections: true,
        filters: [
          {
            name: t('input.mediaFilter'),
            extensions: [
              'png', 'jpg', 'jpeg', 'gif', 'webp', 'md', 'txt',
              'docx', 'pdf', 'html', 'csv', 'json', 'xml', 'yaml',
              'yml', 'ts', 'js', 'tsx', 'jsx'
            ]
          },
          { name: t('input.allFilesFilter'), extensions: ['*'] }
        ]
      })) as { canceled?: boolean; path?: string; paths?: string[] }

      const paths = Array.from(
        new Set(
          (Array.isArray(result.paths) && result.paths.length > 0
            ? result.paths
            : result.path
              ? [result.path]
              : []
          ).filter((filePath): filePath is string => Boolean(filePath))
        )
      )
      if (result.canceled || paths.length === 0) return

      const imagePaths = supportsVision
        ? paths.filter((filePath) => Boolean(getImageMediaTypeForPath(filePath)))
        : []
      const filePaths = paths.filter((filePath) => !imagePaths.includes(filePath))
      const imageFallbackPaths: string[] = []

      if (imagePaths.length > 0) {
        setPendingImageReads((prev) => prev + imagePaths.length)
        try {
          const images = await Promise.all(
            imagePaths.map(async (filePath) => {
              const attachment = await readImagePathAsAttachment(filePath)
              if (!attachment) imageFallbackPaths.push(filePath)
              return attachment
            })
          )
          const validImages = images.filter((image): image is ImageAttachment => Boolean(image))
          if (validImages.length > 0) {
            setAttachedImages((prev) => [...prev, ...validImages])
          }
        } finally {
          setPendingImageReads((prev) => Math.max(0, prev - imagePaths.length))
        }
      }

      const pathsForFileReferences = [...filePaths, ...imageFallbackPaths]
      if (pathsForFileReferences.length > 0) {
        addFilesToEditor(pathsForFileReferences)
      }
    } catch (error) {
      console.error('[InputArea] Failed to attach media:', error)
      toast.error(t('input.attachMediaFailed'))
    }
  }, [addFilesToEditor, readImagePathAsAttachment, setAttachedImages, setPendingImageReads, supportsVision, t])

  return {
    addImages,
    removeImage,
    readImagePathAsAttachment,
    getPastedImageFiles,
    handleAttachMedia
  }
}
