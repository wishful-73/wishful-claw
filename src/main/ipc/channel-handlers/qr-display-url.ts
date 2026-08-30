function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized === 'amp') return '&'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'

    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.slice(radix === 16 ? 2 : 1)
    const codePoint = Number.parseInt(digits, radix)
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match
  })
}

function readImageSource(tag: string): string | null {
  const attributes = ['data-src', 'data-original', 'data-url', 'src']
  for (const attribute of attributes) {
    const quoted = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
    if (quoted?.[2]?.trim()) return decodeHtmlEntities(quoted[2].trim())

    const unquoted = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*([^\\s>]+)`, 'i'))
    if (unquoted?.[1]?.trim()) return decodeHtmlEntities(unquoted[1].trim())
  }
  return null
}

function scoreQrImage(tag: string, source: string): number {
  const value = `${tag} ${source}`.toLowerCase()
  let score = 0
  if (/qrcode|qr-code|qr_code/.test(value)) score += 100
  if (/\bqr\b|二维码/.test(value)) score += 60
  if (/scan|login|auth/.test(value)) score += 20
  if (source.startsWith('data:image/')) score += 10
  if (/logo|avatar|icon/.test(value)) score -= 30
  return score
}

export function extractQrImageSource(html: string): string | undefined {
  const candidates: Array<{ source: string; score: number; index: number }> = []
  const imagePattern = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  let index = 0

  while ((match = imagePattern.exec(html)) !== null) {
    const source = readImageSource(match[0])
    if (source) {
      candidates.push({ source, score: scoreQrImage(match[0], source), index })
      index += 1
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.index - right.index)
  return candidates[0]?.source
}

export function isHtmlContent(value: string): boolean {
  return /<(?:!doctype\s+html|html|body|img)\b/i.test(value)
}

export function decodeHtmlDataUrl(value: string): string | undefined {
  const match = value.match(/^data:text\/html(?:;charset=[^;,]+)?(;base64)?,(.*)$/is)
  if (!match) return undefined

  try {
    return match[1]
      ? Buffer.from(match[2], 'base64').toString('utf8')
      : decodeURIComponent(match[2])
  } catch {
    return undefined
  }
}

export function normalizeInlineImageSource(
  source: string,
  baseUrl?: string
): string | undefined {
  const value = decodeHtmlEntities(source.trim())
  if (!value) return undefined
  if (value.startsWith('data:image/')) return value
  if (/^https?:\/\//i.test(value)) return value

  if (baseUrl) {
    try {
      return new URL(value, baseUrl).toString()
    } catch {
      return undefined
    }
  }

  if (/^[a-z0-9+/=\r\n]+$/i.test(value) && value.replace(/\s/g, '').length >= 128) {
    return `data:image/png;base64,${value.replace(/\s/g, '')}`
  }

  return undefined
}
