/**
 * Persisting image buffers — shared by the renderer's `image:persist-generated`
 * channel and by the main-process `window:capture-self` reverse-request.
 *
 * Callers that care where the file lands pass a `targetPath`. Everything else
 * (a browser screenshot with no target, say) falls into the session's own
 * `.wishful-claw/image` — see `resolveGeneratedImagesDir`. That directory sits
 * inside the session's sandbox, so the agent can read back what it just
 * produced; the old fixed `~/wishful-claw/image` did not.
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'path'
import { resolveDataDir } from './data-dir'
import { resolveGeneratedImagesDir, type GeneratedImageScope } from './generated-image-dir'
import { KNOWN_IMAGE_EXTENSIONS, guessExtensionFromMimeType } from './image-extension'

export type { GeneratedImageScope }

// 这两个从 `image-extension.ts` 搬来，仍从这里 re-export —— 既有调用方路径不变。
export { KNOWN_IMAGE_EXTENSIONS, guessExtensionFromMimeType }

export interface PersistImageOptions {
  /**
   * Where to write the file. Relative paths resolve against `baseDir` (the working
   * folder), absolute paths are used as-is.
   */
  targetPath?: string
  baseDir?: string
  /**
   * Directory for images with no `targetPath`. Callers pass the directory they
   * resolved for the session (`resolveGeneratedImagesDir`); omitting it falls
   * back to the data root's own `image/` folder.
   */
  defaultDir?: string
  /**
   * File name (no directory) used when there is no `targetPath`. Omitted ⇒ the
   * old `{timestamp}-{uuid}` name.
   *
   * Added for S-283: screenshots are named by content hash so the same frame
   * captured twice lands on the same file instead of eating the disk.
   */
  fileName?: string
}

export interface PersistImageResult {
  filePath: string
  mediaType: string
}

/**
 * Writes an image buffer and returns the absolute path it landed on.
 *
 * A target with no recognised image extension gets one appended rather than
 * being overwritten wholesale — `docs/images/panel` becomes `panel.png`, so a
 * clumsy path cannot produce a file the doc tooling will not render.
 */
export function persistImageBuffer(
  buffer: Buffer,
  mediaType: string,
  options: PersistImageOptions = {}
): PersistImageResult {
  const extension = guessExtensionFromMimeType(mediaType)
  const target = typeof options.targetPath === 'string' ? options.targetPath.trim() : ''

  if (!target) {
    const dir = options.defaultDir?.trim()
      ? options.defaultDir.trim()
      : resolveGeneratedImagesDir({}, resolveDataDir())
    fs.mkdirSync(dir, { recursive: true })
    const name = options.fileName?.trim() || `${Date.now()}-${randomUUID()}${extension}`
    const filePath = join(dir, name)
    fs.writeFileSync(filePath, buffer)
    return { filePath, mediaType }
  }

  const hasKnownExtension = KNOWN_IMAGE_EXTENSIONS.has(extname(target).toLowerCase())
  const withExtension = hasKnownExtension ? target : `${target}${extension}`
  const base = options.baseDir?.trim() ? options.baseDir.trim() : process.cwd()
  const filePath = isAbsolute(withExtension)
    ? normalize(withExtension)
    : resolve(base, withExtension)

  fs.mkdirSync(dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
  return { filePath, mediaType }
}
