import { createHash, randomBytes } from 'crypto'
import {
  DEFAULT_WEIXIN_CDN_BASE_URL,
  type GetUpdatesResponse,
  type WeixinCdnMedia,
  type WeixinGetConfigResponse,
  type WeixinGetUploadUrlResponse,
  type WeixinUploadedFileInfo
} from './weixin-types'
import {
  parseAesKey,
  decryptAesEcb,
  sniffImageMediaType,
  detectImageMediaType,
  aesEcbPaddedSize,
  buildCdnDownloadUrl,
  encodeOutboundMediaAesKey
} from './weixin-crypto'
import {
  buildXWechatUin,
  postJson,
  postBinary,
  fetchBinary,
  uploadBufferToCdn,
  normalizeUploadUrlResponse
} from './weixin-http'

// Re-export types for backward compatibility
export {
  DEFAULT_WEIXIN_BASE_URL,
  DEFAULT_WEIXIN_CDN_BASE_URL,
  type WeixinCdnMedia,
  type WeixinImageItem,
  type WeixinMessageItem,
  type WeixinInboundMessage,
  type GetUpdatesResponse
} from './weixin-types'

export class WeixinApi {
  private readonly wechatUin: string

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly routeTag?: string
  ) {
    this.wechatUin = buildXWechatUin()
  }

  async getUpdates(
    syncBuf: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<GetUpdatesResponse> {
    return postJson<GetUpdatesResponse>({
      baseUrl: this.baseUrl,
      path: 'ilink/bot/getupdates',
      body: { get_updates_buf: syncBuf || '' },
      token: this.token,
      routeTag: this.routeTag,
      wechatUin: this.wechatUin,
      timeoutMs,
      signal
    })
  }

  /**
   * `ilink/bot/getconfig` —— 换 `typing_ticket`。
   * typing 不能直接调 sendtyping，必须先拿票；票不缓存，每条消息重新取。
   */
  async getConfig(params: {
    toUserId: string
    contextToken: string
    signal?: AbortSignal
  }): Promise<WeixinGetConfigResponse> {
    return postJson<WeixinGetConfigResponse>({
      baseUrl: this.baseUrl,
      path: 'ilink/bot/getconfig',
      body: {
        ilink_user_id: params.toUserId,
        context_token: params.contextToken
      },
      token: this.token,
      routeTag: this.routeTag,
      wechatUin: this.wechatUin,
      timeoutMs: 20000,
      signal: params.signal
    })
  }

  /** `ilink/bot/sendtyping` —— status: 1 = 开始输入，2 = 取消。 */
  async sendTyping(params: {
    toUserId: string
    typingTicket: string
    status: number
    signal?: AbortSignal
  }): Promise<void> {
    const response = await postJson<{ ret?: number; errcode?: number; errmsg?: string }>({
      baseUrl: this.baseUrl,
      path: 'ilink/bot/sendtyping',
      body: {
        ilink_user_id: params.toUserId,
        typing_ticket: params.typingTicket,
        status: params.status
      },
      token: this.token,
      routeTag: this.routeTag,
      wechatUin: this.wechatUin,
      timeoutMs: 20000,
      signal: params.signal
    })

    const errcode = response.errcode ?? response.ret ?? 0
    if (errcode !== 0) {
      throw new Error(`Weixin sendtyping failed: ${response.errmsg || `errcode ${errcode}`}`)
    }
  }

  private async getUploadUrl(params: {
    fileKey: string
    toUserId: string
    rawSize: number
    rawFileMd5: string
    fileSize: number
    aesKeyHex: string
    mediaType: number
    signal?: AbortSignal
  }): Promise<WeixinGetUploadUrlResponse> {
    const response = await postJson<WeixinGetUploadUrlResponse>({
      baseUrl: this.baseUrl,
      path: 'ilink/bot/getuploadurl',
      body: {
        filekey: params.fileKey,
        media_type: params.mediaType,
        to_user_id: params.toUserId,
        rawsize: params.rawSize,
        rawfilemd5: params.rawFileMd5,
        filesize: params.fileSize,
        no_need_thumb: true,
        aeskey: params.aesKeyHex,
        base_info: {
          channel_version: '1.0.0'
        }
      },
      token: this.token,
      routeTag: this.routeTag,
      wechatUin: this.wechatUin,
      timeoutMs: 20000,
      signal: params.signal
    })
    return normalizeUploadUrlResponse(response)
  }

  private async uploadMedia(params: {
    toUserId: string
    buffer: Buffer
    mediaType: number
    cdnBaseUrl?: string
    signal?: AbortSignal
  }): Promise<WeixinUploadedFileInfo> {
    const fileKey = randomBytes(16).toString('hex')
    const aesKey = randomBytes(16)
    const rawSize = params.buffer.length
    const rawFileMd5 = createHash('md5').update(params.buffer).digest('hex')
    const fileSize = aesEcbPaddedSize(rawSize)
    const aesKeyHex = aesKey.toString('hex')
    const uploadUrl = await this.getUploadUrl({
      fileKey,
      toUserId: params.toUserId,
      rawSize,
      rawFileMd5,
      fileSize,
      aesKeyHex,
      mediaType: params.mediaType,
      signal: params.signal
    })

    const uploadParam = uploadUrl.upload_param?.trim()
    const uploadFullUrl = uploadUrl.upload_full_url?.trim()
    const errcode = uploadUrl.errcode ?? uploadUrl.ret ?? 0
    if (errcode !== 0) {
      throw new Error(
        `Weixin getuploadurl failed: ${uploadUrl.errmsg || `errcode ${errcode}`}`
      )
    }
    if (!uploadParam && !uploadFullUrl) {
      throw new Error('Weixin getuploadurl returned no upload_param or upload_full_url')
    }

    const downloadEncryptedQueryParam = await uploadBufferToCdn({
      buffer: params.buffer,
      uploadParam,
      uploadFullUrl,
      fileKey,
      cdnBaseUrl: params.cdnBaseUrl || DEFAULT_WEIXIN_CDN_BASE_URL,
      aesKey,
      signal: params.signal
    })

    return {
      fileKey,
      downloadEncryptedQueryParam,
      aesKeyHex,
      fileSize: rawSize,
      fileSizeCiphertext: fileSize
    }
  }

  private async sendItems(params: {
    toUserId: string
    contextToken: string
    items: Array<Record<string, unknown>>
    signal?: AbortSignal
  }): Promise<{ messageId: string }> {
    let clientId = ''

    for (const item of params.items) {
      clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      await postJson({
        baseUrl: this.baseUrl,
        path: 'ilink/bot/sendmessage',
        body: {
          msg: {
            from_user_id: '',
            to_user_id: params.toUserId,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            item_list: [item],
            context_token: params.contextToken
          }
        },
        token: this.token,
        routeTag: this.routeTag,
        wechatUin: this.wechatUin,
        timeoutMs: 20000,
        signal: params.signal
      })
    }

    return { messageId: clientId }
  }

  async downloadMessageImage(params: {
    messageId: number | string
    fileId: string
    aesKey?: string
    md5sum?: string
    fileName?: string
    signal?: AbortSignal
  }): Promise<{ buffer: Buffer; mediaType: string }> {
    return postBinary({
      baseUrl: this.baseUrl,
      path: 'ilink/bot/downloadmessageimage',
      body: {
        message_id: params.messageId,
        file_id: params.fileId,
        aes_key: params.aesKey || '',
        md5sum: params.md5sum || '',
        file_name: params.fileName || ''
      },
      token: this.token,
      routeTag: this.routeTag,
      wechatUin: this.wechatUin,
      timeoutMs: 20000,
      signal: params.signal
    })
  }

  async downloadInboundImage(params: {
    messageId: number | string
    fileId?: string
    aesKey?: string
    rawAesKeyHex?: string
    md5sum?: string
    fileName?: string
    media?: WeixinCdnMedia
    thumbMedia?: WeixinCdnMedia
    cdnBaseUrl?: string
    signal?: AbortSignal
  }): Promise<{ buffer: Buffer; mediaType: string }> {
    const media = params.media?.encrypt_query_param
      ? params.media
      : params.thumbMedia?.encrypt_query_param
        ? params.thumbMedia
        : undefined

    if (media?.encrypt_query_param) {
      const hexAesKey = params.rawAesKeyHex?.trim()
      if (hexAesKey && !/^[0-9a-fA-F]{32}$/.test(hexAesKey)) {
        throw new Error('Invalid Weixin image aeskey format')
      }
      const aesKeyBase64 = hexAesKey
        ? Buffer.from(hexAesKey, 'hex').toString('base64')
        : media.aes_key || params.aesKey || ''
      const download = await fetchBinary(
        buildCdnDownloadUrl(
          params.cdnBaseUrl || DEFAULT_WEIXIN_CDN_BASE_URL,
          media.encrypt_query_param
        ),
        20000,
        params.signal
      )
      const buffer = aesKeyBase64
        ? decryptAesEcb(download.buffer, parseAesKey(aesKeyBase64))
        : download.buffer
      return {
        buffer,
        mediaType: detectImageMediaType(buffer, download.mediaType)
      }
    }

    if (params.fileId) {
      return this.downloadMessageImage({
        messageId: params.messageId,
        fileId: params.fileId,
        aesKey: params.aesKey,
        md5sum: params.md5sum,
        fileName: params.fileName,
        signal: params.signal
      })
    }

    throw new Error('Missing Weixin inbound image reference')
  }

  async sendMessage(params: {
    toUserId: string
    text: string
    contextToken: string
    signal?: AbortSignal
  }): Promise<{ messageId: string }> {
    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items: [
        {
          type: 1,
          text_item: { text: params.text }
        }
      ],
      signal: params.signal
    })
  }

  async sendImage(params: {
    toUserId: string
    contextToken: string
    buffer: Buffer
    text?: string
    cdnBaseUrl?: string
    signal?: AbortSignal
  }): Promise<{ messageId: string }> {
    if (!sniffImageMediaType(params.buffer)) {
      throw new Error('The provided payload is not a supported image file')
    }

    const uploaded = await this.uploadMedia({
      toUserId: params.toUserId,
      buffer: params.buffer,
      mediaType: 1,
      cdnBaseUrl: params.cdnBaseUrl,
      signal: params.signal
    })

    const items: Array<Record<string, unknown>> = []
    if (params.text) {
      items.push({
        type: 1,
        text_item: { text: params.text }
      })
    }
    items.push({
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: encodeOutboundMediaAesKey(uploaded.aesKeyHex),
          encrypt_type: 1
        },
        mid_size: uploaded.fileSizeCiphertext
      }
    })

    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items,
      signal: params.signal
    })
  }

  async sendFile(params: {
    toUserId: string
    contextToken: string
    buffer: Buffer
    fileName: string
    text?: string
    cdnBaseUrl?: string
    signal?: AbortSignal
  }): Promise<{ messageId: string }> {
    const uploaded = await this.uploadMedia({
      toUserId: params.toUserId,
      buffer: params.buffer,
      mediaType: 3,
      cdnBaseUrl: params.cdnBaseUrl,
      signal: params.signal
    })

    const items: Array<Record<string, unknown>> = []
    if (params.text) {
      items.push({
        type: 1,
        text_item: { text: params.text }
      })
    }
    items.push({
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: encodeOutboundMediaAesKey(uploaded.aesKeyHex),
          encrypt_type: 1
        },
        file_name: params.fileName,
        len: String(uploaded.fileSize)
      }
    })

    return this.sendItems({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      items,
      signal: params.signal
    })
  }
}
