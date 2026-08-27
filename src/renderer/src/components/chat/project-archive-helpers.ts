import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

// ─── Types ───

export type ArchiveTabId = 'memory' | 'daily' | 'persona'

export interface FileState {
  path: string
  savedContent: string
  draftContent: string
  loading: boolean
  saving: boolean
  missingFile: boolean
  error: string | null
}

export interface DirEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface PersonaSummary {
  id: string
  name: string
  files: { name: string; path: string; content?: string }[]
}

export interface SshConnectionInfo {
  name: string
  host: string
  port: number
  username: string
  defaultDirectory?: string | null
  lastConnectedAt?: number | null
}

// ─── Constants ───

export const WISHFUL_CLAW_DIR = '.wishful-claw'

export const PERSONA_FILE_NAMES = ['IDENTITY.md', 'SOUL.md', 'ONTOLOGY.md', 'AGENTS.md']

export const DEFAULT_MEMORY_TEMPLATE = `# MEMORY.md

Project-level durable memory. Record stable decisions, context, and long-lived information here.

## Decisions

## Context

## Notes
`

export const DEFAULT_DAILY_TEMPLATE = `# Daily Memory — ${new Date().toISOString().slice(0, 10)}

Temporary context for today. Can be consolidated into MEMORY.md later.

`

// ─── Path helpers ───

/**
 * Platform-aware join: keep the same separator as the base path (Windows
 * workingFolder uses `\`), falling back to the OS separator. Mirrors
 * memory-files.ts joinFsPath so displayed and read/write paths agree.
 */
export function joinFsPath(...segments: string[]): string {
  const normalized = segments
    .map((segment, index) =>
      index === 0
        ? segment.replace(/[\\/]+$/, '')
        : segment.replace(/^[\\/]+|[\\/]+$/g, '')
    )
    .filter(Boolean)
  if (normalized.length === 0) return ''
  const base = normalized[0]
  const separator = base.includes('\\')
    ? '\\'
    : window.electron?.process?.platform === 'win32'
      ? '\\'
      : '/'
  return normalized.join(separator)
}

export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function getHomeDir(): string {
  const env = window.electron?.process?.env
  return env?.USERPROFILE || env?.HOME || ''
}

// ─── IPC helpers ───

interface ReadFileResult {
  content?: string
  error?: string
}

/** Always local — SSH project memory is stored locally at ~/.wishful-claw/projects/{id}/ */
export async function readTextFile(path: string): Promise<ReadFileResult> {
  try {
    const result = await ipcClient.invoke(IPC.FS_READ_FILE, { path })
    if (typeof result === 'string') return { content: result }
    if (result && typeof result === 'object' && 'error' in result) {
      return { error: String((result as { error: unknown }).error ?? 'Unknown error') }
    }
    return { content: String(result ?? '') }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function writeTextFile(path: string, content: string): Promise<string | null> {
  try {
    const result = await ipcClient.invoke(IPC.FS_WRITE_FILE, { path, content })
    if (result && typeof result === 'object' && 'error' in result) {
      return String((result as { error: unknown }).error ?? 'Unknown error')
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export async function listDir(path: string): Promise<DirEntry[]> {
  try {
    const result = await ipcClient.invoke(IPC.FS_LIST_DIR, { path })
    if (result && typeof result === 'object' && 'error' in result) {
      return []
    }
    if (Array.isArray(result)) {
      return result as DirEntry[]
    }
    return []
  } catch {
    return []
  }
}
