import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import type {
  WidgetToolPayload,
  SearchOutputMeta,
  ParsedGrepEntry,
  LsEntry,
  SearchVisualState
} from './types'
import { WIDGET_BRIDGE_SOURCE } from './types'
import { isRecord } from './utils'

// ── Record / equality helpers ──

// Extracted from ToolCallCard/utils.ts
export function normalizeSearchMeta(decoded: unknown): SearchOutputMeta {
  if (!isRecord(decoded)) {
    return { truncated: false, timedOut: false, warnings: [] }
  }
  const rawMeta = isRecord(decoded.meta) ? decoded.meta : null
  const rawEngine = decoded.engine ?? rawMeta?.engine
  return {
    engine: typeof rawEngine === 'string' ? rawEngine : undefined,
    truncated: decoded.truncated === true,
    timedOut: decoded.timedOut === true,
    limitReason: typeof decoded.limitReason === 'string' ? decoded.limitReason : null,
    warnings: Array.isArray(decoded.warnings)
      ? decoded.warnings.filter(
          (item): item is string => typeof item === 'string' && item.length > 0
        )
      : [],
    error: typeof decoded.error === 'string' ? decoded.error : undefined
  }
}

export function formatSearchEngineLabel(engine: string | undefined): string | null {
  if (!engine) return null
  if (engine === 'git_grep') return 'git grep'
  if (engine === 'ripgrep') return 'ripgrep'
  if (engine === 'native_aot') return '.NET native'
  if (engine === 'node' || engine.startsWith('node_')) return 'legacy local search'
  if (engine === 'remote_rg') return 'remote rg'
  if (engine === 'remote_grep') return 'remote grep'
  return engine
}

export function parseLegacyGrepMatch(value: unknown): ParsedGrepEntry | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(.+?)([:-])(\d+)\2(?:(\d+)\2)?(.*)$/)
  if (!match) return null
  return {
    file: match[1],
    line: Number(match[3]),
    column: match[4] ? Number(match[4]) : undefined,
    text: match[5] ?? '',
    kind: match[2] === '-' ? 'context' : 'match'
  }
}

export function parseGrepTextMatches(text: string): ParsedGrepEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => parseLegacyGrepMatch(line))
    .filter((item): item is ParsedGrepEntry => !!item)
}

export function getSearchVisualState(meta: SearchOutputMeta, matchCount: number): SearchVisualState {
  if (meta.error) return 'error'
  if (meta.truncated || meta.timedOut || meta.warnings.length > 0) return 'warning'
  if (matchCount > 0) return 'found'
  return 'empty'
}

export function parseGrepOutput(output: string): {
  matches: ParsedGrepEntry[]
  meta: SearchOutputMeta
  output?: string
} | null {
  const decoded = decodeStructuredToolResult(output)
  if (!decoded) {
    const matches = parseGrepTextMatches(output)
    if (matches.length === 0 && output.trim().length === 0) return null
    return {
      matches,
      meta: { truncated: false, timedOut: false, warnings: [] },
      output
    }
  }

  if (Array.isArray(decoded)) {
    return {
      matches: decoded
        .map((item) => {
          const legacyMatch = parseLegacyGrepMatch(item)
          if (legacyMatch) return legacyMatch
          if (!isRecord(item)) return null
          const file =
            typeof item.file === 'string'
              ? item.file
              : typeof item.path === 'string'
                ? item.path
                : null
          const line = typeof item.line === 'number' ? item.line : null
          const column = typeof item.column === 'number' ? item.column : undefined
          const text = typeof item.text === 'string' ? item.text : ''
          const count = typeof item.count === 'number' ? item.count : undefined
          if (!file) return null
          if (line == null && count === undefined) return { file, text }
          return { file, line: line ?? undefined, column, text, count }
        })
        .filter((item): item is ParsedGrepEntry => !!item),
      meta: { truncated: false, timedOut: false, warnings: [] }
    }
  }

  if (!isRecord(decoded)) return null
  const rawOutput = typeof decoded.output === 'string' ? decoded.output : undefined
  const matchesSource = Array.isArray(decoded.matches)
    ? decoded.matches
    : Array.isArray(decoded.results)
      ? decoded.results
      : []

  const parsedMatches = matchesSource
    .map((item) => {
      const legacyMatch = parseLegacyGrepMatch(item)
      if (legacyMatch) return legacyMatch
      if (!isRecord(item)) return null
      const file =
        typeof item.file === 'string' ? item.file : typeof item.path === 'string' ? item.path : null
      const line = typeof item.line === 'number' ? item.line : null
      const column = typeof item.column === 'number' ? item.column : undefined
      const text = typeof item.text === 'string' ? item.text : ''
      const count = typeof item.count === 'number' ? item.count : undefined
      if (!file) return null
      if (line == null && count === undefined) {
        return {
          file,
          text,
          kind: item.kind === 'context' ? 'context' : 'match'
        }
      }
      return {
        file,
        line: line ?? undefined,
        column,
        text,
        count,
        kind: item.kind === 'context' ? 'context' : 'match'
      }
    })
    .filter((item): item is ParsedGrepEntry => !!item)
  const outputMatches =
    parsedMatches.length === 0 && rawOutput ? parseGrepTextMatches(rawOutput) : []

  return {
    matches: parsedMatches.length > 0 ? parsedMatches : outputMatches,
    meta: normalizeSearchMeta(decoded),
    output: rawOutput
  }
}

