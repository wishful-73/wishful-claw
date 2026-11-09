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
import { WeixinVoiceEncodeType } from './weixin-types'
import type { ChannelMediaKind, ChannelMediaPayload } from '../../channel-types'
import { readBinarySource } from '../../channel-media-source'

/**
 * 按文件名后缀推 `voice_item.encode_type`。
 *
 * 微信原生语音是 silk，但插件给的更可能是 opus / mp3。默认一律 silk 会让微信侧
 * 解不出声（上传照样成功），所以按后缀走。认不出的后缀回落 silk —— 那是协议基准格式。
 *
 * ⚠️ `opus` 映射到 `OGG_SPEEX`：官方枚举里没有独立的 opus 项，最接近的就是它。
 * 若真机上 opus 播不出来，先来改这一行。
 */
function inferVoiceEncodeType(fileName: string): number {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  switch (ext) {
    case 'silk':
      return WeixinVoiceEncodeType.SILK
    case 'amr':
      return WeixinVoiceEncodeType.AMR
    case 'mp3':
      return WeixinVoiceEncodeType.MP3
    case 'speex':
      return WeixinVoiceEncodeType.SPEEX
    case 'pcm':
    case 'wav':
      return WeixinVoiceEncodeType.PCM
    case 'ogg':
    case 'opus':
      return WeixinVoiceEncodeType.OGG_SPEEX
    default:
      return WeixinVoiceEncodeType.SILK
  }
}

/**
 * 微信能发出去的形态。
 *
 * 三种结构的字段（含 `audio` 的 `voice_item`）均已按官方 iLink Bot SDK 核对，
 * 不再是「图片同构推断」。协议要点见 `weixin-api.ts:sendVoice` 的方法注释。
 *
 * ⚠️ 仍未经真机验证：代码路径正确不等于微信侧一定收得下，首次实测要盯住
 * `encode_type` 与实际音频格式是否匹配（silk / mp3 / amr 各不相同）。
 */
export const WEIXIN_SUPPORTED_MEDIA_KINDS: readonly ChannelMediaKind[] = [
  'image',
  'file',
  'audio'
]

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

  if (media.kind === 'audio') {
    const { buffer, fileName } = await readBinarySource(media.source, 'audio.silk')
    return await api.sendVoice({
      toUserId: chatId,
      buffer,
      encodeType: inferVoiceEncodeType(media.fileName ?? fileName),
      playtime: media.durationMs,
      text: media.caption,
      contextToken
    })
  }

  // 走到这里说明 supportedMediaKinds 与实际实现不一致 —— 属于编程错误，不是运行时状况
  throw new Error(`Weixin does not support outbound media kind: ${media.kind}`)
}
