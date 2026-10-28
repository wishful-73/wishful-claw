/**
 * 浏览器工具卡的取值与摘要逻辑（纯函数，无 JSX）。
 *
 * S-250 从 `BrowserToolCard.tsx` 搬出，函数体逐字平移。
 */

import type { TextBlock, ToolResultContent } from '@renderer/lib/api/types'
import {
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_GET_CONTENT_TOOL_NAME,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_SNAPSHOT_TOOL_NAME,
  BROWSER_TYPE_TOOL_NAME
} from '@renderer/lib/app-plugin/types'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import type { ToolCallStatus } from '@renderer/lib/agent/types'

export const PREVIEW_LIMIT = 12000

export function parseStructuredOutput(
  output: ToolResultContent | undefined
): Record<string, unknown> | null {
  if (typeof output !== 'string') return null
  const parsed = decodeStructuredToolResult(output)
  return parsed && !Array.isArray(parsed) ? parsed : null
}

export function parseErrorMessage(output: ToolResultContent | undefined): string | null {
  if (typeof output !== 'string') return null
  const parsed = decodeStructuredToolResult(output)
  if (parsed && !Array.isArray(parsed) && typeof parsed.error === 'string' && parsed.error.trim()) {
    return parsed.error
  }
  // Only an explicit `error` field counts as a failure. The raw output is a
  // successful payload (structured JSON object) most of the time — treating it
  // as an error message marked every successful call as failed.
  return null
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function compactText(value: string, limit = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1).trimEnd()}...`
}

export function compactUrl(value: string): string {
  if (!value) return ''
  try {
    const parsed = new URL(value)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname}${path}` || value
  } catch {
    return value
  }
}

export function previewText(value: string): { text: string; truncated: boolean } {
  if (value.length <= PREVIEW_LIMIT) return { text: value, truncated: false }
  return { text: value.slice(0, PREVIEW_LIMIT), truncated: true }
}

export function lineCount(value: string): number {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}

