/**
 * 定时任务的库访问层：行 ↔ 对象的双向映射，以及增改查的薄封装。
 *
 * S-249 从 `cron-reverse-handler.ts` 搬出。这里**不碰定时器**，只管把数据搬进搬出 ——
 * 恢复调度（`restoreJobs`）需要 `scheduleJob`，放在 `scheduling.ts` 里，
 * 这样才能保持 `db ← scheduling` 的单向依赖。
 */

import { getNativeWorker } from '../../../lib/native-worker'
import { jobs } from './state'
import type { CronJob, CronSchedule } from './types'

export function toDbArgs(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    sessionId: job.sessionId,
    scope: job.scope ?? 'global',
    projectId: job.projectId,
    outputMode: job.outputMode ?? 'new_session',
    reuseSessionId: job.reuseSessionId,
    runMode: job.runMode ?? 'background',
    scheduleJson: job.schedule,
    prompt: job.prompt,
    agentId: job.agentId,
    model: job.model,
    thinkingEnabled: job.thinkingEnabled,
    reasoningEffort: job.reasoningEffort,
    workingFolder: job.workingFolder,
    deliveryMode: job.deliveryMode ?? 'desktop',
    deliveryTarget: job.deliveryTarget,
    pluginId: job.pluginId,
    pluginType: job.pluginType,
    pluginChatId: job.pluginChatId,
    deleteAfterRun: job.deleteAfterRun ?? false,
    maxIterations: job.maxIterations ?? 15,
    enabled: job.enabled
  }
}

export function fromDbRow(row: Record<string, unknown>): CronJob {
  const scheduleValue = row.schedule_json ?? row.scheduleJson ?? {}
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sessionId: typeof row.session_id === 'string' ? row.session_id : row.sessionId as string | undefined,
    scope: row.scope === 'project' ? 'project' : 'global',
    projectId: row.project_id as string | undefined ?? row.projectId as string | undefined,
    outputMode: row.output_mode as CronJob['outputMode'] ?? row.outputMode as CronJob['outputMode']
      ?? (row.plugin_id || row.pluginId ? 'bot' : row.delivery_mode === 'session' ? 'reuse_session' : 'new_session'),
    reuseSessionId: row.reuse_session_id as string | undefined ?? row.reuseSessionId as string | undefined
      ?? (row.delivery_mode === 'session' ? row.delivery_target as string | undefined : undefined),
    runMode: row.run_mode === 'session' ? 'session' : 'background',
    schedule: JSON.parse(typeof scheduleValue === 'string' ? scheduleValue : JSON.stringify(scheduleValue)) as CronSchedule,
    prompt: String(row.prompt ?? ''),
    agentId: row.agent_id as string | undefined ?? row.agentId as string | undefined,
    model: row.model as string | undefined,
    thinkingEnabled: typeof (row.thinking_enabled ?? row.thinkingEnabled) === 'boolean'
      ? (row.thinking_enabled ?? row.thinkingEnabled) as boolean
      : null,
    reasoningEffort: row.reasoning_effort as string | null | undefined
      ?? row.reasoningEffort as string | null | undefined
      ?? null,
    workingFolder: row.working_folder as string | undefined ?? row.workingFolder as string | undefined,
    deliveryMode: row.delivery_mode as CronJob['deliveryMode'] ?? row.deliveryMode as CronJob['deliveryMode'],
    deliveryTarget: row.delivery_target as string | undefined ?? row.deliveryTarget as string | undefined,
    pluginId: row.plugin_id as string | undefined ?? row.pluginId as string | undefined,
    pluginType: row.plugin_type as string | undefined ?? row.pluginType as string | undefined,
    pluginChatId: row.plugin_chat_id as string | undefined ?? row.pluginChatId as string | undefined,
    deleteAfterRun: Boolean(row.delete_after_run ?? row.deleteAfterRun),
    maxIterations: Number(row.max_iterations ?? row.maxIterations ?? 15),
    enabled: Boolean(row.enabled),
    deletedAt: row.deleted_at as number | null ?? row.deletedAt as number | null,
    lastFiredAt: row.last_fired_at as number | null ?? row.lastFiredAt as number | null,
    lastRunAt: row.last_run_at as number | null ?? row.lastRunAt as number | null,
    lastRunStatus: row.last_run_status as string | undefined ?? row.lastRunStatus as string | undefined,
    lastRunSummary: row.last_run_summary as string | undefined ?? row.lastRunSummary as string | undefined,
    lastError: row.last_error as string | undefined ?? row.lastError as string | undefined,
    fireCount: Number(row.fire_count ?? row.fireCount ?? 0),
    createdAt: Number(row.created_at ?? row.createdAt ?? Date.now()),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? Date.now())
  }
}

export async function dbRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const result = await getNativeWorker().request<T>(method, params)
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const error = (result as Record<string, unknown>).error
    if (typeof error === 'string' && error) throw new Error(error)
  }
  return result
}

export async function persistCreate(job: CronJob): Promise<void> {
  await dbRequest('db/crons-create', toDbArgs(job))
}

export async function loadJob(jobId: string, includeDeleted = true): Promise<CronJob | null> {
  const result = await dbRequest<Record<string, unknown>>('db/crons-get', { id: jobId, includeDeleted })
  if (!result || result.success === false || !result.cron) return null
  const job = fromDbRow(result.cron as Record<string, unknown>)
  jobs.set(job.id, job)
  return job
}