export function parseGlobOutput(output: string): { matches: string[]; meta: SearchOutputMeta } | null {
  const decoded = decodeStructuredToolResult(output)
  if (!decoded) return null

  if (Array.isArray(decoded)) {
    return {
      matches: decoded.filter((item): item is string => typeof item === 'string'),
      meta: { truncated: false, timedOut: false, warnings: [] }
    }
  }

  if (!isRecord(decoded)) return null
  const matchesSource = Array.isArray(decoded.matches)
    ? decoded.matches
    : Array.isArray(decoded.results)
      ? decoded.results
      : []

  return {
    matches: matchesSource
      .map((item) => {
        if (typeof item === 'string') return item
        if (isRecord(item) && typeof item.path === 'string') return item.path
        return null
      })
      .filter((item): item is string => !!item),
    meta: normalizeSearchMeta(decoded)
  }
}

export function parseLsEntries(output: string | undefined): LsEntry[] | null {
  if (!output?.trim()) return null
  const decoded = decodeStructuredToolResult(output)
  if (!Array.isArray(decoded)) return null
  return decoded
    .map((entry): LsEntry | null => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.type !== 'string') {
        return null
      }
      return {
        name: entry.name,
        type: entry.type,
        path: typeof entry.path === 'string' ? entry.path : undefined
      }
    })
    .filter((entry): entry is LsEntry => !!entry)
}

// ── Structured input formatting ──

