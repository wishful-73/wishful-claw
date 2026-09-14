import { translateOr } from './i18n-text'

export type SelectFileTextSegment =
  | {
      type: 'text' | 'file'
      text: string
      raw: string
    }
  | {
      type: 'plugin'
      text: string
      raw: string
      pluginId: string
      label: string
      prompt: string
    }
  | {
      type: 'pasted'
      text: string
      raw: string
      label: string
      pastedText: string
    }

export interface SelectFileMentionQuery {
  start: number
  end: number
  query: string
}

export interface SelectFileTagRange {
  start: number
  end: number
  text: string
  raw: string
  syntax: 'tag' | 'token' | 'plugin' | 'pasted'
  pluginId?: string
  label?: string
  prompt?: string
  pastedText?: string
}

const SELECT_FILE_TAG_RE = /<select-file>([\s\S]*?)<\/select-file>/gi
const SELECT_PLUGIN_TAG_RE = /<select-plugin>([\s\S]*?)<\/select-plugin>/gi
const PASTED_BLOCK_TAG_RE = /<pasted-block>([\s\S]*?)<\/pasted-block>/gi
const SELECT_FILE_TOKEN_RE = /@\{([^}\r\n]+)\}/g
const SELECT_FILE_TAG_TEST_RE = /<select-file>[\s\S]*?<\/select-file>/i
const SELECT_FILE_TOKEN_TEST_RE = /@\{[^}\r\n]+\}/
const SELECT_PLUGIN_TAG_TEST_RE = /<select-plugin>[\s\S]*?<\/select-plugin>/i
const PASTED_BLOCK_TAG_TEST_RE = /<pasted-block>[\s\S]*?<\/pasted-block>/i

export interface SelectPluginPayload {
  pluginId: string
  label: string
  prompt: string
}

/** Payload of a collapsed long-paste chip: the label shown and the verbatim text. */
export interface PastedBlockPayload {
  label: string
  text: string
}

function decodeTagText(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function encodeTagText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, '/').trim()
}

function normalizePluginPayload(value: Partial<SelectPluginPayload>): SelectPluginPayload | null {
  const pluginId = String(value.pluginId ?? '').trim()
  if (!pluginId) return null
  const label = String(value.label ?? pluginId).trim() || pluginId
  const prompt = String(value.prompt ?? '').trim()
  if (!prompt) return null
  return { pluginId, label, prompt }
}

function parsePluginPayload(value: string): SelectPluginPayload | null {
  try {
    const parsed = JSON.parse(decodeTagText(value)) as Partial<SelectPluginPayload>
    return normalizePluginPayload(parsed)
  } catch {
    return null
  }
}

function collectSelectFileRanges(text: string): SelectFileTagRange[] {
  if (!text) return []

  const ranges: SelectFileTagRange[] = []

  for (const match of text.matchAll(SELECT_FILE_TAG_RE)) {
    const start = match.index ?? -1
    const raw = match[0] ?? ''
    if (start < 0 || !raw) continue
    ranges.push({
      start,
      end: start + raw.length,
      raw,
      text: normalizeFilePath(decodeTagText(match[1] ?? '')),
      syntax: 'tag'
    })
  }

  for (const match of text.matchAll(SELECT_PLUGIN_TAG_RE)) {
    const start = match.index ?? -1
    const raw = match[0] ?? ''
    if (start < 0 || !raw) continue
    const payload = parsePluginPayload(match[1] ?? '')
    if (!payload) continue
    ranges.push({
      start,
      end: start + raw.length,
      raw,
      text: payload.label,
      syntax: 'plugin',
      pluginId: payload.pluginId,
      label: payload.label,
      prompt: payload.prompt
    })
  }

  for (const match of text.matchAll(PASTED_BLOCK_TAG_RE)) {
    const start = match.index ?? -1
    const raw = match[0] ?? ''
    if (start < 0 || !raw) continue
    const payload = parsePastedBlockPayload(match[1] ?? '')
    if (!payload) continue
    ranges.push({
      start,
      end: start + raw.length,
      raw,
      text: payload.label,
      syntax: 'pasted',
      label: payload.label,
      pastedText: payload.text
    })
  }

  for (const match of text.matchAll(SELECT_FILE_TOKEN_RE)) {
    const start = match.index ?? -1
    const raw = match[0] ?? ''
    if (start < 0 || !raw) continue
    ranges.push({
      start,
      end: start + raw.length,
      raw,
      text: normalizeFilePath(match[1] ?? ''),
      syntax: 'token'
    })
  }

  ranges.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    return left.end - right.end
  })

  const merged: SelectFileTagRange[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start < previous.end) continue
    if (!range.text) continue
    merged.push(range)
  }

  return merged
}

export function createSelectFileTag(filePath: string): string {
  const normalized = normalizeFilePath(filePath)
  if (!normalized) return ''
  return `<select-file>${encodeTagText(normalized)}</select-file>`
}

export function createSelectFileToken(filePath: string): string {
  const normalized = normalizeFilePath(filePath)
  if (!normalized || normalized.includes('}')) return ''
  return `@{${normalized}}`
}

