import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import type { ProviderConfig } from '@renderer/lib/api/types'
import { memoryAppend, memoryBatchStatus } from '@renderer/stores/chat-store/memory-helpers'
import { mirrorHotParagraphsToDb } from '../memory-hot-sync'
import {
  getProjectMemoryCandidatePaths,
  joinFsPath,
  readTextFile,
  resolveProjectMemoryTextFile
} from '../memory-files'
import { resolveGlobalMemoryHomePath } from '../memory-snapshot'
import {
  GLOBAL_MEMORY_TEMPLATE,
  PROJECT_MEMORY_TEMPLATE,
  ensureMarkdownDocument,
  normalizeMemoryText,
  sanitizeMemoryPayload,
  type TargetDescriptor
} from '../memory-automation-utils'
import { runOrganizationPass, writeTargetContent } from '../memory-automation-internal'
import { getErrorMessage } from '../memory-json-parsers'
import { describeOrganizationError } from './state'
import type { MemoryOrganizationScopeResult, OrganizationTarget } from './types'

const PROJECT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_ORGANIZABLE_CHARS = 40

// ─── Scope determination ───

export async function collectOrganizationTargets(): Promise<OrganizationTarget[]> {
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
          rootPath: (await resolveGlobalMemoryHomePath(ipcClient)) ?? '',
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
        error:
          batch.error ??
          `Failed to mark all sunk paragraphs as warm (${batch.affected}/${ids.length})`
      }
    }
    return { count: batch.affected }
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to demote sunk paragraphs to warm:', error)
    return { count: ids.length, error: getErrorMessage(error) }
  }
}

export async function organizeScope(
  target: OrganizationTarget,
  provider: ProviderConfig
): Promise<MemoryOrganizationScopeResult> {
  const result: MemoryOrganizationScopeResult = {
    scopeLabel: target.label,
    rootScope: target.root.scope === 'project' ? 'project' : 'global',
    projectId: target.projectId ?? null,
    organized: false,
    outdatedSunk: 0,
    syncedToDb: 0
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
      // Keep the real failure on the result instead of collapsing it into a bare
      // 'llm_unavailable': a deterministic upstream 400 (missing session id) looked exactly like
      // "the model is down" for weeks (S-89).
      const detail = describeOrganizationError(error)
      result.skippedReason = 'llm_unavailable'
      result.error = detail
      console.warn(
        `[MemoryOrganization] LLM organization pass failed (${result.scopeLabel}): ${detail}`,
        error
      )
      return result
    }
    if (!organization?.memoryMarkdown) {
      result.skippedReason = 'llm_unavailable'
      result.error ??= 'organization pass returned no usable content'
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

    // S-93: mirror the surviving memories into the retrievable DB tier — and do it BEFORE the
    // no_changes bail-out below. Once MEMORY.md has been organised a few times the pass stops
    // changing the file, so a mirror placed after that check would never run again and recall
    // would silently stop receiving new memories. A failure here must not roll back the
    // organization: the hot file stays the source of truth and the next run retries.
    const sync = await mirrorHotParagraphsToDb({
      scope: target.root.scope === 'project' ? 'project' : 'global',
      markdown: nextContent,
      workingFolder: target.workingFolder,
      projectId: target.projectId,
      sshConnectionId: target.sshConnectionId
    })
    result.syncedToDb = sync.count
    if (sync.error) {
      result.dbSyncError = sync.error
      console.warn(`[MemoryOrganization] Hot→DB mirror failed (${target.label}): ${sync.error}`)
    }

    if (nextContent.trim() === descriptor.content.trim()) {
      result.organized = true
      result.skippedReason = 'no_changes'
      return result
    }

    // Sink outdated hot paragraphs. The original MEMORY.md remains intact
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
