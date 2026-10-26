/**
 * `oc-media://` 解析与白名单（S-224）。
 *
 * 与渲染端 `src/renderer/src/lib/local-media-url.ts` 成对：那边
 * `encodeURIComponent(filePath)` 拼成 `oc-media://local/<encoded>`，这边解码还原。
 *
 * 纯函数、零 electron 依赖 —— 协议注册在 `src/main/local-media-protocol.ts`，
 * 拆开是为了让这里的解析规则能被 node 单测直接覆盖。
 */

import { extname, isAbsolute } from 'path'

export const LOCAL_MEDIA_SCHEME = 'oc-media'
export const LOCAL_MEDIA_HOST = 'local'

/**
 * 允许经协议读取的扩展名。
 *
 * 该协议对渲染端开放了「按路径读任意文件」的能力，不设白名单等于给页面一个
 * 无限制的文件读取通道。只放媒体类型够用（调用方只有图片/视频显示）。
 */
export const ALLOWED_MEDIA_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.avi',
  '.ogv',
  '.m4v'
]

/**
 * 从 `oc-media://local/<encoded>` 还原出磁盘路径。
 * 协议名、host、空路径、解码失败任一不符即返回 `null`。
 */
export function parseMediaUrlPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== `${LOCAL_MEDIA_SCHEME}:`) return null
  if (parsed.hostname !== LOCAL_MEDIA_HOST) return null

  const encoded = parsed.pathname.replace(/^\/+/, '')
  if (!encoded) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return null
  }

  if (!decoded.trim()) return null

  // 只接受绝对路径：相对路径会按主进程 cwd 解析，语义不可预期。
  if (!isAbsolute(decoded)) return null
  // 拒绝 UNC（`\\server\share\a.png` 与 `//server/share/a.png`）：Windows 上会触发
  // SMB 连接，远端可以借此把主进程挂住。
  if (decoded.startsWith('\\\\') || decoded.startsWith('//')) return null
  // 拒绝 `..` 段：协议只负责读一个具体文件，没有穿目录的需求。
  if (decoded.split(/[\\/]/).includes('..')) return null

  return decoded
}

export function isAllowedMediaPath(filePath: string): boolean {
  return ALLOWED_MEDIA_EXTENSIONS.includes(extname(filePath).toLowerCase())
}

/** 兜底读盘时用的 Content-Type；不在表里的按二进制流给。 */
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.m4v': 'video/x-m4v'
}

export function guessMediaTypeFromPath(filePath: string): string {
  return EXTENSION_MEDIA_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