export function buildSummary(
  name: string,
  input: Record<string, unknown>,
  jsonOutput: Record<string, unknown> | null,
  notes: TextBlock[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (name === BROWSER_NAVIGATE_TOOL_NAME) {
    const action = stringValue(input.action) || 'goto'
    const url = stringValue(jsonOutput?.url) || stringValue(input.url)
    return url ? `${action}: ${compactUrl(url)}` : action
  }

  if (name === BROWSER_GET_CONTENT_TOOL_NAME) {
    const content = stringValue(jsonOutput?.content)
    const type = stringValue(jsonOutput?.type) || stringValue(input.type) || 'markdown'
    return content
      ? t('toolCall.browser.summary.content', {
          type,
          count: content.length,
          defaultValue: `${type} · ${content.length} chars`
        })
      : type
  }

  if (name === BROWSER_SCREENSHOT_TOOL_NAME) {
    const match = notes[0]?.text.match(/(\d+)x(\d+)px/)
    return match
      ? t('toolCall.browser.summary.screenshot', {
          width: match[1],
          height: match[2],
          defaultValue: `${match[1]} × ${match[2]}`
        })
      : t('toolCall.browser.summary.image', { defaultValue: 'image' })
  }

  if (name === BROWSER_SNAPSHOT_TOOL_NAME) {
    const count = numberValue(jsonOutput?.elementCount)
    return count !== null
      ? t('toolCall.browser.summary.elements', {
          count,
          defaultValue: `${count} elements`
        })
      : t('toolCall.browser.summary.snapshot', { defaultValue: 'interactive elements' })
  }

  if (name === BROWSER_CLICK_TOOL_NAME) {
    return compactText(stringValue(jsonOutput?.clicked) || stringValue(input.selector) || name)
  }

  if (name === BROWSER_TYPE_TOOL_NAME) {
    const selector = compactText(stringValue(input.selector))
    const submit = input.submit === true
    return submit
      ? t('toolCall.browser.summary.typeSubmit', {
          selector,
          defaultValue: selector ? `${selector} · submit` : 'submit'
        })
      : selector || t('toolCall.browser.summary.type', { defaultValue: 'type text' })
  }

  if (name === BROWSER_SCROLL_TOOL_NAME) {
    const scrollY = numberValue(jsonOutput?.scrollY)
    if (scrollY !== null) {
      return t('toolCall.browser.summary.scrollY', {
        value: scrollY,
        defaultValue: `Y ${scrollY}`
      })
    }
    const direction = stringValue(input.direction) || 'down'
    const amount = numberValue(input.amount)
    return amount !== null ? `${direction} ${amount}px` : direction
  }

  return name
}

export function getMainPreview(
  name: string,
  jsonOutput: Record<string, unknown> | null
): { labelKey: string; fallbackLabel: string; content: string; truncated: boolean } | null {
  if (!jsonOutput) return null

  if (name === BROWSER_GET_CONTENT_TOOL_NAME) {
    const content = stringValue(jsonOutput.content)
    if (!content) return null
    const preview = previewText(content)
    return {
      labelKey: 'toolCall.browser.contentPreview',
      fallbackLabel: 'Content preview',
      content: preview.text,
      truncated: preview.truncated
    }
  }

  if (name === BROWSER_SNAPSHOT_TOOL_NAME) {
    const elements = stringValue(jsonOutput.elements)
    if (!elements) return null
    const preview = previewText(elements)
    return {
      labelKey: 'toolCall.browser.elementsPreview',
      fallbackLabel: 'Elements',
      content: preview.text,
      truncated: preview.truncated
    }
  }

  return null
}

export function getResultRows(
  name: string,
  jsonOutput: Record<string, unknown> | null
): Array<{ labelKey: string; fallbackLabel: string; value: string }> {
  if (!jsonOutput) return []
  const rows: Array<{ labelKey: string; fallbackLabel: string; value: string }> = []

  const add = (labelKey: string, fallbackLabel: string, value: unknown): void => {
    const text =
      typeof value === 'number'
        ? String(value)
        : typeof value === 'boolean'
          ? String(value)
          : stringValue(value)
    if (text) rows.push({ labelKey, fallbackLabel, value: text })
  }

  if (name === BROWSER_NAVIGATE_TOOL_NAME || name === BROWSER_GET_CONTENT_TOOL_NAME) {
    add('toolCall.browser.fields.title', 'Title', jsonOutput.title)
    add('toolCall.browser.fields.url', 'URL', jsonOutput.url)
    add('toolCall.browser.fields.type', 'Type', jsonOutput.type)
  } else if (name === BROWSER_CLICK_TOOL_NAME) {
    add('toolCall.browser.fields.clicked', 'Clicked', jsonOutput.clicked)
  } else if (name === BROWSER_TYPE_TOOL_NAME) {
    add('toolCall.browser.fields.element', 'Element', jsonOutput.element)
    add('toolCall.browser.fields.value', 'Value', jsonOutput.value)
  } else if (name === BROWSER_SCROLL_TOOL_NAME) {
    add('toolCall.browser.fields.scrollY', 'Scroll Y', jsonOutput.scrollY)
    add('toolCall.browser.fields.scrollHeight', 'Scroll Height', jsonOutput.scrollHeight)
    add('toolCall.browser.fields.viewport', 'Viewport', jsonOutput.viewportHeight)
  } else if (name === BROWSER_SNAPSHOT_TOOL_NAME) {
    add('toolCall.browser.fields.title', 'Title', jsonOutput.title)
    add('toolCall.browser.fields.url', 'URL', jsonOutput.url)
    add('toolCall.browser.fields.elements', 'Elements', jsonOutput.elementCount)
  }

  return rows
}

export function statusLabel(
  status: ToolCallStatus | 'completed',
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (status === 'streaming') return t('toolCall.receivingArgs')
  if (status === 'running') return t('toolCall.executing')
  if (status === 'pending_approval') return t('permission.title')
  if (status === 'error') return t('error.label')
  if (status === 'canceled') return t('toolCall.canceled', { defaultValue: 'Canceled' })
  return null
}
