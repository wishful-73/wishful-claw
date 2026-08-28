// Daily memory organization engine (S7).
//
// Orchestrates the scheduled/manual organization run entirely in the
// renderer: determine scopes (global + recently active projects), LLM pure
// organization of each MEMORY.md (dedup/merge/compress + outdated paragraph
// detection), write-back with undo snapshot, hot-layer sink of outdated
// paragraphs into DB warm entries, rule-based DB demotion via the S4
// endpoints, and a persisted organization report.

import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { ProviderConfig } from '@renderer/lib/api/types'
import {
  memoryAppend,
  memoryBatchStatus,
  memoryDemotionCandidates
} from '@renderer/stores/chat-store/memory-helpers'
import {
  getProjectMemoryCandidatePaths,
  joinFsPath,
  readTextFile,
  resolveProjectMemoryTextFile
} from './memory-files'
import { resolveGlobalMemoryHomePath } from './memory-snapshot'
import {
  GLOBAL_MEMORY_TEMPLATE,
  PROJECT_MEMORY_TEMPLATE,
  ensureMarkdownDocument,
  hasUsableProvider,
  normalizeMemoryText,
  resolveAutomationProvider,
  sanitizeMemoryPayload,
  type TargetDescriptor
} from './memory-automation-utils'
import { recordEntry, runOrganizationPass, writeTargetContent } from './memory-automation-internal'
import { getErrorMessage } from './memory-json-parsers'
import type { MemoryRootDescriptor } from '../../../../shared/memory-automation-types'

export type MemoryOrganizationTrigger = 'manual' | 'startup' | 'nightly' | 'catchup'

