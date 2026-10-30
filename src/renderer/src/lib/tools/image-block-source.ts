import type { ImageBlock } from '@renderer/lib/api/types'
import { filePathToMediaUrl } from '@renderer/lib/local-media-url'

export interface ResolvedImageSource {
  /** What an `<img src>` takes: a data URL, or the remote URL. */
  src: string
  /** The persisted local copy, when the producer left one on disk. */
  filePath?: string
}

/**
 * One image block → the `src` / `filePath` pair an `ImagePreview` needs
 * (iter-37 S-162).
 *
 * Extracted because several cards built this pair by hand, and the mistake it
 * hides is silent: handing image #1's bytes to image #2's button looks exactly
 * right on screen. One pure mapping is testable; inline copies are not.
 *
 * S-284：`filePath` 现在是**兜底**来源。落库时 base64 会被剥掉（只留 `filePath`），
 * 所以从库里重新加载的消息走的是 `oc-media://`，而不是 `data:`。三个来源的优先级：
 * 内联 base64（正在执行的那一份） → 远程 `url` → 本地文件。
 *
 * Returns `null` when the block carries neither a source nor a file path —
 * there is nothing to render, and callers already skip such blocks.
 */
export function resolveImageBlockSource(image: ImageBlock): ResolvedImageSource | null {
  const { source } = image
  const filePath = source.filePath

  const src =
    source.type === 'base64' && source.data
      ? `data:${source.mediaType || 'image/png'};base64,${source.data}`
      : (source.url ?? (filePath ? filePathToMediaUrl(filePath) : ''))

  if (!src && !filePath) return null
  return filePath ? { src, filePath } : { src }
}