export function formatPrimitiveInputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 80)}...` : value
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === null
  ) {
    return String(value)
  }
  return value === undefined ? 'undefined' : typeof value
}

export function formatStructuredInputValue(value: unknown): { text: string; mono: boolean } {
  if (typeof value === 'string') {
    const text =
      value.length > 300
        ? `${value.slice(0, 300)}... (${value.length} chars)`
        : value
    return { text, mono: false }
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === null
  ) {
    return { text: String(value), mono: true }
  }

  if (Array.isArray(value)) {
    const preview = value.slice(0, 6).map(formatPrimitiveInputValue)
    const suffix = value.length > 6 ? ', ...' : ''
    return {
      text: preview.length > 0 ? `[${preview.join(', ')}${suffix}] (${value.length} items)` : '[]',
      mono: true
    }
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    const visibleKeys = keys.slice(0, 12)
    const suffix = keys.length > 12 ? ', ...' : ''
    return {
      text:
        visibleKeys.length > 0
          ? `{ ${visibleKeys.join(', ')}${suffix} } (${keys.length} keys)`
          : '{}',
      mono: true
    }
  }

  return { text: String(value), mono: true }
}

// ── Widget helpers ──

export function normalizeWidgetPayload(input: Record<string, unknown>): WidgetToolPayload | null {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const rawCode =
    typeof input.widget_code === 'string'
      ? input.widget_code
      : typeof input.widget_code_preview === 'string'
        ? input.widget_code_preview
        : ''
  const widgetCode = rawCode.trimStart()
  const loadingMessages = Array.isArray(input.loading_messages)
    ? input.loading_messages
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  const explicitKind =
    input.widget_kind === 'svg' || input.widget_kind === 'html' ? input.widget_kind : null

  if (!title && !widgetCode.trim()) return null

  return {
    title: title || 'widget',
    loadingMessages,
    widgetCode,
    kind: explicitKind ?? (/^<svg[\s>]/i.test(widgetCode) ? 'svg' : 'html')
  }
}

export interface WidgetAppearance {
  /** Opaque background for the widget document (host background colour). */
  bg: string
  colorScheme: 'light' | 'dark'
}

export function buildWidgetDocument(
  payload: WidgetToolPayload,
  appearance: WidgetAppearance = { bg: '#ffffff', colorScheme: 'light' }
): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        /* Opaque host background: widgets are authored assuming a real canvas —
           transparent + dark host made them render murky ("black text on dark grey"). */
        background: ${JSON.stringify(appearance.bg)};
      }
      html {
        color-scheme: ${JSON.stringify(appearance.colorScheme)};
      }
      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: ${appearance.colorScheme === 'dark' ? '#e5e7eb' : '#1f2328'};
        overflow: hidden;
      }
      #wishful-claw-widget-root {
        width: 100%;
        background: transparent !important;
      }
      ${payload.kind === 'svg' ? '#wishful-claw-widget-root { display: block; overflow: hidden; line-height: 0; font-size: 0; } #wishful-claw-widget-root > svg { display: block; width: 100%; height: auto; margin: 0; background: transparent !important; overflow: hidden; }' : ''}
    </style>
    <script>
      (() => {
        const bridgeSource = ${JSON.stringify(WIDGET_BRIDGE_SOURCE)};
        const post = (type, extra = {}) => {
          window.parent.postMessage({ source: bridgeSource, type, ...extra }, '*');
        };
        const getBoundingHeight = (element) => {
          if (!element) return 0;
          return element.getBoundingClientRect?.().height || 0;
        };
        const getContentHeight = (element) => {
          if (!element) return 0;
          return Math.max(
            getBoundingHeight(element),
            element.scrollHeight || 0,
            element.offsetHeight || 0
          );
        };
        const reportSize = () => {
          const root = document.getElementById('wishful-claw-widget-root');
          const content = root?.firstElementChild;
          const nextHeight =
            getBoundingHeight(content) ||
            getBoundingHeight(root) ||
            getContentHeight(root) ||
            getBoundingHeight(document.body) ||
            getContentHeight(document.body);
          post('resize', { height: Math.max(nextHeight, 32) });
        };
        let lastAppliedCode = '';

        const executeInsertedScripts = (root) => {
          const scripts = Array.from(root.querySelectorAll('script'));
          for (const script of scripts) {
            const next = document.createElement('script');
            for (const attr of Array.from(script.attributes)) {
              next.setAttribute(attr.name, attr.value);
            }
            next.text = script.textContent || '';
            script.replaceWith(next);
          }
        };

        const applyWidgetCode = (code) => {
          if (typeof code !== 'string' || code === lastAppliedCode) return;
          lastAppliedCode = code;
          const root = document.getElementById('wishful-claw-widget-root');
          if (!root) return;
          root.innerHTML = code;
          executeInsertedScripts(root);
          reportSize();
          window.requestAnimationFrame(reportSize);
          setTimeout(reportSize, 80);
          setTimeout(reportSize, 240);
        };

        window.sendPrompt = (text) => {
          if (typeof text !== 'string') return;
          const trimmed = text.trim();
          if (!trimmed) return;
          post('send_prompt', { text: trimmed });
        };

        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || typeof data !== 'object') return;
          if (data.source !== bridgeSource || data.type !== 'update_code') return;
          applyWidgetCode(data.code);
        });

        window.__wishfulClawWidgetReady = () => {
          const root = document.getElementById('wishful-claw-widget-root');
          if (typeof ResizeObserver !== 'undefined' && root) {
            const observer = new ResizeObserver(() => reportSize());
            observer.observe(root);
          }
          post('ready');
          reportSize();
          window.requestAnimationFrame(reportSize);
          setTimeout(reportSize, 120);
          setTimeout(reportSize, 360);
        };
      })();
    </script>
  </head>
  <body>
    <div id="wishful-claw-widget-root"></div>
    <script>window.__wishfulClawWidgetReady && window.__wishfulClawWidgetReady();</script>
  </body>
</html>`
}
