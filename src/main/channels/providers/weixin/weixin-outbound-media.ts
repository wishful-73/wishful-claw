/**
 * 微信出站媒体 —— iLink `item_list`：图片走 `image_item`（type 2），文件走
 * `file_item`（type 4），附言走 `text_item`（type 1）同批发出。
 *
 * 与飞书同构：逻辑从 `channel-weixin-handlers.ts` 的两处调用点（IPC handler 与
 * `executeWeixinChannelTool`）收编上来 —— 那两处各自把「读源 → 发送」抄了一遍，
 * 是同一件事的两份实现。
 *
 * ⚠️ 微信协议的 `item_list` 是开放结构（`weixin-api.ts:209` 收的是
 * `Array<Record<string, unknown>>`，只有运行时校验），**类型系统管不住 item 内部**。
 * 这是 iLink 协议的现状，不是这里的疏忽 —— 改 item 结构前必须真机验一遍。
 */

import type { WeixinApi } from './weixin-api'
import type { ChannelMediaKind, ChannelMediaPayload } from '../../channel-types'
import { readBinarySource } from '../../channel-media-source'

/**
 * 微信能发出去的形态。
 *
 * `audio` 暂不声明。**入站侧**已经确定语音是 `type: 3` + `voice_item`（
 * `weixin-service.ts:29 VOICE_ITEM`，`extractContent` 从 `voice_item.text` 取转写文本），
 * 但**出站**的 `voice_item` 结构（要不要 media 加密块、要不要时长、要不要转写文本一起发）
 * **从未验过**。验完再加，不猜。
 */
export const WEIXIN_SUPPORTED_MEDIA_KINDS: readonly ChannelMediaKind[] = ['image', 'file']

/**
 * 读源 + 发送。`media.source` 支持本地绝对路径与 http(s) URL。
 *
 * `contextToken` 由调用方从 `WeixinService.getContextTokenForChat()` 取 —— 那是
 * private，且带「配置优先、内存兜底」的回落逻辑，不在这里重抄一遍。
 */
export async function sendWeixinMedia(
  api: WeixinApi,
  chatId: string,
  contextToken: string,
  media: ChannelMediaPayload
): Promise<{ messageId: string }> {
  if (media.kind === 'image') {
    const { buffer } = await readBinarySource(media.source, 'image.png')
    return await api.sendImage({
      toUserId: chatId,
      buffer,
      text: media.caption,
      contextToken
    })
  }

  if (media.kind === 'file') {
    const { buffer, fileName } = await readBinarySource(media.source, 'file')
    return await api.sendFile({
      toUserId: chatId,
      buffer,
      fileName: media.fileName ?? fileName,
      text: media.caption,
      contextToken
    })
  }

  // 走到这里说明 supportedMediaKinds 与实际实现不一致 —— 属于编程错误，不是运行时状况
  throw new Error(`Weixin does not support outbound media kind: ${media.kind}`)
}
