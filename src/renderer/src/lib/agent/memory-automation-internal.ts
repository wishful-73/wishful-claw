import { estimateTokens } from '@renderer/lib/format-tokens'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { runSidecarTextRequest } from '@renderer/lib/ipc/agent-bridge'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { ProviderConfig } from '@renderer/lib/api/types'
import { isMissingFileErrorMessage, joinFsPath, readTextFile } from './memory-files'
import type {
  MemoryAutomationCandidateKind,
  MemoryAutomationFilterReason,
  MemoryAutomationRecordInput,
  MemoryAutomationStatus,
  MemoryAutomationTarget,
  MemoryRootDescriptor,
  MemoryRootInput,
  MemoryRootScope,
  MemoryStage1Output,
  MemoryStage1OutputInput
} from '../../../../shared/memory-automation-types'

import { GLOBAL_USER_TEMPLATE, GLOBAL_MEMORY_TEMPLATE, PROJECT_USER_TEMPLATE, PROJECT_MEMORY_TEMPLATE, SUMMARY_TEMPLATE, sanitizeMemoryPayload, parseConsolidationJson, parseOrganizationJson, getErrorMessage, targetForRoot, userTargetForRoot, ensureMarkdownDocument, appendPipelineSection, buildRolloutSummaryMarkdown, buildSummaryFallback, buildConsolidationPrompt, buildOrganizationPrompt, type ConsolidationOutput, type OrganizationOutput, type TargetDescriptor } from './memory-automation-utils'

const RAW_MEMORIES_DEFAULT = '# Raw Memories\n'

export const runningSessionAutomations = new Set<string>()
export const _maState = {
  lastAutoRunBySession: new Map<string, number>()
}

/**
 * Record a pipeline entry. The former IPC backend never existed; entries are
 * logged locally. Organization reports additionally persist to
 * ~/.wishful-claw/memory-organization-log.json via memory-organization.ts.
 */
export async function recordEntry(
  input: MemoryAutomationRecordInput
): Promise<null> {
  const diagnostics = [
    input.targetPath ? `path=${input.targetPath}` : '',
    input.error ? `error=${input.error}` : ''
  ].filter(Boolean)
  console.info(
    `[MemoryAutomation] entry: ${input.status}${input.filterReason ? ` (${input.filterReason})` : ''} target=${input.target}: ${input.content}${diagnostics.length ? ` (${diagnostics.join(' | ')})` : ''}`
  )
  return null
}

export async function recordSyntheticEntry(args: {
  status: MemoryAutomationStatus
  reason?: MemoryAutomationFilterReason
  sourceSessionId?: string | null
  target?: MemoryAutomationTarget
  rootScope?: MemoryRootScope | null
  memoryRootId?: string | null
  projectId?: string | null
  kind?: MemoryAutomationCandidateKind
  content: string
  targetPath?: string | null
  error?: string | null
}): Promise<void> {
  await recordEntry({
    scope: 'main',
    rootScope: args.rootScope ?? null,
    memoryRootId: args.memoryRootId ?? null,
    projectId: args.projectId ?? null,
    target: args.target ?? (args.rootScope === 'project' ? 'project_memory' : 'global_memory'),
    kind: args.kind ?? 'daily_context',
    content: args.content,
    confidence: 0,
    sourceSessionId: args.sourceSessionId,
    targetPath: args.targetPath ?? null,
    status: args.status,
    filterReason: args.reason,
    fingerprint: `${args.reason ?? args.status}:${args.content.slice(0, 64)}`,
    error: args.error ?? null
  })
}

/** Build local root descriptors from root inputs (no backend round-trip). */
export function resolveMemoryRoots(inputs: MemoryRootInput[]): MemoryRootDescriptor[] {
  return inputs.map((input) => ({
    id: input.scope === 'project' ? 'project' : 'global',
    scope: input.scope,
    rootPath: input.rootPath,
    projectId: input.projectId ?? null,
    sshConnectionId: input.sshConnectionId ?? null
  }))
}

export async function readRootFile(
  root: MemoryRootDescriptor,
  relativePath: string,
  fallback: string
): Promise<TargetDescriptor> {
  const filePath = joinFsPath(root.rootPath, ...relativePath.split('/'))
  const read = await readTextFile(ipcClient, filePath, root.sshConnectionId)
  return {
    target:
      relativePath === 'USER.md'
        ? userTargetForRoot(root)
        : relativePath === 'memory_summary.md'
          ? 'summary_cache'
          : targetForRoot(root),
    path: filePath,
    content: read.error ? fallback : (read.content ?? ''),
    missingFile: Boolean(read.error && isMissingFileErrorMessage(read.error)),
    sshConnectionId: root.sshConnectionId
  }
}

