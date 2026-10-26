/**
 * 图片 mime → 扩展名映射（S-224 从 `image-persist.ts` 抽出）。
 *
 * 抽出来的原因：`image-persist.ts` 依赖 `./data-dir`，而 `data-dir.ts` 引了
 * `electron` —— 任何 node 单测 import 它都会连带把 electron 拉进来而崩。
 * 这里只做纯映射，零依赖，`chat-image-dir.ts` 与单测都能直接用。
 */

/** 会写盘的图片扩展名。其余类型走 `guessExtensionFromMimeType` 的默认分支。 */
export const KNOWN_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp'
])

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
