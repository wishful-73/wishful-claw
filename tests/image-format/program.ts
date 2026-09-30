/*
 * 图片扩展名按字节魔数判（iter-37 S-162）。
 *
 * 存在理由：下载路径此前从 `src` 字符串猜扩展名 —— data URL 的 mime type，或者 URL 尾巴。
 * 两者都会撒谎（webp 挂在 .png 的 URL 后面、data URL 的 mime type 压根没填），字节不会。
 * 部分看图工具按扩展名挑解码器，名字撒谎的表现是「存下来的图打不开」，而没人会想到是名字的问题。
 *
 * 钉死三条：
 *   ① 六种已知格式各自的魔数都认得出（PNG / JPEG / GIF / BMP / WebP / SVG）；
 *   ② 认不出来返回 null —— 由调用方落 `.bin`，**不猜成 `.png`**（猜错的那个会被当成 PNG 去解，
 *      失败发生在用户双击它的时候）；
 *   ③ 只解 base64 的头部 —— 4 MB 的图不该为了认格式分配 4 MB。
 */

import assert from 'node:assert/strict'
import {
  IMAGE_SIGNATURE_BYTES,
  detectImageExtension,
  detectImageExtensionFromBase64,
  withDetectedExtension
} from '../../src/renderer/src/lib/utils/image-format'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

function bytes(...head: number[]): Uint8Array {
  return Uint8Array.from(head)
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
}

/** 魔数 + 填充，用来验证「只认头」而不是「认全长」。 */
function padded(head: number[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength)
  out.set(head, 0)
  for (let index = head.length; index < totalLength; index++) {
    out[index] = index % 251
  }
  return out
}

// ─── 1. 六种格式的魔数 ───

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const BMP_HEAD = [0x42, 0x4d]

checkEqual(detectImageExtension(bytes(...PNG_HEAD)), '.png', 'PNG 魔数')
checkEqual(detectImageExtension(bytes(...JPEG_HEAD)), '.jpg', 'JPEG 魔数')
checkEqual(detectImageExtension(bytes(...GIF_HEAD)), '.gif', 'GIF 魔数')
checkEqual(detectImageExtension(bytes(...BMP_HEAD)), '.bmp', 'BMP 魔数')

const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // 长度
  0x57, 0x45, 0x42, 0x50 // WEBP
])
checkEqual(detectImageExtension(webp), '.webp', 'WebP 魔数（RIFF + WEBP）')

// RIFF 但不是 WEBP（例如 WAV）不该被认成图。
const wav = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45
])
checkEqual(detectImageExtension(wav), null, 'RIFF/WAVE 不算图片')

// ─── 2. SVG 是文本，没有定长魔数 ───

checkEqual(
  detectImageExtension(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
  '.svg',
  '裸 <svg> 开头'
)
checkEqual(
  detectImageExtension(
    new TextEncoder().encode('<?xml version="1.0"?>\r\n<svg xmlns="http://www.w3.org/2000/svg"/>')
  ),
  '.svg',
  'XML 声明 + <svg>'
)
checkEqual(
  detectImageExtension(new TextEncoder().encode('\uFEFF  <svg/>')),
  '.svg',
  'BOM 与前导空白之后仍认得出'
)
checkEqual(
  detectImageExtension(new TextEncoder().encode('<?xml version="1.0"?>\r\n<rss/>')),
  null,
  'XML 但不是 SVG'
)
checkEqual(
  detectImageExtension(new TextEncoder().encode('hello, not an image at all')),
  null,
  '纯文本不算图片'
)

// ─── 3. 认不出来一律 null，不猜 ───

checkEqual(detectImageExtension(new Uint8Array(0)), null, '空字节 → null')
checkEqual(detectImageExtension(bytes(0x00, 0x01, 0x02)), null, '未知魔数 → null')
checkEqual(detectImageExtension(bytes(0x89, 0x50, 0x4e)), null, 'PNG 魔数被截断 → null')

// ─── 4. base64 入口（只解头部） ───

checkEqual(detectImageExtensionFromBase64(toBase64(bytes(...PNG_HEAD))), '.png', 'base64 PNG')
checkEqual(detectImageExtensionFromBase64(toBase64(bytes(...JPEG_HEAD))), '.jpg', 'base64 JPEG')
checkEqual(detectImageExtensionFromBase64(''), null, '空 base64 → null')
checkEqual(detectImageExtensionFromBase64('   '), null, '全空白 base64 → null')
checkEqual(detectImageExtensionFromBase64('not base64 at all !!!'), null, '非法 base64 → null')

// 一张「大图」：魔数在头，其余是填充。只解头也认得出。
const bigPng = padded(PNG_HEAD, IMAGE_SIGNATURE_BYTES * 40)
checkEqual(
  detectImageExtensionFromBase64(toBase64(bigPng)),
  '.png',
  '远大于嗅探窗口的 PNG 仍认得出'
)
checkEqual(
  detectImageExtensionFromBase64(toBase64(padded(JPEG_HEAD, 65536))),
  '.jpg',
  '64 KB 的 JPEG 仍认得出'
)

// ─── 5. 名字按嗅探结果改，stem 保留 ───

checkEqual(withDetectedExtension('logo.png', '.webp'), 'logo.webp', '内容与名字不符时以字节为准')
checkEqual(withDetectedExtension('logo', '.png'), 'logo.png', '没有扩展名时补上')
checkEqual(withDetectedExtension('archive.tar.gz', '.png'), 'archive.tar.png', '只换最后一段')
checkEqual(withDetectedExtension('logo.png', null), 'logo.bin', '认不出来落 .bin')
checkEqual(withDetectedExtension('.gitignore', '.png'), '.gitignore.png', '点开头的名字不当扩展名')

console.log(`image-format: ${checks} checks passed`)
