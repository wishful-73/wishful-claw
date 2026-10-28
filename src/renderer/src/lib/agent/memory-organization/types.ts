import type { MemoryRootDescriptor } from '../../../../../shared/memory-automation-types'

export type MemoryOrganizationTrigger = 'manual' | 'startup' | 'nightly' | 'catchup'

export interface MemoryOrganizationScopeResult {
  scopeLabel: string
  rootScope: 'global' | 'project'
  projectId?: string | null
  targetPath?: string | null
  organized: boolean
  outdatedSunk: number
  /** Paragraphs mirrored into SQLite memory_entries by this run (S-93). */
  syncedToDb?: number
  /** Set when the hot→DB mirror failed. The organization result itself stays valid. */
  dbSyncError?: string | null
  skippedReason?: 'empty' | 'llm_unavailable' | 'empty_output' | 'no_changes' | string | null
  error?: string | null
}

export interface MemoryOrganizationReport {
  id: string
  trigger: MemoryOrganizationTrigger
  startedAt: number
  finishedAt: number
  scopes: MemoryOrganizationScopeResult[]
  demotedToWarm: number
  demotedToCold: number
  error?: string | null
}

export interface OrganizationTarget {
  root: MemoryRootDescriptor
  label: string
  projectId?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
}
