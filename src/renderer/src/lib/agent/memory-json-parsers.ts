// Pure utility functions, constants, and types extracted from memory-automation.ts

import { Allow, parse as parsePartialJSON } from 'partial-json'
import { INVALID_MEMORY_JSON_ERROR } from './memory-automation-utils'
import type { ConsolidationOutput, OrganizationOutput, PipelineScopeOutput } from './memory-automation-utils'
import { rolloutSlugFromSession } from './memory-automation-utils'

export function normalizeJsonTextCandidate(raw: string): string {
  return raw
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|JSON)?\s*/, '')
    .replace(/```$/, '')
    .trim()
}

export function uniqueJsonRepairCandidates(raw: string): string[] {
  const withoutTrailingCommas = raw.replace(/,\s*([}\]])/g, '$1')
  const candidates = [
    raw,
    withoutTrailingCommas,
    withoutTrailingCommas
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
  ]
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]
}

export function extractBalancedJsonSegments(raw: string): string[] {
  const segments: string[] = []
  let start = -1
  let stack: string[] = []
  let inString = false
  let quote = ''
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }
    if (char === '{' || char === '[') {
      if (stack.length === 0) start = index
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if ((char === '}' || char === ']') && stack.length > 0) {
      const expected = stack[stack.length - 1]
      if (char !== expected) {
        start = -1
        stack = []
        continue
      }
      stack.pop()
      if (stack.length === 0 && start >= 0) {
        segments.push(raw.slice(start, index + 1))
        start = -1
      }
    }
  }
  return segments
}

export function collectJsonTextCandidates(raw: string): string[] {
  const candidates = new Set<string>()
  const trimmed = raw.trim()
  if (trimmed) candidates.add(trimmed)
  for (const match of raw.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const fenced = match[1]?.trim()
    if (fenced) candidates.add(fenced)
  }
  for (const segment of extractBalancedJsonSegments(raw)) {
    candidates.add(segment)
  }
  return [...candidates]
}

export function parseJsonTextCandidate(raw: string): unknown | null {
  const candidate = normalizeJsonTextCandidate(raw)
  if (!candidate) return null
  for (const text of uniqueJsonRepairCandidates(candidate)) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      try {
        return parsePartialJSON(text, Allow.ALL) as unknown
      } catch {
        // Continue trying repaired candidates.
      }
    }
  }
  return null
}

export function parseJsonPayload(raw: string): unknown {
  for (const candidate of collectJsonTextCandidates(raw)) {
    const parsed = parseJsonTextCandidate(candidate)
    if (parsed !== null) return parsed
  }
  if (!raw.trim()) return { scope_outputs: [] }
  throw new Error(INVALID_MEMORY_JSON_ERROR)
}

export function parseStage1Json(raw: string, sessionId: string): PipelineScopeOutput[] {
  const parsed = parseJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') return []
  const scopeOutputs = (parsed as { scope_outputs?: unknown }).scope_outputs
  if (!Array.isArray(scopeOutputs)) return []
  const outputs: PipelineScopeOutput[] = []
  for (const item of scopeOutputs) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const scope = record.scope === 'project' ? 'project' : record.scope === 'global' ? 'global' : null
    if (!scope) continue
    const rawMemory = typeof record.raw_memory === 'string' ? record.raw_memory.trim() : ''
    const rolloutSummary =
      typeof record.rollout_summary === 'string' ? record.rollout_summary.trim() : ''
    const rolloutSlug =
      typeof record.rollout_slug === 'string' && record.rollout_slug.trim()
        ? record.rollout_slug.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)
        : rolloutSlugFromSession(sessionId, scope)
    if (!rawMemory && !rolloutSummary) continue
    outputs.push({
      scope,
      rawMemory,
      rolloutSummary: rolloutSummary || rawMemory.slice(0, 500),
      rolloutSlug
    })
  }
  return outputs
}

export function parseConsolidationJson(raw: string): ConsolidationOutput | null {
  const parsed = parseJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const output: ConsolidationOutput = {}
  if (typeof record.user_markdown === 'string') output.userMarkdown = record.user_markdown
  if (typeof record.memory_markdown === 'string') output.memoryMarkdown = record.memory_markdown
  if (typeof record.summary_markdown === 'string') output.summaryMarkdown = record.summary_markdown
  if (Array.isArray(record.written_items)) {
    output.writtenItems = record.written_items.filter((item): item is string => typeof item === 'string')
  }
  return output
}

export function parseOrganizationJson(raw: string): OrganizationOutput | null {
  const parsed = parseJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const output: OrganizationOutput = {}
  if (typeof record.memory_markdown === 'string') output.memoryMarkdown = record.memory_markdown
  if (Array.isArray(record.outdated_paragraphs)) {
    output.outdatedParagraphs = record.outdated_paragraphs.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    )
  }
  if (typeof record.organization_summary === 'string') {
    output.organizationSummary = record.organization_summary
  }
  return output
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
