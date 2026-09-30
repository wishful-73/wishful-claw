/**
 * Image format sniffing for downloads (iter-37 S-162).
 *
 * The download path used to read the extension off the `src` string — a data
 * URL's mime type, or whatever the URL happened to end with. Both lie: a webp
 * served behind a `.png` URL, a data URL whose mime type was never filled in.
 * The bytes do not. Some viewers pick a decoder by extension, so a lying name
 * surfaces as "the file will not open", and nobody traces that back to the
 * name.
 *
 * Unknown input returns `null` on purpose — callers fall back to `.bin` rather
 * than guessing `.png`, because a wrong `.png` gets opened *as* PNG and fails
 * at the moment the user double-clicks it.
 *
 * Pure and Electron-free so `tests/image-format` can run it in plain node.
 */

/** Bytes kept for sniffing. WebP needs 12; SVG needs room for an XML prolog. */
export const IMAGE_SIGNATURE_BYTES = 512

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let index = 0; index < length; index++) {
    const byte = bytes[offset + index]
    if (byte === undefined) return out
    out += String.fromCharCode(byte)
  }
  return out
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * SVG is text, so there is no fixed signature: accept a bare `<svg`, or an
 * `<?xml …?>` prolog followed by one somewhere in the head.
 *
 * The head is read as latin1 — tag names and the prolog are ASCII, so a UTF-8
 * body cannot break the match. A UTF-8 BOM is stripped at the *byte* level:
 * read as latin1 it would come out as `ï»¿`, which no `\uFEFF` check catches.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const offset = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const head = ascii(bytes, offset, Math.min(bytes.length - offset, IMAGE_SIGNATURE_BYTES))
  const trimmed = head.trimStart()
  if (trimmed.startsWith('<svg')) return true
  return trimmed.startsWith('<?xml') && trimmed.includes('<svg')
}

/** The extension the *bytes* say, or `null` when nothing matches. */
export function detectImageExtension(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return '.jpg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return '.gif'
  if (startsWith(bytes, [0x42, 0x4d])) return '.bmp'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return '.webp'
  if (looksLikeSvg(bytes)) return '.svg'
  return null
}

/** Base64 → bytes, or `null` when the payload is not decodable. */
export function base64ToBytes(base64: string): Uint8Array | null {
  const trimmed = base64.trim()
  if (!trimmed) return null

  try {
    const binary = atob(trimmed)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * Sniff a base64 payload. Only the head is decoded — a 4 MB image does not
 * need a 4 MB allocation to be identified.
 */
export function detectImageExtensionFromBase64(base64: string): string | null {
  const trimmed = base64.trim()
  if (!trimmed) return null

  // 4 base64 chars carry 3 bytes, so this lands on a quantum boundary and
  // `atob` accepts the slice as-is.
  const headChars = Math.ceil(IMAGE_SIGNATURE_BYTES / 3) * 4
  const head = trimmed.length > headChars ? trimmed.slice(0, headChars) : trimmed
  const bytes = base64ToBytes(head)
  return bytes ? detectImageExtension(bytes) : null
}

/**
 * Swap a file name's extension for the sniffed one, keeping the stem.
 * `null` (nothing recognised) yields `.bin` rather than a guessed `.png`.
 */
export function withDetectedExtension(fileName: string, extension: string | null): string {
  const suffix = extension ?? '.bin'
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return `${stem}${suffix}`
}
