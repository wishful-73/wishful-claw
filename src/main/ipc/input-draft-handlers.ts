/**
 * Input draft persistence (input-draft:* channels).
 *
 * Drafts live in a single JSON map at ~/.wishful-claw/input-drafts.json
 * (or $WISHFULCLAW_DATA_DIR for isolated smoke runs), keyed by draftKey
 * (`session:*` / `project:*` / `home:*`). Each entry keeps the composer
 * draft plus an updatedAt timestamp consumed by list/cleanup.
 */
import * as fs from 'fs'
import * as os from 'os'
import { dirname, join } from 'path'
import { registerMessagePackHandler } from './messagepack-handler'
import type { InputDraftSetArgs, InputDraftValue } from '../../shared/input-draft-types'

interface StoredInputDraft {
  draft: InputDraftValue
  updatedAt: number
}

type InputDraftFile = Record<string, StoredInputDraft>

const DRAFT_FILE_NAME = 'input-drafts.json'
const CLEANUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function getDraftFilePath(): string {
  const isolatedDataDirectory = process.env.WISHFULCLAW_DATA_DIR?.trim()
  const dataDirectory = isolatedDataDirectory || join(os.homedir(), '.wishful-claw')
  return join(dataDirectory, DRAFT_FILE_NAME)
}

function readDraftFile(): InputDraftFile {
  try {
    const raw = fs.readFileSync(getDraftFilePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const file: InputDraftFile = {}
    for (const [draftKey, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const stored = entry as { draft?: unknown; updatedAt?: unknown }
      const draft = stored.draft
      if (!draft || typeof draft !== 'object') continue
      file[draftKey] = {
        draft: normalizeDraft(draft as Partial<InputDraftValue>),
        updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : 0
      }
    }
    return file
  } catch {
    return {}
  }
}

function writeDraftFile(file: InputDraftFile): void {
  const filePath = getDraftFilePath()
  fs.mkdirSync(dirname(filePath), { recursive: true })
  // Atomic replace: write to a temp file first so a crash mid-write can
  // never truncate the real draft store.
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(file), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function normalizeDraft(draft: Partial<InputDraftValue>): InputDraftValue {
  return {
    text: typeof draft.text === 'string' ? draft.text : '',
    images: Array.isArray(draft.images) ? draft.images : [],
    skill: typeof draft.skill === 'string' ? draft.skill : null,
    selectedFiles: Array.isArray(draft.selectedFiles) ? draft.selectedFiles : []
  }
}

function hasDraftContent(draft: InputDraftValue): boolean {
  return (
    draft.text.length > 0 ||
    draft.images.length > 0 ||
    draft.selectedFiles.length > 0 ||
    draft.skill !== null
  )
}

function cleanupExpiredDrafts(): number {
  const file = readDraftFile()
  const cutoff = Date.now() - CLEANUP_MAX_AGE_MS
  let removed = 0
  for (const [draftKey, entry] of Object.entries(file)) {
    if (entry.updatedAt < cutoff) {
      delete file[draftKey]
      removed += 1
    }
  }
  if (removed > 0) writeDraftFile(file)
  return removed
}

export function registerInputDraftHandlers(): void {
  registerMessagePackHandler<{ draftKey: string }, InputDraftValue | null>(
    'input-draft:get',
    ({ draftKey }) => {
      if (typeof draftKey !== 'string' || !draftKey) return null
      return readDraftFile()[draftKey]?.draft ?? null
    }
  )

  registerMessagePackHandler<InputDraftSetArgs, { success: boolean }>(
    'input-draft:set',
    ({ draftKey, draft }) => {
      if (typeof draftKey !== 'string' || !draftKey || !draft || typeof draft !== 'object') {
        return { success: false }
      }
      const normalized = normalizeDraft(draft)
      const file = readDraftFile()
      if (hasDraftContent(normalized)) {
        file[draftKey] = { draft: normalized, updatedAt: Date.now() }
      } else {
        // An emptied composer removes the entry instead of storing junk.
        delete file[draftKey]
      }
      writeDraftFile(file)
      return { success: true }
    }
  )

  registerMessagePackHandler<{ draftKey: string }, { success: boolean }>(
    'input-draft:remove',
    ({ draftKey }) => {
      if (typeof draftKey !== 'string' || !draftKey) return { success: false }
      const file = readDraftFile()
      if (draftKey in file) {
        delete file[draftKey]
        writeDraftFile(file)
      }
      return { success: true }
    }
  )

  registerMessagePackHandler<void, { draftKey: string; updatedAt: number }[]>(
    'input-draft:list',
    () =>
      Object.entries(readDraftFile()).map(([draftKey, entry]) => ({
        draftKey,
        updatedAt: entry.updatedAt
      }))
  )

  registerMessagePackHandler<void, { success: boolean; removed: number }>(
    'input-draft:cleanup',
    () => ({ success: true, removed: cleanupExpiredDrafts() })
  )

  // Expired drafts accumulate across deleted sessions, so sweep once at
  // startup to keep input-drafts.json bounded.
  try {
    cleanupExpiredDrafts()
  } catch {
    // Startup cleanup must never block app launch.
  }
}
