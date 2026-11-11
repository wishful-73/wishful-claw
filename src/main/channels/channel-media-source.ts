/**
 * 出站媒体来源读取 —— 本地路径或 http(s) URL 统一读成 Buffer。
 *
 * 从 `src/main/ipc/channel-handlers/channel-handler-utils.ts` 搬家至此，原因：
 * 渠道服务层（`channels/providers/*-service.ts`）要用它，而 IPC 层 import 渠道层
 * 是正常方向；反过来让渠道层 import IPC 工具会绕成
 * channel-handler-utils → channel-manager → providers/*-service → 本文件 → channel-handler-utils
 * 的循环依赖。
 *
 * 搬家时把「单次输入没有上界」一并继承了过来（S-355 D-6）：URL 分支无超时、无大小上限，
 * 本地分支用 `readFileSync` 同步读整个文件。`ChannelSendFile` 语义上就是「任意文件」，
 * 模型完全可能塞几百 MB 进来 —— 那会直接打在主进程堆上，且微信侧 `encryptOutboundMedia`
 * 还会再复制一整份。所以这里补齐三件事：**大小上界、下载超时、异步读**。
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * 单次出站媒体读取的硬上限。
 *
 * 这是**底座护栏**，不是平台规则复刻：渠道自己的限制（飞书文件 30MB / 图片 10MB、
 * 微信语音 60s 等）由渠道 API 回错误，那些值会变，抄一份到本地就是维护两份真相。
 * 这里只回答一个问题 —— 「一次读多少内存算失控」。
 */
export const MAX_OUTBOUND_MEDIA_BYTES = 30 * 1024 * 1024

/** 远端媒体下载超时。地址不响应时必须能回收，不能把渠道服务挂死 */
export const OUTBOUND_MEDIA_FETCH_TIMEOUT_MS = 60_000

function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function tooLargeError(what: string, bytes: number): Error {
  return new Error(
    `Outbound media too large: ${what} is ${bytes} bytes, ` +
      `limit is ${MAX_OUTBOUND_MEDIA_BYTES} bytes (${describeBytes(MAX_OUTBOUND_MEDIA_BYTES)})`
  )
}

// ── 凭据类路径黑名单（S-355 D-7） ──
//
// 渠道会话里这批文件工具是**免审批**的（`ToolCallProcessor.Approval.cs:81-84`，渠道弹不出
// 审批框）。组合后果：群里有人说句话 → agent 在渠道会话 → `ChannelSendImage(source:
// "C:\\Users\\x\\.ssh\\id_rsa")` → 当图片发到群里。免审批是既定设计，不动；那么「读哪个
// 文件」就是唯一还能挡的地方。
//
// 黑名单天生有漏，这里只挡**最要命且没有正当发送理由**的那几类。不做白名单：那会把
// 「把刚生成的图发出去」这个主场景也挡掉（生成目录可能在数据根之外）。

/** 目录名（任一层命中即拒） */
const BLOCKED_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])

/** 文件名 —— 只有这些名字的文件本身就是凭据容器 */
const BLOCKED_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pgpass',
  'credentials',
  'credentials.json'
])

/** SSH 私钥的标准文件名（`.pub` 是公钥，不拦） */
const BLOCKED_PRIVATE_KEY_NAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])

/** 证书 / 密钥容器的扩展名 */
const BLOCKED_EXTENSIONS = new Set(['.pem', '.p12', '.pfx'])

/**
 * 本地路径是否可以出站。命中黑名单抛错 —— 宁可拒在读取之前，也不要先读到内存再判断。
 *
 * 只处理本地路径；URL 指向远端，不涉及本机凭据。
 */
export function assertOutboundSourceAllowed(value: string): void {
  const trimmed = value.trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return

  const segments = trimmed.split(/[\\/]+/).filter(Boolean)
  const blockedSegment = segments.find((segment) => BLOCKED_SEGMENTS.has(segment.toLowerCase()))
  if (blockedSegment) {
    throw new Error(
      `Refusing to send a credential file: ${trimmed} (path contains "${blockedSegment}")`
    )
  }

  const fileName = path.basename(trimmed).toLowerCase()
  if (
    BLOCKED_FILE_NAMES.has(fileName) ||
    fileName.startsWith('.env.') ||
    BLOCKED_PRIVATE_KEY_NAMES.has(fileName) ||
    BLOCKED_EXTENSIONS.has(path.extname(fileName))
  ) {
    throw new Error(`Refusing to send a credential file: ${trimmed}`)
  }
}

/** 从来源推断文件名（URL 取 pathname，本地取 basename），推断不出用 fallback */
export function resolveSourceFileName(source: string, fallback: string): string {
  const value = source.trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const fileName = path.basename(url.pathname)
      return decodeURIComponent(fileName || fallback)
    } catch {
      return fallback
    }
  }

  const sanitized = value.split('?')[0]
  return path.basename(sanitized) || fallback
}

/** 远端读取：带超时，边读边累加，超限立即中断 */
async function readRemote(value: string): Promise<Buffer> {
  const response = await fetch(value, {
    signal: AbortSignal.timeout(OUTBOUND_MEDIA_FETCH_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`Download URL failed: HTTP ${response.status}`)
  }

  // 声明值能提前拒掉明显的巨物。但不能只信它 —— 可能缺失，也可能少报。
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_OUTBOUND_MEDIA_BYTES) {
    throw tooLargeError('remote media', declared)
  }

  if (!response.body) {
    const fallbackBuffer = Buffer.from(await response.arrayBuffer())
    if (fallbackBuffer.byteLength > MAX_OUTBOUND_MEDIA_BYTES) {
      throw tooLargeError('remote media', fallbackBuffer.byteLength)
    }
    return fallbackBuffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      total += chunk.byteLength
      if (total > MAX_OUTBOUND_MEDIA_BYTES) {
        throw tooLargeError('remote media', total)
      }
      chunks.push(Buffer.from(chunk))
    }
  } finally {
    // 正常读完 / 超限 / 调用方取消，都显式释放连接，别让 body 继续往堆里灌
    void reader.cancel().catch(() => undefined)
  }

  const buffer = Buffer.concat(chunks, total)
  if (buffer.byteLength === 0) {
    throw new Error('Download URL returned an empty body')
  }
  return buffer
}

/** 本地读取：异步 stat + 异步 readFile，不阻塞主进程事件循环 */
async function readLocal(value: string): Promise<Buffer> {
  // 在 stat 之前就拒 —— 连「文件存不存在」都不该告诉一个想发凭据的调用方
  assertOutboundSourceAllowed(value)

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(value)
  } catch {
    throw new Error(`File not found: ${value}`)
  }

  if (!stat.isFile()) {
    throw new Error(`Not a file: ${value}`)
  }

  if (stat.size > MAX_OUTBOUND_MEDIA_BYTES) {
    throw tooLargeError('file', stat.size)
  }

  const buffer = await fs.promises.readFile(value)

  // stat 与 read 之间文件可能变大，读后再判一次（TOCTOU 的兜底，不是替代）
  if (buffer.byteLength > MAX_OUTBOUND_MEDIA_BYTES) {
    throw tooLargeError('file', buffer.byteLength)
  }
  return buffer
}

/** 读取媒体来源。支持 http(s) URL 与本地绝对路径，其余一律抛错 */
export async function readBinarySource(
  source: string,
  fallbackName: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const value = source.trim()
  if (!value) {
    throw new Error('File path is empty')
  }

  const buffer = /^https?:\/\//i.test(value) ? await readRemote(value) : await readLocal(value)

  return {
    buffer,
    fileName: resolveSourceFileName(value, fallbackName)
  }
}
