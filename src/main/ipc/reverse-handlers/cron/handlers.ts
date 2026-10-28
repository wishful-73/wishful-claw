/**
 * 定时任务的七个反向调用处理器（add / update / delete / toggle / list / run-now / run-complete）。
 *
 * S-249 从 `cron-reverse-handler.ts` 搬出，函数体逐字平移。这里只做参数收敛与库/调度两层的编排，
 * 定时器本身在 `./scheduling`，数据读写在 `./db`。
 */

import { applyCronUpdateTransaction } from '../cron-execution-coordinator'
import { dbRequest, fromDbRow, loadJob, persistCreate } from './db'
import {
  clearJobTimers,
  clearTaskModel,
  fireJob,
  normalizeSchedule,
  restoreJobs,
  scheduleJob,
  usesTargetSessionModel,
  validateSchedule
} from './scheduling'
import { cronRunLock, generateId, jobs, nextRunTimes } from './state'
import type { CronJob, CronSchedule } from './types'

export async function handleCronAdd(params: Record<string, unknown>): Promise<unknown> {
  const name = (params.name ?? params.title) as string | undefined
  const prompt = params.prompt as string | undefined
  const rawSchedule = params.schedule as CronSchedule | undefined

  if (!name) return { error: 'name (or title) is required' }
  if (!prompt) return { error: 'prompt is required' }

  const schedule = rawSchedule ? normalizeSchedule(rawSchedule) : undefined
  const schedErr = validateSchedule(schedule!)
  if (schedErr) return { error: schedErr }

  const id = generateId()
  const now = Date.now()
  const job: CronJob = {
    id,
    name,
    sessionId: params.sessionId as string | undefined,
    scope: params.scope === 'project' ? 'project' : 'global',
    projectId: params.projectId as string | undefined,
    outputMode: (params.outputMode as CronJob['outputMode']) ??
      (params.pluginId ? 'bot' : params.deliveryMode === 'session' ? 'reuse_session' : 'new_session'),
    reuseSessionId: params.reuseSessionId as string | undefined ??
      (params.deliveryMode === 'session' ? params.deliveryTarget as string | undefined : undefined),
    runMode: params.runMode === 'session' ? 'session' : 'background',
    schedule: schedule!,
    prompt,
    agentId: params.agentId as string | undefined,
    model: params.model as string | undefined,
    thinkingEnabled: typeof params.thinkingEnabled === 'boolean' ? params.thinkingEnabled : null,
    reasoningEffort: typeof params.reasoningEffort === 'string' ? params.reasoningEffort : null,
    workingFolder: params.workingFolder as string | undefined,
    deliveryMode: (params.deliveryMode as CronJob['deliveryMode']) ?? 'desktop',
    deliveryTarget: params.deliveryTarget as string | undefined,
    pluginId: params.pluginId as string | undefined,
    pluginType: params.pluginType as string | undefined,
    pluginChatId: params.pluginChatId as string | undefined,
    deleteAfterRun: (params.deleteAfterRun as boolean | undefined) ?? (schedule!.kind === 'at'),
    maxIterations: (params.maxIterations as number | undefined) ?? 15,
    enabled: true,
    deletedAt: null,
    lastFiredAt: null,
    lastRunAt: null,
    fireCount: 0,
    createdAt: now,
    updatedAt: now
  }
  clearTaskModel(job)

  try {
    await persistCreate(job)
    if (!scheduleJob(job)) {
      await dbRequest('db/crons-delete', { id }).catch(() => {})
      return { error: `Failed to schedule job (kind=${schedule!.kind})` }
    }
    jobs.set(id, job)
    return { success: true, jobId: id, name, schedule }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function dbPatchFromCronPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const dbPatch = { ...patch }
  if (patch.schedule !== undefined) {
    dbPatch.scheduleJson = patch.schedule
    delete dbPatch.schedule
  }
  return dbPatch
}

function cronJobPatch(job: CronJob): Record<string, unknown> {
  return {
    name: job.name,
    prompt: job.prompt,
    agentId: job.agentId,
    model: job.model,
    thinkingEnabled: job.thinkingEnabled,
    reasoningEffort: job.reasoningEffort,
    workingFolder: job.workingFolder,
    scope: job.scope,
    projectId: job.projectId,
    outputMode: job.outputMode,
    reuseSessionId: job.reuseSessionId,
    deliveryMode: job.deliveryMode,
    deliveryTarget: job.deliveryTarget,
    pluginId: job.pluginId,
    pluginType: job.pluginType,
    pluginChatId: job.pluginChatId,
    enabled: job.enabled,
    deleteAfterRun: job.deleteAfterRun,
    maxIterations: job.maxIterations,
    schedule: job.schedule
  }
}

export async function handleCronUpdate(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId) return { error: 'jobId is required' }
  if (cronRunLock.has(jobId)) return { error: `Job "${jobId}" is currently running` }
  const patch = params.patch as Record<string, unknown> | undefined
  if (!patch || Object.keys(patch).length === 0) return { error: 'patch is required' }

  await restoreJobs()
  const current = await loadJob(jobId)
  if (!current) return { error: `Job "${jobId}" not found` }

  const next = { ...current }
  if (patch.name !== undefined) next.name = patch.name as string
  if (patch.prompt !== undefined) next.prompt = patch.prompt as string
  if (patch.agentId !== undefined) next.agentId = patch.agentId as string | undefined
  if (patch.model !== undefined) next.model = patch.model as string | undefined
  if (patch.thinkingEnabled !== undefined) {
    next.thinkingEnabled = typeof patch.thinkingEnabled === 'boolean' ? patch.thinkingEnabled : null
  }
  if (patch.reasoningEffort !== undefined) {
    next.reasoningEffort = typeof patch.reasoningEffort === 'string' ? patch.reasoningEffort : null
  }
  if (patch.workingFolder !== undefined) next.workingFolder = patch.workingFolder as string | undefined
  if (patch.scope !== undefined) next.scope = patch.scope === 'project' ? 'project' : 'global'
  if (patch.projectId !== undefined) next.projectId = patch.projectId as string | undefined
  if (patch.outputMode !== undefined) next.outputMode = patch.outputMode as CronJob['outputMode']
  if (patch.reuseSessionId !== undefined) next.reuseSessionId = patch.reuseSessionId as string | undefined
  if (patch.runMode !== undefined) next.runMode = patch.runMode === 'session' ? 'session' : 'background'
  if (patch.deliveryMode !== undefined) next.deliveryMode = patch.deliveryMode as CronJob['deliveryMode']
  if (patch.deliveryTarget !== undefined) next.deliveryTarget = patch.deliveryTarget as string | undefined
  if (patch.pluginId !== undefined) next.pluginId = patch.pluginId as string | undefined
  if (patch.pluginType !== undefined) next.pluginType = patch.pluginType as string | undefined
  if (patch.pluginChatId !== undefined) next.pluginChatId = patch.pluginChatId as string | undefined
  if (patch.enabled !== undefined) next.enabled = patch.enabled as boolean
  if (patch.deleteAfterRun !== undefined) next.deleteAfterRun = patch.deleteAfterRun as boolean
  if (patch.maxIterations !== undefined) next.maxIterations = patch.maxIterations as number
  if (patch.schedule !== undefined) next.schedule = normalizeSchedule(patch.schedule as CronSchedule)

  const schedErr = validateSchedule(next.schedule)
  if (schedErr) return { error: schedErr }
  clearTaskModel(next)
  if (usesTargetSessionModel(next)) {
    patch.agentId = null
    patch.model = null
    patch.thinkingEnabled = null
    patch.reasoningEffort = null
  }
  next.updatedAt = Date.now()

  const oldJob = { ...current, schedule: { ...current.schedule } }
  const oldWasScheduled = current.enabled && !current.deletedAt
  try {
    const result = await applyCronUpdateTransaction({
      persistNext: async () => {
        const response = await dbRequest<Record<string, unknown>>('db/crons-update', {
          id: jobId,
          patch: dbPatchFromCronPatch(
            patch.schedule === undefined ? patch : { ...patch, schedule: next.schedule }
          )
        })
        if (response && response.success === false) {
          throw new Error(typeof response.error === 'string' ? response.error : 'Cron update failed')
        }
      },
      applyNext: () => {
        clearJobTimers(jobId)
        jobs.set(jobId, next)
      },
      restorePrevious: () => {
        clearJobTimers(jobId)
        jobs.set(jobId, oldJob)
      },
      scheduleNext: () => !next.enabled || Boolean(next.deletedAt) || scheduleJob(next),
      schedulePrevious: () => scheduleJob(oldJob),
      persistPrevious: async () => {
        await dbRequest('db/crons-update', { id: jobId, patch: cronJobPatch(oldJob) })
      },
      wasPreviouslyScheduled: oldWasScheduled,
      formatScheduleError: () => `Failed to re-schedule job (kind=${next.schedule.kind})`
    })
    return result.success ? { success: true, jobId } : { error: result.error }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handleCronDelete(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId) return { error: 'jobId is required' }
  if (cronRunLock.has(jobId)) return { error: `Job "${jobId}" is currently running` }
  await restoreJobs()
  const job = await loadJob(jobId)
  if (!job) return { error: `Job "${jobId}" not found` }

  try {
    const result = await dbRequest<Record<string, unknown>>('db/crons-delete', { id: jobId })
    if (result && result.success === false) return result
    clearJobTimers(jobId)
    job.deletedAt = Date.now()
    job.enabled = false
    return { success: true, jobId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handleCronToggle(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId || typeof params.enabled !== 'boolean') return { error: 'jobId and enabled are required' }
  if (cronRunLock.has(jobId)) return { error: `Job "${jobId}" is currently running` }
  await restoreJobs()
  const job = await loadJob(jobId)
  if (!job) return { error: `Job "${jobId}" not found` }
  try {
    const result = await dbRequest<Record<string, unknown>>('db/crons-toggle', { id: jobId, enabled: params.enabled })
    if (result && result.success === false) return result
    job.enabled = params.enabled
    job.updatedAt = Date.now()
    clearJobTimers(jobId)
    if (job.enabled && !job.deletedAt) scheduleJob(job)
    return { success: true, jobId, enabled: job.enabled }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handleCronList(params: Record<string, unknown>): Promise<unknown> {
  const result = await dbRequest<unknown[]>('db/crons-list', {
    includeDeleted: params?.includeDeleted === true,
    enabledOnly: params?.enabledOnly === true
  })
  return (result ?? [])
    .map((row) => fromDbRow(row as Record<string, unknown>))
    .filter((job) => !params?.sessionId || job.sessionId === params.sessionId)
    .map((job) => ({ ...job, nextRunAt: nextRunTimes.get(job.id) ?? null }))
}

export async function handleCronRunNow(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId) return { error: 'jobId is required' }
  await restoreJobs()
  const job = await loadJob(jobId)
  if (!job || job.deletedAt) return { error: `Job "${jobId}" not found` }
  if (cronRunLock.has(jobId)) return { error: `Job "${jobId}" is already running` }
  if (!await fireJob(job)) return { error: `Failed to deliver job "${jobId}" to the renderer` }
  return { success: true, jobId }
}

export async function handleCronRunComplete(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  const fireId = params.fireId as string | undefined
  if (!jobId || !fireId) return { error: 'jobId and fireId are required' }
  if (!cronRunLock.release(jobId, fireId)) {
    return { error: `Job "${jobId}" completion does not match the active run` }
  }

  const job = jobs.get(jobId) ?? await loadJob(jobId)
  if (!job || job.deletedAt || !job.deleteAfterRun) {
    return { success: true, jobId, archived: false }
  }

  try {
    const result = await dbRequest<Record<string, unknown>>('db/crons-delete', { id: jobId })
    if (result && result.success === false) return result
    clearJobTimers(jobId)
    job.deletedAt = Date.now()
    job.enabled = false
    jobs.set(jobId, job)
    return { success: true, jobId, archived: true }
  } catch (error) {
    job.enabled = false
    jobs.set(jobId, job)
    await dbRequest('db/crons-toggle', { id: jobId, enabled: false }).catch((toggleError) => {
      console.warn(`[Cron] failed to disable unarchived one-shot job ${jobId}:`, toggleError)
    })
    return { error: error instanceof Error ? error.message : String(error) }
  }
}