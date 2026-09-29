import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { videoMediaTypeFor } from '@renderer/lib/media-file-types'
import { computeFrameTimes, planChunks } from '@renderer/lib/tools/video-read-plan'

/**
 * 视频抽帧（S-145 §六）：Read 读视频时，把画面取样成几张静态图交给模型。
 *
 * 为什么在渲染端：解码只有渲染端的 Chromium 会做。C# 侧（Read 工具的宿主）是纯
 * Node/.NET 环境，没有解码器 —— 引 ffmpeg 会带进一个几十 MB 的二进制和它的许可问题。
 * 所以流程是：C# 发起反向请求 → 这里解码抽帧 → 帧回到 C# → 作为 image 块进模型。
 *
 * 为什么分片读进来拼 Blob，而不是整文件一次读：
 *   ① 整文件读会把「文件大小」变成「渲染端内存占用」，长视频直接顶爆；
 *   ② 分片之间只留一个 4 MB 的峰，Blob 本体由 Chromium 的 blob 存储托管（大的落盘）。
 *
 * 为什么用 Blob 而不是某条自定义协议直连本地文件：canvas 读像素要求「同源」，
 * 跨源媒体会把 canvas 污点化，`toDataURL` 直接抛 SecurityError。同一页面里
 * `URL.createObjectURL` 出来的 blob 与页面同源，这条路没有污点问题，也不需要
 * 给任何协议开 CORS —— 给一个能读任意本地路径的协议开 CORS 等于开一个本地文件读取口子。
 */

export interface VideoFrameRequest {
  /** 本地绝对路径。SSH 远程视频不在范围内（挂账）。 */
  path: string
  /** 取几帧。 */
  frameCount: number
  /** 长边上限（像素）。只缩不放。 */
  maxEdge: number
  /** 文件字节上限，超过直接降级 —— 由调用方（Read 工具）定策略，这里只执行。 */
  maxBytes: number
}

export interface ExtractedVideoFrame {
  /** base64（不含 data: 前缀），JPEG。 */
  data: string
  mediaType: string
  timestampSec: number
}

export interface VideoFramesResult {
  frames?: ExtractedVideoFrame[]
  durationSec?: number
  width?: number
  height?: number
  error?: string
}

/** 分片大小。4 MB 是 IPC 往返开销与内存峰值之间的折中（200 MB 视频 = 50 次往返）。 */
const CHUNK_BYTES = 4 * 1024 * 1024
const METADATA_TIMEOUT_MS = 20_000
const SEEK_TIMEOUT_MS = 15_000
const PAINT_TIMEOUT_MS = 2_000
const JPEG_QUALITY = 0.8

export async function extractVideoFrames(request: VideoFrameRequest): Promise<VideoFramesResult> {
  const filePath = typeof request?.path === 'string' ? request.path.trim() : ''
  if (!filePath) return { error: 'No file path was provided.' }

  try {
    const chunks = await readFileChunks(filePath, request.maxBytes)
    return await captureFrames(filePath, chunks, request)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function readFileChunks(filePath: string, maxBytes: number): Promise<Uint8Array[]> {
  const stat = (await ipcClient.invoke(IPC.FS_STAT_PATH, { path: filePath })) as {
    isFile?: boolean
    size?: number
  } | null

  if (!stat?.isFile) throw new Error('The path is not a readable file.')

  const size = stat.size ?? 0
  if (size <= 0) throw new Error('The file is empty.')
  if (maxBytes > 0 && size > maxBytes) {
    throw new Error(
      `The video is ${formatMegabytes(size)}, over the ${formatMegabytes(maxBytes)} limit for frame extraction.`
    )
  }

  const chunks: Uint8Array[] = []
  for (const chunk of planChunks(size, CHUNK_BYTES)) {
    const result = (await ipcClient.invoke(IPC.FS_READ_FILE_BINARY, {
      path: filePath,
      offset: chunk.offset,
      length: chunk.length
    })) as { data?: string; error?: string }

    if (result?.error) throw new Error(result.error)
    if (typeof result?.data !== 'string') throw new Error('The file read returned no data.')
    chunks.push(base64ToBytes(result.data))
  }

  return chunks
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function captureFrames(
  filePath: string,
  chunks: Uint8Array[],
  request: VideoFrameRequest
): Promise<VideoFramesResult> {
  const objectUrl = URL.createObjectURL(
    new Blob(chunks as BlobPart[], { type: videoMediaTypeFor(filePath) })
  )
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  // 不进布局、不可见，但必须在文档里 —— 脱离文档的元素不保证解码推进。
  video.style.cssText =
    'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.appendChild(video)

  try {
    video.src = objectUrl
    await waitForMetadata(video)

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      throw new Error('The file has no picture track (audio-only or an unsupported container).')
    }

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not read the video duration, so frames could not be sampled.')
    }

    const canvas = document.createElement('canvas')
    const scale =
      request.maxEdge > 0 ? Math.min(1, request.maxEdge / Math.max(width, height)) : 1
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable, so frames could not be captured.')

    const frames: ExtractedVideoFrame[] = []
    for (const timestampSec of computeFrameTimes(duration, request.frameCount)) {
      await seekTo(video, timestampSec)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      const comma = dataUrl.indexOf(',')
      if (comma < 0) continue
      frames.push({ data: dataUrl.slice(comma + 1), mediaType: 'image/jpeg', timestampSec })
    }

    if (frames.length === 0) throw new Error('No frame could be captured from this video.')
    return { frames, durationSec: duration, width, height }
  } finally {
    video.removeAttribute('src')
    // 显示空源，让解码器立刻放手；不这么做的话大视频的缓冲会挂到元素被 GC 为止。
    video.load()
    video.remove()
    URL.revokeObjectURL(objectUrl)
  }
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Timed out reading the video metadata.')),
      METADATA_TIMEOUT_MS
    )
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onLoaded = (): void => finish()
    const onError = (): void => finish(new Error(describeMediaError(video)))
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
  })
}

async function seekTo(video: HTMLVideoElement, timestampSec: number): Promise<void> {
  if (video.readyState >= 2 && Math.abs(video.currentTime - timestampSec) < 0.001) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Timed out seeking to ${timestampSec}s.`)),
      SEEK_TIMEOUT_MS
    )
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onSeeked = (): void => finish()
    const onError = (): void => finish(new Error(describeMediaError(video)))
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = timestampSec
  })

  // `seeked` 只保证「位置变了」，不保证这一帧已经解码完成 —— 直接 drawImage 可能画到
  // 上一帧。有 requestVideoFrameCallback 就再等一帧落定，没有就只能赌（老版本行为）。
  await waitForPaintedFrame(video)
}

function waitForPaintedFrame(video: HTMLVideoElement): Promise<void> {
  const target = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number
  }
  if (typeof target.requestVideoFrameCallback !== 'function') return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, PAINT_TIMEOUT_MS)
    target.requestVideoFrameCallback!(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: 'the load was aborted',
  2: 'a network error occurred while reading the file',
  3: 'the video could not be decoded (corrupt data)',
  4: 'this container or codec is not supported'
}

function describeMediaError(video: HTMLVideoElement): string {
  const code = video.error?.code
  const text = code ? MEDIA_ERROR_TEXT[code] : undefined
  return text ? `The video could not be read: ${text}.` : 'The video element reported an error.'
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
