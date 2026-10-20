/**
 * QQ 入站媒体下载。
 *
 * QQ 官方机器人的附件地址是带时效签名的直链，解析层只负责把地址带出来（`mediaRefs`），
 * 真正的下载放在这里、由 `qq-service` 在 emit 之前调用：URL 过期了就再也拿不到。
 *
 * 失败一律降级成「占位符 + download failed」，绝不因为一张图让整条消息丢掉。
 */

import type { ChannelIncomingMessageData } from '../../channel-types'

type InboundImage = NonNullable<ChannelIncomingMessageData['images']>[number]
type MediaRef = NonNullable<ChannelIncomingMessageData['mediaRefs']>[number]

/** 单张图上限：base64 膨胀 4/3，再大就会撑爆 WS 与 DB（与 S-211 §七 同一笔账） */
export const QQ_MAX_IMAGE_BYTES = 10 * 1024 * 1024

const DOWNLOAD_TIMEOUT_MS = 15_000

/**
 * 地址规整：QQ 有时给 `//host/path` 这种协议相对地址，补上 https。
 * 只放行 http/https，并且拒绝环回 / 内网地址 —— 地址来自外部事件，不能当可信输入用。
 */
export function normalizeQQMediaUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null

  let candidate = raw.trim()
  if (!candidate) return null
  if (candidate.startsWith('//')) candidate = `https:${candidate}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (isBlockedHost(parsed.hostname)) return null

  return parsed.toString()
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0.0.0.0') return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }

  return false
}

/** 按魔数嗅探图片类型：`content_type` 缺失或给错时兜底 */
export function sniffImageMediaType(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif'
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'

  return null
}

/** 声明的类型能用就用，用不了按字节嗅探，再不行给 image/png（下游本来也这么兜底） */
export function resolveImageMediaType(declared: string | undefined, buffer: Uint8Array): string {
  const normalized = typeof declared === 'string' ? declared.trim().toLowerCase() : ''
  if (normalized.startsWith('image/')) return normalized
  return sniffImageMediaType(buffer) ?? 'image/png'
}

export interface DownloadedImage {
  image: InboundImage
  fileName?: string
}

export interface DownloadImageResult {
  images: InboundImage[]
  /** 下载失败的张数与原因，调用方据此改写 content 文案 */
  failures: string[]
}

/**
 * 逐张下载。一张失败不影响其它张，也不抛异常。
 * 调用方拿 `failures.length` 决定是否把占位符改成 `download failed`。
 */
export async function downloadQQImageRefs(refs: MediaRef[] | undefined): Promise<DownloadImageResult> {
  if (!refs || refs.length === 0) return { images: [], failures: [] }

  const images: InboundImage[] = []
  const failures: string[] = []

  for (const ref of refs) {
    const url = normalizeQQMediaUrl(ref.url)
    if (!url) {
      failures.push(`${ref.fileName || 'attachment'}: unsupported url`)
      continue
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      })

      if (!response.ok) {
        failures.push(`${ref.fileName || 'attachment'}: HTTP ${response.status}`)
        continue
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '')
      if (Number.isFinite(declaredLength) && declaredLength > QQ_MAX_IMAGE_BYTES) {
        failures.push(`${ref.fileName || 'attachment'}: too large (${declaredLength} bytes)`)
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength === 0) {
        failures.push(`${ref.fileName || 'attachment'}: empty body`)
        continue
      }
      if (buffer.byteLength > QQ_MAX_IMAGE_BYTES) {
        failures.push(`${ref.fileName || 'attachment'}: too large (${buffer.byteLength} bytes)`)
        continue
      }

      const mediaType = resolveImageMediaType(ref.contentType ?? response.headers.get('content-type') ?? undefined, buffer)
      images.push({ base64: buffer.toString('base64'), mediaType })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${ref.fileName || 'attachment'}: ${message}`)
    }
  }

  return { images, failures }
}
