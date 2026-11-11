/**
 * 飞书出站媒体 —— 图片走 image_key，文件走 file_key。
 *
 * 抽成独立文件而不是塞进 `feishu-service.ts`：那个文件 493 行，贴着 500 行硬上限。
 *
 * 这里的逻辑是从 `channel-feishu-handlers.ts` 的两处调用点（IPC handler 与
 * `executeFeishuChannelTool`）收编上来的 —— 那两处各自把「读源 → 上传 → 发送」
 * 抄了一遍，是同一件事的两份实现。
 */

import * as path from 'path'
import type { FeishuApi } from './feishu-api'
import type { ChannelMediaKind, ChannelMediaPayload } from '../../channel-types'
import { readBinarySource, resolveSourceFileName } from '../../channel-media-source'

/**
 * 飞书能发出去的形态。
 *
 * `audio` 走 `msg_type: 'audio'` + `uploadFile(..., 'opus')` —— 飞书只认 **opus**，
 * 且时长有上限（官方建议 60s 内）。喂别的格式会在 upload 阶段就被拒（`file_type:
 * 'opus'` 但内容不是 opus），错误信息是飞书侧的，不会静默变成文件消息。
 */
export const FEISHU_SUPPORTED_MEDIA_KINDS: readonly ChannelMediaKind[] = [
  'image',
  'file',
  'audio'
]

type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream'

/** 飞书要求的 file_type，按扩展名映射（与原 IPC handler 里的 typeMap 一致） */
const EXT_TO_FILE_TYPE: Record<string, FeishuFileType> = {
  opus: 'opus',
  mp4: 'mp4',
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  xls: 'xls',
  xlsx: 'xls',
  ppt: 'ppt',
  pptx: 'ppt'
}

function resolveFileType(fileName: string): FeishuFileType {
  const ext = path.extname(fileName).toLowerCase().replace('.', '')
  return EXT_TO_FILE_TYPE[ext] ?? 'stream'
}

/** 读源 + 上传 + 发送。`media.source` 支持本地绝对路径与 http(s) URL */
export async function sendFeishuMedia(
  api: FeishuApi,
  chatId: string,
  media: ChannelMediaPayload
): Promise<{ messageId: string }> {
  if (media.kind === 'image') {
    const fallback = 'image.png'
    const { buffer } = await readBinarySource(media.source, fallback)
    const fileName = media.fileName ?? resolveSourceFileName(media.source, fallback)
    const imageKey = await api.media.uploadImage(buffer, fileName)
    return await api.media.sendImageMessage(chatId, imageKey)
  }

  if (media.kind === 'file') {
    const fallback = 'file'
    const { buffer } = await readBinarySource(media.source, fallback)
    const fileName = media.fileName ?? resolveSourceFileName(media.source, fallback)
    const fileKey = await api.media.uploadFile(buffer, fileName, resolveFileType(fileName))
    return await api.media.sendFileMessage(chatId, fileKey)
  }

  if (media.kind === 'audio') {
    // 飞书语音只收 opus。这里**既不转格式、也不强制改扩展名** —— 传 `.mp3` 就会变成
    // `uploadFile(buf, 'x.mp3', 'opus')`，飞书自己拒。故意让它炸得清楚：错误信息是
    // 飞书侧的，比「把 mp3 悄悄贴上 .opus 标签发出去、对方播不出来」好查。
    // `'audio.opus'` 只是推断不出文件名时的兜底，不是强制后缀。
    const { buffer } = await readBinarySource(media.source, 'audio.opus')
    const fileName = media.fileName ?? resolveSourceFileName(media.source, 'audio.opus')
    const fileKey = await api.media.uploadFile(buffer, fileName, 'opus')
    return await api.media.sendAudioMessage(chatId, fileKey)
  }

  // 走到这里说明 supportedMediaKinds 与实际实现不一致 —— 属于编程错误，不是运行时状况
  throw new Error(`Feishu does not support outbound media kind: ${media.kind}`)
}
