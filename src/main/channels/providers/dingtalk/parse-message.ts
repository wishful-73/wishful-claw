/**
 * 钉钉入站消息的 msgtype 分派（纯函数，无 IO）。
 *
 * 原先只解 `payload.text.content`，图片 / 文件 / 富文本消息解析出空串就被
 * `if (!content) return` 静默丢掉 —— 聊天窗里连占位符都没有。这里按 msgtype
 * 分派，**未知类型也要产出占位符**，绝不再让消息凭空消失。
 *
 * 媒体下载（downloadCode → 字节）不在这里做：那一步依赖钉钉应用权限，
 * 见 S-213 §五.1，待权限实测通过后再接。
 */

const IMAGE_PLACEHOLDER = '[User sent an image]'
const FILE_PLACEHOLDER = '[User sent a file]'
const VOICE_PLACEHOLDER = '[User sent a voice message]'
const RICH_TEXT_PLACEHOLDER = '[User sent a rich text message]'
const ATTACHMENT_PLACEHOLDER = '[User sent an attachment]'

export interface DingTalkIncomingContent {
  content: string
  /** 归一化后的消息类型，落进 `ChannelIncomingMessageData.msgType` */
  msgType: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * 老版钉钉把结构化载荷以 JSON 字符串塞在 `text.content` 里，
 * 例如 `{"downloadCode":"...","pictureDownloadCode":"..."}` —— 直接当正文发出去
 * 就是把一串 JSON 甩给模型。能认出来的类型在这里转成占位符。
 */
function normalizeTextContent(raw: string): DingTalkIncomingContent {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return { content: raw, msgType: 'text' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { content: raw, msgType: 'text' }
  }

  const payload = asRecord(parsed)
  if (!payload) return { content: raw, msgType: 'text' }

  // 真正的文本载荷：`{"content":"早上好"}`
  const inner = pickString(payload.content)
  if (inner) return { content: inner, msgType: 'text' }

  // 文件：fileName 优先于 downloadCode（文件消息两个字段都带）
  const fileName = pickString(payload.fileName)
  if (fileName) return { content: `[File: ${fileName}]`, msgType: 'file' }

  // 图片：老版用 downloadCode / pictureDownloadCode
  if (pickString(payload.downloadCode, payload.pictureDownloadCode)) {
    return { content: IMAGE_PLACEHOLDER, msgType: 'picture' }
  }

  // 认不出具体类型，但确实是结构化载荷 ⇒ 别把 JSON 甩给模型
  return { content: ATTACHMENT_PLACEHOLDER, msgType: 'unknown' }
}

/** 富文本：把文本段拼起来，图片段（带 downloadCode）只留提示 */
function extractRichText(node: Record<string, unknown> | undefined): string {
  if (!node) return ''

  const blocks = Array.isArray(node.content) ? node.content : Array.isArray(node.richText) ? node.richText : null
  if (!blocks) {
    return pickString(node.text) ?? ''
  }

  const parts: string[] = []
  let hasImage = false
  for (const block of blocks) {
    const item = asRecord(block)
    if (!item) continue
    const text = pickString(item.text)
    if (text) {
      parts.push(text)
      continue
    }
    if (pickString(item.downloadCode, item.pictureDownloadCode)) hasImage = true
  }

  const text = parts.join(' ').trim()
  if (text) return text
  return hasImage ? IMAGE_PLACEHOLDER : ''
}

/**
 * 解析出一条入站消息的正文与类型。
 * 返回 `null` 只代表「真正空的消息」（纯文本且内容为空），非文本消息一律产出占位符。
 */
export function resolveDingTalkIncomingContent(
  payload: Record<string, unknown>
): DingTalkIncomingContent | null {
  const declaredType = pickString(payload.msgtype)
  const msgtype = declaredType?.toLowerCase() ?? ''
  // 原样回传平台给的类型，只在小写化后做分支判断
  const rawMsgType = declaredType ?? 'unknown'
  const text = asRecord(payload.text)
  const textContent = typeof text?.content === 'string' ? text.content : ''

  // 没标类型 / 标了 text：走原来的文本路径
  if (!msgtype || msgtype === 'text') {
    const normalized = normalizeTextContent(textContent)
    const content = normalized.content.trim()
    if (!content) return null
    return { content, msgType: normalized.msgType }
  }

  if (msgtype === 'picture') {
    return { content: IMAGE_PLACEHOLDER, msgType: rawMsgType }
  }

  if (msgtype === 'file') {
    const contentNode = asRecord(payload.content)
    const fileName = pickString(contentNode?.fileName, payload.fileName)
    return { content: fileName ? `[File: ${fileName}]` : FILE_PLACEHOLDER, msgType: rawMsgType }
  }

  if (msgtype === 'voice') {
    const voice = asRecord(payload.voice) ?? asRecord(payload.content)
    // 钉钉语音一般自带识别文字（recognition），有就用文字，没有再留占位符
    const recognition = pickString(voice?.recognition, payload.recognition)
    return { content: recognition ?? VOICE_PLACEHOLDER, msgType: rawMsgType }
  }

  if (msgtype === 'richtext' || msgtype === 'rich_text') {
    const rich = asRecord(payload.richText) ?? asRecord(payload.content)
    const extracted = extractRichText(rich)
    return { content: extracted || RICH_TEXT_PLACEHOLDER, msgType: rawMsgType }
  }

  // 未知类型：也要有条占位符，别再静默丢弃
  return { content: ATTACHMENT_PLACEHOLDER, msgType: rawMsgType }
}
