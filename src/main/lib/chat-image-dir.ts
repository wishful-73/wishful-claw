/**
 * 聊天图片的落盘目录与命名（S-224）。
 *
 * 目录：`{dataRoot}/images/{yyyy-MM}/{sha256 前 16 位}.{ext}`
 *
 * 纯函数、零 electron 依赖：命名规则要被 node 单测直接覆盖，不能被 `data-dir`
 * 那条 electron 依赖拖死。
 */

import { createHash } from 'crypto'
import { join } from 'path'
import { guessExtensionFromMimeType } from './image-extension'

export const CHAT_IMAGES_SUBDIR = 'images'

/**
 * 本地时间的 `yyyy-MM`。用 UTC 会在月初/月末把图分到错误的月份，
 * 用户是按「几月存的」翻目录的。
 */
export function formatChatImageMonth(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * 文件名 = 内容 sha256 前 16 位 + 按 mime 推的扩展名。
 *
 * 对**解码后的字节**求哈希，不是对 base64 文本 —— 同一张图无论从上传、
 * 渠道转发还是工具产物进来，字节相同就得到同一个名字，重复发送天然去重。
 *
 * 调用方已经拿到 Buffer 时用 `chatImageFileNameFromBuffer`，省一次解码。
 */
export function chatImageFileName(base64: string, mediaType?: string): string {
  return chatImageFileNameFromBuffer(Buffer.from(base64, 'base64'), mediaType)
}

export function chatImageFileNameFromBuffer(buffer: Buffer, mediaType?: string): string {
  const digest = createHash('sha256').update(buffer).digest('hex')
  return `${digest.slice(0, 16)}${guessExtensionFromMimeType(mediaType)}`
}

export function resolveChatImageDir(dataRoot: string, date: Date): string {
  return join(dataRoot, CHAT_IMAGES_SUBDIR, formatChatImageMonth(date))
}
