// Daily memory organization engine (S7).
//
// Orchestrates the scheduled/manual organization run entirely in the
// renderer: determine scopes (global + recently active projects), LLM pure
// organization of each MEMORY.md (dedup/merge/compress + outdated paragraph
// detection), write-back with undo snapshot, hot-layer sink of outdated
// paragraphs into DB warm entries, rule-based DB demotion via the S4
// endpoints, and a persisted organization report.
//
// 拆分说明（2026-10-28）：本文件保留总编排与运行时挂载；范围判定与单档案整理见
// ./memory-organization/scope-pass，报告与水印见 ./report 与 ./state，类型见 ./types。

import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { hasUsableProvider, resolveAutomationProvider } from './memory-automation-utils'
import { recordEntry } from './memory-automation-internal'
import { getErrorMessage } from './memory-json-parsers'
import {
  isOrganizationRunning,
  setOrganizationRunning,
  writeOrganizationWatermark
} from './memory-organization/state'
import { collectOrganizationTargets, organizeScope } from './memory-organization/scope-pass'
import { persistOrganizationReport, runDbDemotion } from './memory-organization/report'
import type { MemoryOrganizationReport, MemoryOrganizationTrigger } from './memory-organization/types'

export {
  isOrganizationRunning,
  readOrganizationWatermark,
  writeOrganizationWatermark
} from './memory-organization/state'
export { readOrganizationReports } from './memory-organization/report'
export { restoreMemoryEntryToHot } from './memory-organization/scope-pass'
export type {
  MemoryOrganizationReport,
  MemoryOrganizationScopeResult,
  MemoryOrganizationTrigger
} from './memory-organization/types'

// ─── Master orchestrator ───

export async function runMemoryOrganization(options: {
  trigger: MemoryOrganizationTrigger
}): Promise<MemoryOrganizationReport | null> {
  if (isOrganizationRunning()) return null
  const settings = useSettingsStore.getState()
  if (!settings.memoryOrganizationEnabled && options.trigger !== 'manual') {
    return null
  }

  setOrganizationRunning(true)
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
          syncedToDb: 0,
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
      content: `Memory organization (${report.trigger}): ${report.scopes.filter((scope) => scope.organized).length}/${report.scopes.length} scopes organized, ${report.demotedToWarm} demoted to warm, ${report.demotedToCold} demoted to cold, ${report.scopes.reduce((sum, scope) => sum + (scope.syncedToDb ?? 0), 0)} mirrored to DB${report.error ? `, error: ${report.error}` : ''}`,
      confidence: 1,
      sourceSessionId: null,
      targetPath: null,
      status: report.error ? 'error' : 'written',
      filterReason: report.error ? 'write_error' : undefined,
      fingerprint: report.id,
      error: report.error ?? null,
      writtenAt: report.finishedAt
    })
    setOrganizationRunning(false)
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
