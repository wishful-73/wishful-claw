import type { ImageBlock } from '@renderer/lib/api/types'

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
 * Returns `null` when the block carries neither a source nor a file path —
 * there is nothing to render, and callers already skip such blocks.
 */
export function resolveImageBlockSource(image: ImageBlock): ResolvedImageSource | null {
  const { source } = image
  const filePath = source.filePath

  const src =
    source.type === 'base64' && source.data
      ? `data:${source.mediaType || 'image/png'};base64,${source.data}`
      : (source.url ?? '')

  if (!src && !filePath) return null
  return filePath ? { src, filePath } : { src }
}
