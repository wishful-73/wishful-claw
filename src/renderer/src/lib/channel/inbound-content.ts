// 渠道入站消息 → `sendMessage` 的 content（iter-40 S-211）。
//
// 上游微信 / 飞书早就把入站图片下载成 base64 放在 `images` 上，可渲染端这一步
// 只把占位符字符串交给 sendMessage —— `task.images` 从来没被读过，于是模型只看到
// 一句 `[User sent an image]`，图片本身在边界上没了。这里把它拼成与聊天窗同构的
// 块数组，模型 / 落库 / 渲染三侧都走既有链路，不新造任何东西。
//
// 纯函数、不 import IPC：node 侧测试直接钉行为。

import type { ContentBlock } from '@renderer/lib/api/types'

/** 渠道服务层带上来的单张入站图片（微信 / 飞书形状一致）。 */
export interface InboundImage {
  base64: string
  mediaType?: string
}

/** `mediaType` 缺失时的兜底 —— 与服务层默认一致。 */
const FALLBACK_MEDIA_TYPE = 'image/png'

function usableImages(images?: ReadonlyArray<InboundImage> | null): InboundImage[] {
  if (!images?.length) return []
  return images.filter(
    (image): image is InboundImage =>
      typeof image?.base64 === 'string' && image.base64.length > 0
  )
}

/**
 * - 没有可用图片 ⇒ **原样返回字符串**，与改动用之前的行为逐字节一致；
 * - 有图片 ⇒ `[text?, image, image…]`，纯图片消息不补空 text 块（与聊天窗一致）。
 */
export function buildInboundUserContent(
  text: string,
  images?: ReadonlyArray<InboundImage> | null
): string | ContentBlock[] {
  const usable = usableImages(images)
  if (usable.length === 0) return text

  const blocks: ContentBlock[] = []
  if (typeof text === 'string' && text.trim().length > 0) {
    blocks.push({ type: 'text', text })
  }
  for (const image of usable) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        mediaType: image.mediaType?.trim() || FALLBACK_MEDIA_TYPE,
        data: image.base64
      }
    })
  }
  return blocks
}
