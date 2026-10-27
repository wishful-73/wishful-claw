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
  /**
   * S-236：保留但**不再参与判断**。图片一律按图片处理 —— 这张本地能力表追不上新模型、
   * 反代渠道与用户自定义模型，也不该替模型说「你不行」。上游真不支持时由
   * `ImageInputErrors` 认出来剥图重试（档 2）。字段留着是为了不动上层调用签名。
   */
  supportsVision?: boolean
  t: TFunction
  addFilesToEditor: (filePaths: string[], selection?: { start: number; end: number }) => void
  setAttachedImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPreviewImage: React.Dispatch<React.SetStateAction<ImageAttachment | null>>
  setPendingImageReads: React.Dispatch<React.SetStateAction<number>>
}

export function useImageAttachments(opts: UseImageAttachmentsOptions) {
  const { t, addFilesToEditor, setAttachedImages, setPreviewImage, setPendingImageReads } = opts

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

      // S-236（2026-10-27）：不再按 supportsVision 把图片降级成文件引用。
      // 那张能力表追不上新模型 / 反代渠道 / 用户自定义模型，也压不住跨 provider 同名 id 的串号，
      // 结果就是「同一张图，贴进来能看、Read 不能」。现在一律按图片处理，能不能收由上游回答；
      // 上游回「不支持图像」时由 ImageInputErrors 认出来剥图重试（档 2）。
      const imagePaths = paths.filter((filePath) => Boolean(getImageMediaTypeForPath(filePath)))
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
  }, [addFilesToEditor, readImagePathAsAttachment, setAttachedImages, setPendingImageReads, t])

  return {
    addImages,
    removeImage,
    readImagePathAsAttachment,
    getPastedImageFiles,
    handleAttachMedia
  }
}
