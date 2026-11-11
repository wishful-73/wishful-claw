import * as https from 'https'
import { request, BASE_URL } from './feishu-http'
import type { AuthHeadersProvider } from './feishu-bitable-api'

/** Token provider — returns the current tenant access token */
export type TokenProvider = () => Promise<string>

/**
 * Feishu media (image/file) API client.
 * Extracted from FeishuApi for single-responsibility.
 */
export class FeishuMediaApi {
  constructor(
    private authHeaders: AuthHeadersProvider,
    private ensureToken: TokenProvider
  ) {}

  /** Download a message resource (image/file) by message_id and file_key */
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file' = 'image'
  ): Promise<Buffer> {
    const token = await this.ensureToken()
    return new Promise((resolve, reject) => {
      const url = new URL(
        `/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`,
        BASE_URL
      )
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            const buf = Buffer.concat(chunks)
            if (res.statusCode !== 200) {
              reject(new Error(`Download resource failed: HTTP ${res.statusCode}`))
              return
            }
            resolve(buf)
          })
        }
      )
      req.on('error', reject)
      req.setTimeout(30000, () => {
        req.destroy()
        reject(new Error('Download resource timed out (30s)'))
      })
      req.end()
    })
  }

  /** Upload an image to Feishu and get an image_key */
  async uploadImage(imageBuffer: Buffer, fileName = 'image.png'): Promise<string> {
    const token = await this.ensureToken()
    const boundary = `----FormBoundary${Date.now()}`

    const parts: Buffer[] = []
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\nmessage\r\n`
      )
    )
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    )
    parts.push(imageBuffer)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    return new Promise((resolve, reject) => {
      const url = new URL('/open-apis/im/v1/images', BASE_URL)
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.byteLength)
          }
        },
        (res) => {
          let responseBody = ''
          res.on('data', (chunk: Buffer) => {
            responseBody += chunk.toString()
          })
          res.on('end', () => {
            try {
              const data = JSON.parse(responseBody)
              if (data.code !== 0) {
                reject(new Error(`Upload image failed: ${data.msg}`))
                return
              }
              resolve(data.data?.image_key ?? '')
            } catch {
              reject(new Error(`Upload image parse error: ${responseBody.slice(0, 200)}`))
            }
          })
        }
      )
      req.on('error', reject)
      req.setTimeout(30000, () => {
        req.destroy()
        reject(new Error('Upload image timed out (30s)'))
      })
      req.write(body)
      req.end()
    })
  }

  /** Upload a file to Feishu and get a file_key */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    fileType: 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' = 'stream'
  ): Promise<string> {
    const token = await this.ensureToken()
    const boundary = `----FormBoundary${Date.now()}`

    const parts: Buffer[] = []
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file_type"\r\n\r\n${fileType}\r\n`
      )
    )
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${fileName}\r\n`
      )
    )
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    )
    parts.push(fileBuffer)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    return new Promise((resolve, reject) => {
      const url = new URL('/open-apis/im/v1/files', BASE_URL)
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.byteLength)
          }
        },
        (res) => {
          let responseBody = ''
          res.on('data', (chunk: Buffer) => {
            responseBody += chunk.toString()
          })
          res.on('end', () => {
            try {
              const data = JSON.parse(responseBody)
              if (data.code !== 0) {
                reject(new Error(`Upload file failed: ${data.msg}`))
                return
              }
              resolve(data.data?.file_key ?? '')
            } catch {
              reject(new Error(`Upload file parse error: ${responseBody.slice(0, 200)}`))
            }
          })
        }
      )
      req.on('error', reject)
      req.setTimeout(60000, () => {
        req.destroy()
        reject(new Error('Upload file timed out (60s)'))
      })
      req.write(body)
      req.end()
    })
  }

  /** Send an image message to a chat using an image_key */
  async sendImageMessage(chatId: string, imageKey: string): Promise<{ messageId: string }> {
    const headers = await this.authHeaders()
    const body = JSON.stringify({
      receive_id: chatId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey })
    })
    const res = await request(
      'POST',
      '/open-apis/im/v1/messages?receive_id_type=chat_id',
      headers,
      body
    )
    const data = JSON.parse(res.body)
    if (data.code !== 0) {
      throw new Error(`Feishu sendImageMessage failed: ${data.msg}`)
    }
    return { messageId: data.data?.message_id ?? '' }
  }

  /** Send a file message to a chat using a file_key */
  async sendFileMessage(chatId: string, fileKey: string): Promise<{ messageId: string }> {
    const headers = await this.authHeaders()
    const body = JSON.stringify({
      receive_id: chatId,
      msg_type: 'file',
      content: JSON.stringify({ file_key: fileKey })
    })
    const res = await request(
      'POST',
      '/open-apis/im/v1/messages?receive_id_type=chat_id',
      headers,
      body
    )
    const data = JSON.parse(res.body)
    if (data.code !== 0) {
      throw new Error(`Feishu sendFileMessage failed: ${data.msg}`)
    }
    return { messageId: data.data?.message_id ?? '' }
  }

  /**
   * Send an audio (voice) message to a chat using a file_key.
   *
   * 飞书 `msg_type: 'audio'` 与 `'file'` 的差别**只在 msg_type 这一个字段**，
   * `content` 同样是 `{ file_key }`。区别在上游：audio 的 file_key 必须是
   * `uploadFile(..., 'opus')` 传上去的，格式不对飞书会拒。
   */
  async sendAudioMessage(chatId: string, fileKey: string): Promise<{ messageId: string }> {
    const headers = await this.authHeaders()
    const body = JSON.stringify({
      receive_id: chatId,
      msg_type: 'audio',
      content: JSON.stringify({ file_key: fileKey })
    })
    const res = await request(
      'POST',
      '/open-apis/im/v1/messages?receive_id_type=chat_id',
      headers,
      body
    )
    const data = JSON.parse(res.body)
    if (data.code !== 0) {
      throw new Error(`Feishu sendAudioMessage failed: ${data.msg}`)
    }
    return { messageId: data.data?.message_id ?? '' }
  }

  /** Send an urgent push for a message */
  async sendUrgent(
    messageId: string,
    userIds: string[],
    urgentType: 'app' | 'sms',
    userIdType: 'user_id' | 'open_id' | 'union_id' = 'user_id'
  ): Promise<boolean> {
    const headers = await this.authHeaders()
    const body = JSON.stringify({
      user_id_list: userIds,
      urgent_type: urgentType
    })
    const res = await request(
      'POST',
      `/open-apis/im/v1/messages/${messageId}/urgent?user_id_type=${userIdType}`,
      headers,
      body
    )
    const data = JSON.parse(res.body)
    if (data.code !== 0) {
      throw new Error(`Feishu sendUrgent failed: ${data.msg}`)
    }
    return true
  }
}
