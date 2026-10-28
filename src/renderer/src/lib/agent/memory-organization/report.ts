import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { memoryBatchStatus, memoryDemotionCandidates } from '@renderer/stores/chat-store/memory-helpers'
import { joinFsPath, readTextFile } from '../memory-files'
import { resolveGlobalMemoryHomePath } from '../memory-snapshot'
import type { MemoryOrganizationReport, OrganizationTarget } from './types'

const ORGANIZATION_LOG_FILENAME = 'memory-organization-log.json'
const MAX_LOG_ENTRIES = 200

// ─── DB rule demotion (priority × idle days, S4 endpoints) ───

export async function runDbDemotion(
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

export async function persistOrganizationReport(report: MemoryOrganizationReport): Promise<void> {
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
      console.warn(
        '[MemoryOrganization] Failed to persist report:',
        (result as { error?: unknown }).error
      )
    }
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to persist report:', error)
  }
}
