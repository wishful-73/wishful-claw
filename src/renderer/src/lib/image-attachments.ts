/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { nanoid } from 'nanoid'
import { filePathToMediaUrl } from './local-media-url'
import type { ContentBlock, ImageBlock, UnifiedMessage } from './api/types'
import {
  parseSystemCommandTag,
  stripSystemCommandTag,
  type SystemCommandSnapshot
} from './commands/system-command'

export interface ImageAttachment {
  id: string
  dataUrl: string
  mediaType: string
  /** S-224：图片落盘后的磁盘路径。只剩路径的附件靠它 hydrate 回 base64。 */
  filePath?: string
}

export interface EditableUserMessageDraft {
  text: string
  images: ImageAttachment[]
  command: SystemCommandSnapshot | null
}

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20 MB
export const QUEUED_IMAGE_ONLY_TEXT = '[User attached images without additional text.]'

const SYSTEM_REMINDER_PATTERN = /<system-remind(?:er)?>[\s\S]*?<\/system-remind(?:er)?>\s*/gi

export function cloneImageAttachments(images?: ImageAttachment[] | null): ImageAttachment[] {
  return (images ?? []).map((image) => ({ ...image }))
}

function normalizeImageMediaType(image: ImageBlock): string {
  return image.source.mediaType || 'image/png'
}

function stripSystemRemindersOnly(text: string): string {
  return text.replace(SYSTEM_REMINDER_PATTERN, '').trim()
}

function extractTextBlocks(content: string | ContentBlock[]): string[] {
  if (typeof content === 'string') {
    return [content]
  }

  if (!Array.isArray(content)) {
    return []
  }

  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
}

export function imageBlockToAttachment(image: ImageBlock): ImageAttachment | null {
  if (image.source.type === 'base64' && image.source.data) {
    const mediaType = normalizeImageMediaType(image)
    return {
      id: nanoid(),
      dataUrl: `data:${mediaType};base64,${image.source.data}`,
      mediaType,
      ...(image.source.filePath ? { filePath: image.source.filePath } : {})
    }
  }

  // S-224：落库时 base64 被剥掉、只剩 filePath。预览走 oc-media 协议，
  // 真正发给模型前由 `hydrateImageAttachmentsFromFilePaths` 读回字节。
  if (image.source.filePath) {
    return {
      id: nanoid(),
      dataUrl: filePathToMediaUrl(image.source.filePath),
      mediaType: normalizeImageMediaType(image),
      filePath: image.source.filePath
    }
  }

  if (image.source.type === 'url' && image.source.url) {
    const mediaType = normalizeImageMediaType(image)
    return {
      id: nanoid(),
      dataUrl: image.source.url,
      mediaType
    }
  }

  return null
}

export function imageAttachmentToContentBlock(image: ImageAttachment): ImageBlock {
  if (image.dataUrl.startsWith('data:')) {
    const [meta, data = ''] = image.dataUrl.split(',', 2)
    const matchedMediaType = /^data:([^;]+);base64$/i.exec(meta)?.[1]

    return {
      type: 'image',
      source: {
        type: 'base64',
        mediaType: image.mediaType || matchedMediaType || 'image/png',
        data
      }
    }
  }

  return {
    type: 'image',
    source: {
      type: 'url',
      mediaType: image.mediaType || 'image/png',
      url: image.dataUrl
    }
  }
}

export type ReadBinaryFileFn = (filePath: string) => Promise<{ data?: string; error?: string }>

/**
 * S-224：把只剩 `filePath` 的附件读回 base64。
 *
 * 落库剥掉 `data` 之后，历史消息「编辑重发」拿到的是 `oc-media://` 地址；
 * 主进程三处请求构建器只认 `source.data`，不读回来就整块丢图。
 * 读不回来的图直接丢弃（记一条 warn），不阻断发送。
 */
export async function hydrateImageAttachmentsFromFilePaths(
  images: ImageAttachment[],
  readBinary: ReadBinaryFileFn
): Promise<ImageAttachment[]> {
  const hydrated: ImageAttachment[] = []

  for (const image of images) {
    const needsHydrate = Boolean(image.filePath) && image.dataUrl.startsWith('oc-media://')
    if (!needsHydrate) {
      hydrated.push(image)
      continue
    }

    try {
      const result = await readBinary(image.filePath as string)
      if (!result?.data) {
        console.warn(
          '[image-attachments] 读回图片失败，已丢弃此图',
          result?.error ?? image.filePath
        )
        continue
      }
      hydrated.push({ ...image, dataUrl: `data:${image.mediaType};base64,${result.data}` })
    } catch (error) {
      console.warn('[image-attachments] 读回图片异常，已丢弃此图', error)
    }
  }

  return hydrated
}

