export const DEFAULT_WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const DEFAULT_WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

/**
 * `getuploadurl` 的 `media_type` 枚举。
 *
 * ⚠️ 跟消息 `item_list[].type` 是**两套编号**（那边 TEXT 1 / IMAGE 2 / VOICE 3 /
 * FILE 4 / VIDEO 5），混用会传上去但微信侧认不出。
 */
export const WeixinUploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4
} as const

/** 语音 `voice_item.encode_type` 枚举，值与官方 iLink Bot SDK 一致 */
export const WeixinVoiceEncodeType = {
  PCM: 1,
  ADPCM: 2,
  FEATURE: 3,
  SPEEX: 4,
  AMR: 5,
  SILK: 6,
  MP3: 7,
  OGG_SPEEX: 8
} as const

export interface WeixinCdnMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
  [key: string]: unknown
}

export interface WeixinImageItem {
  file_id?: string
  file_name?: string
  md5sum?: string
  aes_key?: string
  aeskey?: string
  media?: WeixinCdnMedia
  thumb_media?: WeixinCdnMedia
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
  width?: number
  height?: number
  [key: string]: unknown
}

export interface WeixinMessageItem {
  type?: number
  text_item?: { text?: string }
  voice_item?: {
    text?: string
    media?: WeixinCdnMedia
    encode_type?: number
    sample_rate?: number
    bits_per_sample?: number
    playtime?: number
  }
  image_item?: WeixinImageItem
  file_item?: { file_name?: string }
  video_item?: unknown
}

export interface WeixinInboundMessage {
  seq?: number
  message_id?: number
  client_id?: string
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  message_type?: number
  message_state?: number
  item_list?: WeixinMessageItem[]
  context_token?: string
}

export interface GetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinInboundMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

/** `ilink/bot/getconfig` 响应 —— typing 的唯一取票途径（S-152）。 */
export interface WeixinGetConfigResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  typing_ticket?: string
}

export interface WeixinGetUploadUrlResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  upload_param?: string
  thumb_upload_param?: string
  upload_full_url?: string
  data?: WeixinGetUploadUrlResponse
}

export interface WeixinUploadedFileInfo {
  fileKey: string
  downloadEncryptedQueryParam: string
  aesKeyHex: string
  fileSize: number
  fileSizeCiphertext: number
}