export async function writeTargetContent(
  descriptor: TargetDescriptor,
  nextContent: string,
  beforeContent?: string
): Promise<string | null> {
  const connectionId = descriptor.sshConnectionId?.trim()
  const result = connectionId
    ? await ipcClient.invoke(IPC.SSH_FS_WRITE_FILE, {
        connectionId,
        path: descriptor.path,
        content: nextContent,
        ...(beforeContent !== undefined ? { beforeContent } : {})
      })
    : await ipcClient.invoke(IPC.FS_WRITE_FILE, {
        path: descriptor.path,
        content: nextContent,
        ...(beforeContent !== undefined ? { beforeContent } : {})
      })

  if (result && typeof result === 'object' && 'error' in result) {
    return String((result as { error?: unknown }).error ?? 'Failed to write file')
  }
  return null
}

export async function writeWithRetry(descriptor: TargetDescriptor, nextContent: string): Promise<string | null> {
  const before = descriptor.missingFile ? undefined : descriptor.content
  let error = await writeTargetContent(descriptor, nextContent, before)
  if (error?.includes('File changed since it was read')) {
    const refreshed = await readTextFile(ipcClient, descriptor.path, descriptor.sshConnectionId)
    if (!refreshed.error) {
      error = await writeTargetContent(descriptor, nextContent, refreshed.content ?? '')
    }
  }
  return error
}

/**
 * Stage 1 persistence: append extracted raw memories (and per-rollout summary
 * files) directly into the memory root via fs writes. Replaces the missing
 * pipeline backend's complete-stage1/list-stage1-outputs round-trip.
 */
export async function appendStage1Outputs(args: {
  root: MemoryRootDescriptor
  outputs: MemoryStage1OutputInput[]
  sourceSessionId: string
}): Promise<string | null> {
  const createdAt = Date.now()
  const fullOutputs: MemoryStage1Output[] = args.outputs.map((output, index) => ({
    ...output,
    id: `${output.memoryRootId}-${output.sourceSessionId}-${createdAt}-${index}`,
    createdAt
  }))
  const rawDescriptor = await readRootFile(args.root, 'raw_memories.md', RAW_MEMORIES_DEFAULT)
  const section = appendPipelineSection(rawDescriptor.content, fullOutputs)
  const rawError = await writeWithRetry(rawDescriptor, section)
  if (rawError) return rawError

  for (const output of fullOutputs) {
    const rolloutDescriptor = await readRootFile(
      args.root,
      `rollout_summaries/${output.rolloutSlug}.md`,
      ''
    )
    const rolloutError = await writeWithRetry(
      rolloutDescriptor,
      buildRolloutSummaryMarkdown(args.root, output)
    )
    if (rolloutError) return rolloutError
  }
  return null
}

export async function runConsolidation(args: {
  provider: ProviderConfig
  root: MemoryRootDescriptor
  userMarkdown: string
  memoryMarkdown: string
  summaryMarkdown: string
  rawMemoriesMarkdown: string
}): Promise<ConsolidationOutput | null> {
  const raw = await runSidecarTextRequest({
    provider: args.provider,
    messages: [
      {
        id: `memory-phase2-${args.root.id}`,
        role: 'user',
        content: buildConsolidationPrompt(args),
        createdAt: Date.now()
      }
    ],
    maxIterations: 1
  })
  return parseConsolidationJson(raw)
}

/**
 * Pure-organization mode of the consolidation machinery: no new raw input,
 * just dedup/merge/compress of the existing MEMORY.md plus a list of
 * outdated paragraphs to sink into the warm tier.
 */
export async function runOrganizationPass(args: {
  provider: ProviderConfig
  root: MemoryRootDescriptor
  memoryMarkdown: string
}): Promise<OrganizationOutput | null> {
  const raw = await runSidecarTextRequest({
    provider: args.provider,
    messages: [
      {
        id: `memory-organize-${args.root.id}`,
        role: 'user',
        content: buildOrganizationPrompt(args),
        createdAt: Date.now()
      }
    ],
    maxIterations: 1
  })
  return parseOrganizationJson(raw)
}

/**
 * Phase 2: read pending raw memories back from raw_memories.md, consolidate
 * them into USER/MEMORY/summary via LLM (with deterministic fallback), then
 * reset raw_memories.md so entries are not re-consolidated.
 */
