/**
 * Persisting image buffers — shared by the renderer's `image:persist-generated`
 * channel and by the main-process `window:capture-self` reverse-request.
 *
 * Historically this only ever wrote into `~/wishful-claw/image`, which made it
 * useless for the one job an agent actually needs: dropping a screenshot next to
 * the documentation it is writing. Callers can now pass a `targetPath`.
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { homedir } from 'os'
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'path'

const GENERATED_IMAGES_DIR = 'wishful-claw'
const GENERATED_IMAGES_SUBDIR = 'image'

/** Extensions we will write to. Anything else gets the media-type extension appended. */
const KNOWN_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function getGeneratedImagesDir(): string {
  const dir = join(homedir(), GENERATED_IMAGES_DIR, GENERATED_IMAGES_SUBDIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function guessExtensionFromMimeType(mediaType?: string): string {
  switch ((mediaType || '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
      return '.bmp'
    default:
      return '.png'
  }
}

export interface PersistImageOptions {
  /**
   * Where to write the file. Relative paths resolve against `baseDir` (the working
   * folder), absolute paths are used as-is. Omit to keep the old behaviour of
   * dropping the image into the app's generated-images directory.
   */
  targetPath?: string
  baseDir?: string
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
    const filePath = join(getGeneratedImagesDir(), `${Date.now()}-${randomUUID()}${extension}`)
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