export function createSelectPluginTag(payload: SelectPluginPayload): string {
  const normalized = normalizePluginPayload(payload)
  if (!normalized) return ''
  return `<select-plugin>${encodeTagText(JSON.stringify(normalized))}</select-plugin>`
}

function normalizePastedBlockPayload(
  value: Partial<PastedBlockPayload>
): PastedBlockPayload | null {
  const text = String(value.text ?? '')
  if (!text) return null
  const label = String(value.label ?? '').trim() || buildPastedBlockLabel(text)
  return { label, text }
}

/** Human label for a collapsed paste, e.g. "粘贴 · 42 行". */
export function buildPastedBlockLabel(text: string): string {
  const lines = text.split(/\r?\n/).length
  if (lines > 1) {
    return translateOr(
      'input.pastedBlock.labelWithLines',
      { ns: 'chat', lines },
      `粘贴 · ${lines} 行`
    )
  }
  return translateOr('input.pastedBlock.label', { ns: 'chat' }, '粘贴')
}

function parsePastedBlockPayload(value: string): PastedBlockPayload | null {
  try {
    const parsed = JSON.parse(decodeTagText(value)) as Partial<PastedBlockPayload>
    return normalizePastedBlockPayload(parsed)
  } catch {
    return null
  }
}

export function createPastedBlockTag(payload: PastedBlockPayload): string {
  const normalized = normalizePastedBlockPayload(payload)
  if (!normalized) return ''
  return `<pasted-block>${encodeTagText(JSON.stringify(normalized))}</pasted-block>`
}

export function parseSelectFileText(text: string): SelectFileTextSegment[] {
  if (!text) return []

  const segments: SelectFileTextSegment[] = []
  let lastIndex = 0

  for (const range of collectSelectFileRanges(text)) {
    if (range.start > lastIndex) {
      const plainText = text.slice(lastIndex, range.start)
      if (plainText) {
        segments.push({ type: 'text', text: plainText, raw: plainText })
      }
    }

    if (range.syntax === 'plugin' && range.pluginId && range.label && range.prompt) {
      segments.push({
        type: 'plugin',
        text: range.label,
        raw: range.raw,
        pluginId: range.pluginId,
        label: range.label,
        prompt: range.prompt
      })
    } else if (range.syntax === 'pasted' && range.label && range.pastedText) {
      segments.push({
        type: 'pasted',
        text: range.label,
        raw: range.raw,
        label: range.label,
        pastedText: range.pastedText
      })
    } else {
      segments.push({
        type: 'file',
        text: range.text,
        raw: range.raw
      })
    }

    lastIndex = range.end
  }

  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex)
    if (plainText) {
      segments.push({ type: 'text', text: plainText, raw: plainText })
    }
  }

  return segments
}

export function getSelectFileTagRanges(text: string): SelectFileTagRange[] {
  return collectSelectFileRanges(text)
}

export function hasSelectFileTag(text: string): boolean {
  return (
    SELECT_FILE_TAG_TEST_RE.test(text) ||
    SELECT_FILE_TOKEN_TEST_RE.test(text) ||
    SELECT_PLUGIN_TAG_TEST_RE.test(text) ||
    PASTED_BLOCK_TAG_TEST_RE.test(text)
  )
}

export function selectFileTextToPlainText(text: string): string {
  const segments = parseSelectFileText(text)
  if (segments.length === 0) return text
  return segments.map((segment) => segment.text).join('')
}

export function normalizeSelectFileText(text: string): string {
  if (!text) return ''
  const segments = parseSelectFileText(text)
  if (segments.length === 0) return text
  return segments
    .map((segment) => {
      if (segment.type === 'file') return createSelectFileToken(segment.text)
      return segment.raw
    })
    .join('')
}

export function serializeSelectFileText(text: string): string {
  if (!text) return ''
  const segments = parseSelectFileText(text)
  if (segments.length === 0) return text
  return segments
    .map((segment) => {
      if (segment.type === 'file') return createSelectFileTag(segment.text)
      if (segment.type === 'plugin') return createSelectPluginTag(segment)
      return segment.raw
    })
    .join('')
}

export function findSelectFileTagAt(text: string, cursor: number): SelectFileTagRange | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  for (const range of collectSelectFileRanges(text)) {
    if (safeCursor > range.start && safeCursor < range.end) {
      return range
    }
  }
  return null
}

export function getSelectFileMentionQuery(
  text: string,
  cursor: number
): SelectFileMentionQuery | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  if (findSelectFileTagAt(text, safeCursor)) return null

  let mentionStart = -1

  for (let index = safeCursor - 1; index >= 0; index -= 1) {
    const char = text[index]
    if (/\s/.test(char)) break
    if (char === '}' || char === '<' || char === '>') return null
    if (char === '@') {
      if (text[index + 1] === '{') return null
      mentionStart = index
      break
    }
  }

  if (mentionStart < 0) return null

  const prefixChar = mentionStart > 0 ? text[mentionStart - 1] : ''
  if (prefixChar && /[A-Za-z0-9_./\\-]/.test(prefixChar)) {
    return null
  }

  return {
    start: mentionStart,
    end: safeCursor,
    query: text.slice(mentionStart + 1, safeCursor)
  }
}