export async function runPhase2ForRoot(args: {
  root: MemoryRootDescriptor
  provider: ProviderConfig
  sourceSessionId?: string | null
}): Promise<void> {
  try {
    const rawDescriptor = await readRootFile(args.root, 'raw_memories.md', RAW_MEMORIES_DEFAULT)
    const rawContent = rawDescriptor.content.trim()
    if (!rawContent || rawContent === RAW_MEMORIES_DEFAULT.trim()) {
      return
    }

    const userDescriptor = await readRootFile(
      args.root,
      'USER.md',
      args.root.scope === 'project' ? PROJECT_USER_TEMPLATE : GLOBAL_USER_TEMPLATE
    )
    const memoryDescriptor = await readRootFile(
      args.root,
      'MEMORY.md',
      args.root.scope === 'project' ? PROJECT_MEMORY_TEMPLATE : GLOBAL_MEMORY_TEMPLATE
    )
    const summaryDescriptor = await readRootFile(args.root, 'memory_summary.md', SUMMARY_TEMPLATE)

    let consolidation: ConsolidationOutput | null = null
    try {
      consolidation = await runConsolidation({
        provider: args.provider,
        root: args.root,
        userMarkdown: userDescriptor.content,
        memoryMarkdown: memoryDescriptor.content,
        summaryMarkdown: summaryDescriptor.content,
        rawMemoriesMarkdown: rawDescriptor.content
      })
    } catch (error) {
      console.warn('[MemoryAutomation] Phase 2 model consolidation failed, using fallback:', error)
    }

    const nextUser = ensureMarkdownDocument(
      sanitizeMemoryPayload(consolidation?.userMarkdown ?? userDescriptor.content).content ||
        userDescriptor.content,
      userDescriptor.content
    )
    const fallbackMemory = (() => {
      // LLM consolidation unavailable: keep raw lines inside MEMORY.md so no memory is lost.
      const lines = rawDescriptor.content
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*#>]+\s*/, '').trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
      if (lines.length === 0) return memoryDescriptor.content
      return `${ensureMarkdownDocument(memoryDescriptor.content, GLOBAL_MEMORY_TEMPLATE).trimEnd()}\n${lines.join('\n')}\n`
    })()
    const nextMemory = ensureMarkdownDocument(
      sanitizeMemoryPayload(consolidation?.memoryMarkdown ?? fallbackMemory).content || fallbackMemory,
      fallbackMemory
    )
    const needsSummary =
      estimateTokens(nextMemory) > Math.max(1000, useSettingsStore.getState().memorySummaryBudgetTokens)
    const nextSummary = ensureMarkdownDocument(
      sanitizeMemoryPayload(
        consolidation?.summaryMarkdown ?? (needsSummary ? buildSummaryFallback(nextMemory) : nextMemory)
      ).content || buildSummaryFallback(nextMemory),
      SUMMARY_TEMPLATE
    )

    const writeTargets = [
      { descriptor: userDescriptor, content: nextUser },
      { descriptor: memoryDescriptor, content: nextMemory },
      { descriptor: summaryDescriptor, content: nextSummary }
    ]
    for (const item of writeTargets) {
      if (item.descriptor.content === item.content) continue
      const error = await writeWithRetry(item.descriptor, item.content)
      if (error) throw new Error(error)
    }

    // Raw memories are consolidated; reset the staging file.
    if (rawDescriptor.content !== RAW_MEMORIES_DEFAULT) {
      const resetError = await writeWithRetry(rawDescriptor, RAW_MEMORIES_DEFAULT)
      if (resetError) throw new Error(resetError)
    }

    await recordEntry({
      scope: 'main',
      rootScope: args.root.scope,
      memoryRootId: args.root.id,
      projectId: args.root.projectId ?? null,
      target: targetForRoot(args.root),
      kind: args.root.scope === 'project' ? 'project_decision' : 'workflow_habit',
      content: `Consolidated raw memories for ${args.root.scope} memory`,
      confidence: 1,
      sourceSessionId: args.sourceSessionId,
      targetPath: memoryDescriptor.path,
      status: 'written',
      fingerprint: `${args.root.id}:phase2:${args.sourceSessionId ?? 'manual'}`,
      evidence: { writtenItems: consolidation?.writtenItems ?? [] },
      writtenAt: Date.now(),
      beforeContent: memoryDescriptor.content,
      afterContent: nextMemory,
      appendedText: null,
      sshConnectionId: args.root.sshConnectionId ?? null
    })
  } catch (error) {
    const message = getErrorMessage(error)
    await recordSyntheticEntry({
      status: 'error',
      reason: 'write_error',
      sourceSessionId: args.sourceSessionId,
      rootScope: args.root.scope,
      memoryRootId: args.root.id,
      projectId: args.root.projectId ?? null,
      target: targetForRoot(args.root),
      content: 'Memory phase 2 consolidation failed',
      targetPath: args.root.rootPath,
      error: message
    })
  }
}