export function stripSystemReminders(text: string): string {
  return text.replace(SYSTEM_REMINDER_PATTERN, '').trim()
}

export function normalizeEditableText(text: string): string {
  const withoutCommand = stripSystemCommandTag(text)
  const normalized = stripSystemReminders(withoutCommand).trim()
  return normalized === QUEUED_IMAGE_ONLY_TEXT ? '' : normalized
}

export function extractEditableCommand(
  content: string | ContentBlock[]
): SystemCommandSnapshot | null {
  const textBlocks = extractTextBlocks(content)

  for (const blockText of textBlocks) {
    const parsed = parseSystemCommandTag(blockText)
    if (parsed) {
      return parsed.command
    }
  }

  return null
}

export function extractEditableText(content: string | ContentBlock[]): string {
  const textBlocks = extractTextBlocks(content)
  const textParts: string[] = []
  let commandExtracted = false

  for (const blockText of textBlocks) {
    let normalized = blockText

    if (!commandExtracted) {
      const parsed = parseSystemCommandTag(normalized)
      if (parsed) {
        commandExtracted = true
        normalized = parsed.remainingText
      }
    }

    normalized = stripSystemRemindersOnly(normalized)
    if (!normalized) continue
    textParts.push(normalized)
  }

  const merged = textParts.join('\n').trim()
  return merged === QUEUED_IMAGE_ONLY_TEXT ? '' : merged
}

export function extractEditableImages(content: string | ContentBlock[]): ImageAttachment[] {
  if (typeof content === 'string' || !Array.isArray(content)) {
    return []
  }

  return content
    .filter((block): block is ImageBlock => block.type === 'image')
    .map(imageBlockToAttachment)
    .filter((image): image is ImageAttachment => Boolean(image))
}

export function extractEditableUserMessageDraft(
  content: string | ContentBlock[]
): EditableUserMessageDraft {
  return {
    text: extractEditableText(content),
    images: extractEditableImages(content),
    command: extractEditableCommand(content)
  }
}

export function isEditableUserMessage(message: UnifiedMessage): boolean {
  if (message.role !== 'user' || message.source === 'team') {
    return false
  }

  const draft = extractEditableUserMessageDraft(message.content)
  return hasEditableDraftContent(draft)
}

export function hasEditableDraftContent(
  draft: Pick<EditableUserMessageDraft, 'text' | 'images' | 'command'>
): boolean {
  return draft.text.trim().length > 0 || draft.images.length > 0 || Boolean(draft.command)
}

export function areImageAttachmentsEqual(
  left: ImageAttachment[],
  right: ImageAttachment[]
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftImage = left[index]
    const rightImage = right[index]
    if (
      leftImage.id !== rightImage.id ||
      leftImage.dataUrl !== rightImage.dataUrl ||
      leftImage.mediaType !== rightImage.mediaType ||
      // 必须比 filePath：同一张图「还没落盘 → 已落盘」是两次不同状态，
      // 若判为相等，调用方会跳过落盘，落库时就留下一个既没路径又有 base64 的块。
      leftImage.filePath !== rightImage.filePath
    ) {
      return false
    }
  }

  return true
}

function areSystemCommandsEqual(
  left: SystemCommandSnapshot | null,
  right: SystemCommandSnapshot | null
): boolean {
  if (left === right) return true
  if (!left || !right) return !left && !right
  return left.name === right.name && left.content === right.content
}

export function areEditableUserMessageDraftsEqual(
  left: EditableUserMessageDraft,
  right: EditableUserMessageDraft
): boolean {
  return (
    left.text === right.text &&
    areImageAttachmentsEqual(left.images, right.images) &&
    areSystemCommandsEqual(left.command, right.command)
  )
}

export function fileToImageAttachment(file: File): Promise<ImageAttachment | null> {
  return new Promise((resolve) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      resolve(null)
      return
    }

    if (file.size > MAX_IMAGE_SIZE) {
      resolve(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        id: nanoid(),
        dataUrl: reader.result as string,
        mediaType: file.type
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}
