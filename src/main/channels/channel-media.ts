/**
 * 出站媒体的统一入口 —— 带降级。
 *
 * 为什么需要这一层：各渠道对媒体的支持度天差地别（飞书能发图和文件、微信能发图、
 * 其余只能发文本，而且同一个渠道的「能不能发语音」还要看平台限制）。如果让调用方
 * （自动回复、插件、agent 工具）自己去查 `supportedMediaKinds` 再分支，等于把底座
 * 的活推给了每一处调用点 —— 七个渠道就会长出七份判断。
 *
 * 所以：调用方只管说「我想发这个」，`sendMediaOrText` 替它决定发媒体还是退回文本。
 *
 * 降级行为是老大 2026-11-09 10:46 定的原话：「发不了就只能退避发文字呗」——
 * 不抛错、不静默丢弃、不弹窗。
 */

import type {
  ChannelMediaKind,
  ChannelMediaPayload,
  MessagingChannelService
} from './channel-types'

/** 一次出站的结果 —— `sentAs` 交代实际发生了什么，调用方可据此记日志 */
export interface ChannelSendResult {
  messageId: string
  /** 实际发出去的形态。`'text'` 表示媒体不支持，已降级 */
  sentAs: ChannelMediaKind | 'text'
}

/**
 * 本渠道能否发这种媒体。
 *
 * 两个条件都要满足：声明了 `supportedMediaKinds` 且含该形态、实现了 `sendMedia`。
 * 只声明不实现的渠道按不支持处理 —— 宁可降级，也不要在运行时炸。
 */
export function supportsMediaKind(
  service: MessagingChannelService,
  kind: ChannelMediaKind
): boolean {
  if (!service.sendMedia) return false
  const kinds = service.supportedMediaKinds
  return Array.isArray(kinds) && kinds.includes(kind)
}

/**
 * 统一出站入口：支持就发媒体，不支持退回文本。
 *
 * @param fallbackText 降级时发出去的文本。**必须是有意义的内容** —— 降级的目的是
 *   「用户好歹知道发生了什么」，不是发一句占位符。
 */
export async function sendMediaOrText(
  service: MessagingChannelService,
  chatId: string,
  media: ChannelMediaPayload,
  fallbackText: string
): Promise<ChannelSendResult> {
  const sendMedia = service.sendMedia
  if (sendMedia && supportsMediaKind(service, media.kind)) {
    const { messageId } = await sendMedia(chatId, media)
    return { messageId, sentAs: media.kind }
  }

  const { messageId } = await service.sendMessage(chatId, fallbackText)
  return { messageId, sentAs: 'text' }
}
