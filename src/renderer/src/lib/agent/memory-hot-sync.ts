// Hot → DB memory mirror (iter-33 S-93).
//
// Recall (MemoryRecallService) reads SQLite `memory_entries` only, while the nightly
// organization pass used to write *just* the paragraphs it retired — live memories never
// reached the retrieval source, so recall could only ever surface the backlog. This module
// mirrors the surviving MEMORY.md paragraphs into the DB tier, skipping rows already there.

import { memoryAppend, memoryEntries } from '@renderer/stores/chat-store/memory-helpers'
import { normalizeMemoryText } from './memory-automation-utils'

/** Paragraphs shorter than this are template filler, not memories. */
const MIN_DB_SYNC_CHARS = 24

/** How many existing entries to scan for duplicates before mirroring. */
const DB_SYNC_SCAN_LIMIT = 500

/**
 * Pulls the durable paragraphs out of a MEMORY.md document. Heading-only blocks and the
 * leftover template filler are dropped so only real memories get mirrored.
 */
export function extractHotParagraphs(markdown: string): string[] {
  return markdown
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => !/^\s*#{1,6}\s/.test(line))
        .join('\n')
        .trim()
    )
    .filter((block) => normalizeMemoryText(block).length >= MIN_DB_SYNC_CHARS)
}

export interface HotMirrorArgs {
  scope: 'project' | 'global'
  markdown: string
  workingFolder?: string | null
  projectId?: string | null
  sshConnectionId?: string | null
}

/**
 * Mirrors the *current* MEMORY.md paragraphs into `memory_entries`.
 *
 * Existing rows are matched with the same normalisation the rest of the memory pipeline uses,
 * so re-running is a no-op instead of a duplicate. A partial failure returns the number it did
 * write plus the reason, leaving the caller free to keep going — the hot file stays the source
 * of truth and the next run retries.
 */
export function mirrorHotParagraphsToDb(args: HotMirrorArgs): Promise<{
  count: number
  error?: string
}> {
  return runMirror(args)
}

async function runMirror(args: HotMirrorArgs): Promise<{ count: number; error?: string }> {
  const paragraphs = extractHotParagraphs(args.markdown)
  if (paragraphs.length === 0) return { count: 0 }

  const existing = await memoryEntries(
    args.scope,
    args.workingFolder ?? undefined,
    DB_SYNC_SCAN_LIMIT,
    args.projectId,
    args.sshConnectionId
  )
  const known = (existing.entries ?? [])
    .map((entry) => normalizeMemoryText(entry.content))
    .filter(Boolean)

  let count = 0
  for (const paragraph of paragraphs) {
    const normalized = normalizeMemoryText(paragraph)
    if (!normalized) continue
    if (known.some((item) => item.includes(normalized) || normalized.includes(item))) continue
    try {
      const appended = await memoryAppend(
        args.scope,
        paragraph,
        'standard',
        args.workingFolder ?? undefined,
        { projectId: args.projectId, sshConnectionId: args.sshConnectionId }
      )
      if (!appended.ok) {
        return { count, error: appended.error ?? 'Failed to mirror a hot paragraph into FTS' }
      }
      known.push(normalized)
      count += 1
    } catch (error) {
      return { count, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { count }
}