export interface MemoryOrganizationScopeResult {
  scopeLabel: string
  rootScope: 'global' | 'project'
  projectId?: string | null
  targetPath?: string | null
  organized: boolean
  outdatedSunk: number
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

const WATERMARK_CONFIG_KEY = 'memoryOrganizationLastRunAt'
const ORGANIZATION_LOG_FILENAME = 'memory-organization-log.json'
const MAX_LOG_ENTRIES = 200
const PROJECT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_ORGANIZABLE_CHARS = 40

let organizationRunning = false

// ─── Watermark (last organization time, ~/.wishful-claw/config.json) ───

export async function readOrganizationWatermark(): Promise<number> {
  try {
    const value = await ipcClient.invoke('config:get', WATERMARK_CONFIG_KEY)
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export async function writeOrganizationWatermark(timestamp: number): Promise<void> {
  try {
    await ipcClient.invoke('config:set', { key: WATERMARK_CONFIG_KEY, value: timestamp })
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to persist watermark:', error)
  }
}

export function isOrganizationRunning(): boolean {
  return organizationRunning
}

// ─── Scope determination ───

interface OrganizationTarget {
  root: MemoryRootDescriptor
  label: string
  projectId?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
}

async function collectOrganizationTargets(): Promise<OrganizationTarget[]> {
  const targets: OrganizationTarget[] = []

  const globalHomePath = await resolveGlobalMemoryHomePath(ipcClient)
  if (globalHomePath) {
    targets.push({
      root: { id: 'global', scope: 'global', rootPath: globalHomePath },
      label: 'global'
    })
  }

  const cutoff = Date.now() - PROJECT_ACTIVITY_WINDOW_MS
  const activeProjects = useChatStore
    .getState()
    .projects.filter(
      (project) => !project.pluginId && project.workingFolder && project.updatedAt >= cutoff
    )
  for (const project of activeProjects) {
    const workingFolder = project.workingFolder as string
    targets.push({
      root: {
        id: 'project',
        scope: 'project',
        rootPath: getProjectMemoryCandidatePaths(workingFolder).preferredPath,
        projectId: project.id,
        sshConnectionId: project.sshConnectionId ?? null
      },
      label: project.name || workingFolder,
      projectId: project.id,
      workingFolder,
      sshConnectionId: project.sshConnectionId ?? null
    })
  }
  return targets
}

// ─── Per-scope MEMORY.md organization ───

function hasOrganizableContent(markdown: string): boolean {
  const body = markdown.replace(/^#{1,6}\s.*$/gm, '')
  return normalizeMemoryText(body).length >= MIN_ORGANIZABLE_CHARS
}

async function loadMemoryFile(target: OrganizationTarget): Promise<TargetDescriptor> {
  if (target.root.scope === 'project' && target.workingFolder) {
    const resolved = await resolveProjectMemoryTextFile(
      ipcClient,
      target.workingFolder,
      target.sshConnectionId,
      'MEMORY.md'
    )
    return {
      target: 'project_memory',
      path: resolved.path,
      content: resolved.error || resolved.missingFile ? '' : (resolved.content ?? ''),
      missingFile: resolved.missingFile || Boolean(resolved.error),
      sshConnectionId: target.sshConnectionId
    }
  }
  const filePath = joinFsPath(target.root.rootPath, 'MEMORY.md')
  const read = await readTextFile(ipcClient, filePath)
  return {
    target: 'global_memory',
    path: filePath,
    content: read.error ? '' : (read.content ?? ''),
    missingFile: Boolean(read.error),
    sshConnectionId: null
  }
}

function paragraphStillPresent(markdown: string, paragraph: string): boolean {
  const normalizedParagraph = normalizeMemoryText(paragraph)
  if (!normalizedParagraph) return false
  return normalizeMemoryText(markdown).includes(normalizedParagraph)
}

function appendRecoveredHotMemory(markdown: string, title: string | null, content: string): string {
  const normalizedContent = normalizeMemoryText(content)
  if (!normalizedContent) return markdown
  if (normalizeMemoryText(markdown).includes(normalizedContent)) return markdown

  const safeTitle = (title?.replace(/[\r\n#]+/g, ' ').trim() || 'Recovered memory').slice(0, 120)
  const sectionHeading = '## Recovered Memories'
  const entry = `### ${safeTitle}\n${content.trim()}\n`
  const headingPattern = /^## Recovered Memories\s*$/im
  const headingMatch = headingPattern.exec(markdown)
  if (!headingMatch || headingMatch.index < 0) {
    return `${markdown.trimEnd()}\n\n${sectionHeading}\n\n${entry}`
  }

  const bodyStart = headingMatch.index + headingMatch[0].length
  const nextHeading = markdown.slice(bodyStart).search(/^##\s+/m)
  const insertAt = nextHeading >= 0 ? bodyStart + nextHeading : markdown.length
  const before = markdown.slice(0, insertAt).trimEnd()
  const after = markdown.slice(insertAt).replace(/^\s*/, '')
  return `${before}\n\n${entry}${after ? `\n${after}` : ''}`
}

/** Restore a DB warm entry into the MEMORY.md hot layer before activating it. */
export async function restoreMemoryEntryToHot(args: {
  title?: string | null
  content: string
  workingFolder?: string | null
  projectId?: string | null
  sshConnectionId?: string | null
}): Promise<string | null> {
  try {
    const root = args.workingFolder
      ? {
          id: 'project',
          scope: 'project' as const,
          rootPath: getProjectMemoryCandidatePaths(args.workingFolder).preferredPath,
          projectId: args.projectId ?? null,
          sshConnectionId: args.sshConnectionId ?? null
        }
      : {
          id: 'global',
          scope: 'global' as const,
          rootPath: await resolveGlobalMemoryHomePath(ipcClient) ?? '',
          projectId: null,
          sshConnectionId: null
        }
    if (!root.rootPath) return 'Global memory path is unavailable'
    const descriptor = await loadMemoryFile({
      root,
      label: root.scope,
      workingFolder: args.workingFolder,
      sshConnectionId: args.sshConnectionId ?? null,
      projectId: args.projectId ?? null
    })
    const nextContent = appendRecoveredHotMemory(descriptor.content, args.title ?? null, args.content)
    if (nextContent === descriptor.content) return null
    return writeTargetContent(descriptor, nextContent, descriptor.content)
  } catch (error) {
    return getErrorMessage(error)
  }
}

async function sinkOutdatedParagraphs(
  target: OrganizationTarget,
  paragraphs: string[],
  finalMarkdown: string
): Promise<{ count: number; error?: string }> {
  const removed = paragraphs.filter(
    (paragraph) => paragraph.trim() && !paragraphStillPresent(finalMarkdown, paragraph)
  )
  if (removed.length === 0) return { count: 0 }

  const ids: number[] = []
  for (const paragraph of removed) {
    try {
      const appended = await memoryAppend(
        target.root.scope === 'project' ? 'project' : 'global',
        paragraph,
        'standard',
        target.workingFolder ?? undefined,
        { projectId: target.projectId, sshConnectionId: target.sshConnectionId }
      )
      if (!appended.ok || typeof appended.id !== 'number') {
        return {
          count: ids.length,
          error: appended.error ?? 'Failed to append an outdated paragraph to FTS'
        }
      }
      ids.push(appended.id)
    } catch (error) {
      console.warn('[MemoryOrganization] Failed to sink outdated paragraph:', error)
      return { count: ids.length, error: getErrorMessage(error) }
    }
  }

  try {
    const batch = await memoryBatchStatus(
      ids,
      'warm',
      false,
      target.root.scope === 'project' ? 'project' : 'global',
      target.workingFolder,
      target.projectId,
      target.sshConnectionId
    )
    if (!batch.ok || batch.affected !== ids.length) {
      return {
        count: batch.affected,
        error: batch.error ?? `Failed to mark all sunk paragraphs as warm (${batch.affected}/${ids.length})`
      }
    }
    return { count: batch.affected }
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to demote sunk paragraphs to warm:', error)
    return { count: ids.length, error: getErrorMessage(error) }
  }
}

async function organizeScope(
  target: OrganizationTarget,
  provider: ProviderConfig
): Promise<MemoryOrganizationScopeResult> {
  const result: MemoryOrganizationScopeResult = {
    scopeLabel: target.label,
    rootScope: target.root.scope === 'project' ? 'project' : 'global',
    projectId: target.projectId ?? null,
    organized: false,
    outdatedSunk: 0
  }
  try {
    const descriptor = await loadMemoryFile(target)
    result.targetPath = descriptor.path

    if (!hasOrganizableContent(descriptor.content)) {
      result.skippedReason = 'empty'
      return result
    }

    let organization = null
    try {
      organization = await runOrganizationPass({
        provider,
        root: target.root,
        memoryMarkdown: descriptor.content
      })
    } catch (error) {
      console.warn('[MemoryOrganization] LLM organization pass failed:', error)
    }
    if (!organization?.memoryMarkdown) {
      result.skippedReason = 'llm_unavailable'
      return result
    }

    const sanitized = sanitizeMemoryPayload(organization.memoryMarkdown)
    if (!sanitized.content) {
      result.skippedReason = 'empty_output'
      return result
    }
    const template =
      target.root.scope === 'project' ? PROJECT_MEMORY_TEMPLATE : GLOBAL_MEMORY_TEMPLATE
    const nextContent = ensureMarkdownDocument(sanitized.content, template)

    if (nextContent.trim() === descriptor.content.trim()) {
      result.organized = true
      result.skippedReason = 'no_changes'
      return result
    }

    // Sink outdated hot paragraphs first. The original MEMORY.md remains intact
    // until every FTS append and the warm status transition succeed.
    const sink = await sinkOutdatedParagraphs(
      target,
      organization.outdatedParagraphs ?? [],
      nextContent
    )
    result.outdatedSunk = sink.count
    if (sink.error) {
      result.error = sink.error
      return result
    }

    // beforeContent snapshot keeps the write undoable via the fs handlers.
    const writeError = await writeTargetContent(descriptor, nextContent, descriptor.content)
    if (writeError) {
      result.error = writeError
      return result
    }
    result.organized = true
    return result
  } catch (error) {
    result.error = getErrorMessage(error)
    return result
  }
}

// ─── DB rule demotion (priority × idle days, S4 endpoints) ───

async function runDbDemotion(
  targets: OrganizationTarget[]
): Promise<{ demotedToWarm: number; demotedToCold: number }> {
  const settings = useSettingsStore.getState()
  const outcome = { demotedToWarm: 0, demotedToCold: 0 }
  const thresholdArgs = {
    warmDaysEphemeral: settings.memoryWarmThresholdEphemeral,
    coldDaysEphemeral: settings.memoryColdThresholdEphemeral,
    warmDaysStandard: settings.memoryWarmThresholdStandard,
    coldDaysStandard: settings.memoryColdThresholdStandard,
    warmDaysLasting: settings.memoryWarmThresholdLasting,
    coldDaysLasting: settings.memoryColdThresholdLasting
  }
  for (const target of targets) {
    try {
      const response = await memoryDemotionCandidates(
        target.root.scope === 'project' ? 'project' : 'global',
        thresholdArgs,
        target.workingFolder,
        target.projectId,
        target.sshConnectionId
      )
      const candidates = response.candidates ?? []
      for (const targetStatus of ['warm', 'cold'] as const) {
        const ids = candidates
          .filter((candidate) => candidate.targetStatus === targetStatus)
          .map((candidate) => candidate.id)
        if (ids.length === 0) continue
        const batch = await memoryBatchStatus(
          ids,
          targetStatus,
          false,
          target.root.scope === 'project' ? 'project' : 'global',
          target.workingFolder,
          target.projectId,
          target.sshConnectionId
        )
        if (!batch.ok) continue
        if (targetStatus === 'warm') outcome.demotedToWarm += batch.affected
        else outcome.demotedToCold += batch.affected
      }
    } catch (error) {
      console.warn('[MemoryOrganization] DB demotion sweep failed:', error)
    }
  }
  return outcome
}

// ─── Report persistence (~/.wishful-claw/memory-organization-log.json) ───

async function resolveOrganizationLogPath(): Promise<string | undefined> {
  const homePath = await resolveGlobalMemoryHomePath(ipcClient)
  return homePath ? joinFsPath(homePath, ORGANIZATION_LOG_FILENAME) : undefined
}

export async function readOrganizationReports(): Promise<MemoryOrganizationReport[]> {
  const logPath = await resolveOrganizationLogPath()
  if (!logPath) return []
  const read = await readTextFile(ipcClient, logPath)
  if (read.error || !read.content) return []
  try {
    const parsed = JSON.parse(read.content) as unknown
    return Array.isArray(parsed) ? (parsed as MemoryOrganizationReport[]) : []
  } catch {
    return []
  }
}

async function persistOrganizationReport(report: MemoryOrganizationReport): Promise<void> {
  const logPath = await resolveOrganizationLogPath()
  if (!logPath) return
  try {
    const existing = await readOrganizationReports()
    const next = [report, ...existing].slice(0, MAX_LOG_ENTRIES)
    const result = await ipcClient.invoke(IPC.FS_WRITE_FILE, {
      path: logPath,
      content: JSON.stringify(next, null, 2)
    })
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn('[MemoryOrganization] Failed to persist report:', (result as { error?: unknown }).error)
    }
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to persist report:', error)
  }
}

// ─── Master orchestrator ───

export async function runMemoryOrganization(options: {
  trigger: MemoryOrganizationTrigger
}): Promise<MemoryOrganizationReport | null> {
  if (organizationRunning) return null
  const settings = useSettingsStore.getState()
  if (!settings.memoryOrganizationEnabled && options.trigger !== 'manual') {
    return null
  }

  organizationRunning = true
  const startedAt = Date.now()
  const report: MemoryOrganizationReport = {
    id: `org-${startedAt}`,
    trigger: options.trigger,
    startedAt,
    finishedAt: startedAt,
    scopes: [],
    demotedToWarm: 0,
    demotedToCold: 0
  }
  try {
    const provider = resolveAutomationProvider()
    const targets = await collectOrganizationTargets()
    if (hasUsableProvider(provider)) {
      for (const target of targets) {
        report.scopes.push(await organizeScope(target, provider))
      }
    } else {
      report.error = 'missing_provider'
      for (const target of targets) {
        report.scopes.push({
          scopeLabel: target.label,
          rootScope: target.root.scope === 'project' ? 'project' : 'global',
          projectId: target.projectId ?? null,
          organized: false,
          outdatedSunk: 0,
          skippedReason: 'missing_provider'
        })
      }
    }

    const demotion = await runDbDemotion(targets)
    report.demotedToWarm = demotion.demotedToWarm
    report.demotedToCold = demotion.demotedToCold
    return report
  } catch (error) {
    report.error = getErrorMessage(error)
    return report
  } finally {
    report.finishedAt = Date.now()
    if (!report.error || report.error === 'missing_provider') {
      await writeOrganizationWatermark(report.finishedAt)
    }
    await persistOrganizationReport(report)
    await recordEntry({
      scope: 'main',
      rootScope: null,
      memoryRootId: null,
      projectId: null,
      target: 'global_memory',
      kind: 'workflow_habit',
      content: `Memory organization (${report.trigger}): ${report.scopes.filter((scope) => scope.organized).length}/${report.scopes.length} scopes organized, ${report.demotedToWarm} demoted to warm, ${report.demotedToCold} demoted to cold${report.error ? `, error: ${report.error}` : ''}`,
      confidence: 1,
      sourceSessionId: null,
      targetPath: null,
      status: report.error ? 'error' : 'written',
      filterReason: report.error ? 'write_error' : undefined,
      fingerprint: report.id,
      error: report.error ?? null,
      writtenAt: report.finishedAt
    })
    organizationRunning = false
  }
}

// ─── Scheduler event listener (installed once at app bootstrap) ───

/**
 * Tell the main-process scheduler that organization settings changed so it
 * re-reads them and logs the effective schedule immediately (the 5-minute
 * tick also re-reads fresh, so this is a responsiveness nicety, not a
 * correctness requirement).
 */
export function notifyMemoryOrganizationSettingsChanged(): void {
  void ipcClient.invoke(IPC.MEMORY_ORGANIZATION_SETTINGS_CHANGED, {}).catch(() => {})
}

const SCHEDULED_TRIGGERS: readonly MemoryOrganizationTrigger[] = ['startup', 'nightly', 'catchup']

function handleOrganizationRunEvent(raw: unknown): void {
  const record = (raw ?? {}) as Record<string, unknown>
  const trigger = SCHEDULED_TRIGGERS.includes(record.trigger as MemoryOrganizationTrigger)
    ? (record.trigger as MemoryOrganizationTrigger)
    : 'nightly'
  void runMemoryOrganization({ trigger }).catch((error) => {
    console.warn('[MemoryOrganization] Scheduled organization run failed:', error)
  })
}

let organizationRunUnsubscribe: (() => void) | null = null

export function initializeMemoryOrganizationRuntime(): () => void {
  if (organizationRunUnsubscribe) return organizationRunUnsubscribe
  organizationRunUnsubscribe = ipcClient.on(
    IPC.MEMORY_ORGANIZATION_RUN,
    handleOrganizationRunEvent
  )
  return () => {
    organizationRunUnsubscribe?.()
    organizationRunUnsubscribe = null
  }
}
