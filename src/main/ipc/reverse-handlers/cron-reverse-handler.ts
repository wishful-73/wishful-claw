/**
 * Cron reverse-request handlers.
 *
 * In-memory cron job scheduler — stores jobs in a Map and uses node-cron
 * for cron-expression scheduling. One-shot ("at") and interval ("every")
 * modes use setTimeout / setInterval.
 *
 * When a job fires, it sends a `cron:fire` event to the renderer which
 * can spawn an agent run with the stored prompt.
 */

import cron from 'node-cron'
import { safeSendMessagePackToWindow } from '../../window-ipc'
import { getMainWindow } from '../../main-window-registry'
import { getNativeWorker } from '../../lib/native-worker'
import { registerMessagePackHandler } from '../messagepack-handler'

// ── Types ──

interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  at?: number | string
  every?: number
  expr?: string
  tz?: string
}

interface CronJob {
  id: string
  name: string
  sessionId?: string
  schedule: CronSchedule
  prompt: string
  agentId?: string
  model?: string
  workingFolder?: string
  deliveryMode?: 'desktop' | 'session' | 'none' | 'plugin'
  deliveryTarget?: string
  pluginId?: string
  pluginType?: string
  pluginChatId?: string
  deleteAfterRun?: boolean
  maxIterations?: number
  enabled: boolean
  deletedAt: number | null
  lastFiredAt: number | null
  lastRunAt: number | null
  lastRunStatus?: string
  lastRunSummary?: string
  lastError?: string
  fireCount: number
  createdAt: number
  updatedAt: number
}

// ── State ──

const jobs = new Map<string, CronJob>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const intervals = new Map<string, ReturnType<typeof setInterval>>()
const cronTasks = new Map<string, ReturnType<typeof cron.schedule>>()
const nextRunTimes = new Map<string, number>()
const runningJobIds = new Map<string, string>()
const MAX_TIMEOUT_DELAY = 2_147_000_000

let idCounter = 0
let restorePromise: Promise<void> | null = null
let restored = false

function generateId(): string {
  idCounter += 1
  return `cron-${Date.now().toString(36)}-${idCounter}`
}

function normalizeSchedule(schedule: CronSchedule): CronSchedule {
  if (schedule.kind !== 'at' || typeof schedule.at !== 'string') return schedule
  const match = /^\+(\d+)([smhd])$/.exec(schedule.at.trim())
  if (!match) return schedule
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return { ...schedule, at: Date.now() + Number(match[1]) * multipliers[match[2]] }
}

function toDbArgs(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    sessionId: job.sessionId,
    scheduleJson: job.schedule,
    prompt: job.prompt,
    agentId: job.agentId,
    model: job.model,
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

function fromDbRow(row: Record<string, unknown>): CronJob {
  const scheduleValue = row.schedule_json ?? row.scheduleJson ?? {}
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sessionId: typeof row.session_id === 'string' ? row.session_id : row.sessionId as string | undefined,
    schedule: JSON.parse(typeof scheduleValue === 'string' ? scheduleValue : JSON.stringify(scheduleValue)) as CronSchedule,
    prompt: String(row.prompt ?? ''),
    agentId: row.agent_id as string | undefined ?? row.agentId as string | undefined,
    model: row.model as string | undefined,
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

async function dbRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const result = await getNativeWorker().request<T>(method, params)
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const error = (result as Record<string, unknown>).error
    if (typeof error === 'string' && error) throw new Error(error)
  }
  return result
}

async function persistCreate(job: CronJob): Promise<void> {
  await dbRequest('db/crons-create', toDbArgs(job))
}

async function loadJob(jobId: string, includeDeleted = true): Promise<CronJob | null> {
  const result = await dbRequest<Record<string, unknown>>('db/crons-get', { id: jobId, includeDeleted })
  if (!result || result.success === false || !result.cron) return null
  const job = fromDbRow(result.cron as Record<string, unknown>)
  jobs.set(job.id, job)
  return job
}

async function restoreJobs(): Promise<void> {
  if (restored) return
  if (!restorePromise) {
    restorePromise = dbRequest<unknown[]>('db/crons-list', { enabledOnly: false })
      .then((rows) => {
        for (const raw of rows ?? []) {
          const job = fromDbRow(raw as Record<string, unknown>)
          if (job.enabled && !job.deletedAt) {
            jobs.set(job.id, job)
            scheduleJob(job)
          }
        }
        restored = true
      })
      .catch((error) => {
        console.warn('[Cron] restore failed:', error)
      })
      .finally(() => { restorePromise = null })
  }
  await restorePromise
}

// ── Validation ──

function resolveTimestamp(value: number | string | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function validateTimeZone(timeZone: string): string | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return null
  } catch {
    return `schedule.tz is not a valid IANA timezone: "${timeZone}"`
  }
}

function validateSchedule(schedule: CronSchedule): string | null {
  if (!schedule || !schedule.kind) return 'schedule.kind is required (at | every | cron)'
  if (schedule.kind === 'at') {
    const ts = resolveTimestamp(schedule.at)
    if (!ts) return 'schedule.at must be a valid timestamp (ms) or ISO 8601 string'
    if (ts < Date.now() - 30_000) {
      return `schedule.at is in the past (${new Date(ts).toISOString()}). Use a future timestamp.`
    }
  } else if (schedule.kind === 'every') {
    if (!schedule.every || schedule.every < 1000) return 'schedule.every must be >= 1000 ms'
  } else if (schedule.kind === 'cron') {
    const expr = schedule.expr?.trim()
    if (!expr) return 'schedule.expr is required for kind=cron'
    const parts = expr.split(/\s+/)
    if (parts.length < 5 || parts.length > 6) return 'schedule.expr must have 5 or 6 fields'
    if (!cron.validate(expr)) return `schedule.expr is not a valid cron expression: "${expr}"`
    const tzErr = validateTimeZone(schedule.tz?.trim() || 'UTC')
    if (tzErr) return tzErr
  } else {
    return `Unknown schedule.kind: "${schedule.kind}"`
  }
  return null
}

// ── Scheduling ──

function clearJobTimers(jobId: string): void {
  const t = timers.get(jobId)
  if (t) { clearTimeout(t); timers.delete(jobId) }
  const i = intervals.get(jobId)
  if (i) { clearInterval(i); intervals.delete(jobId) }
  const task = cronTasks.get(jobId)
  if (task) { task.stop(); cronTasks.delete(jobId) }
  nextRunTimes.delete(jobId)
}

async function fireJob(job: CronJob, consumeOneShot = false): Promise<boolean> {
  if (runningJobIds.has(job.id)) return false

  const firedAt = Date.now()
  const fireId = `${job.id}:${firedAt}:${Math.random().toString(36).slice(2, 10)}`
  runningJobIds.set(job.id, fireId)
  try {
    await dbRequest('db/crons-mark-fired', { id: job.id, firedAt, disable: consumeOneShot })
  } catch (error) {
    runningJobIds.delete(job.id)
    console.warn(`[Cron] failed to persist fired state for ${job.id}:`, error)
    return false
  }

  job.lastFiredAt = firedAt
  job.fireCount += 1
  job.updatedAt = firedAt
  if (consumeOneShot) {
    job.enabled = false
    clearJobTimers(job.id)
  }

  const win = getMainWindow()
  const sent = Boolean(win && safeSendMessagePackToWindow(win, 'cron:fire', {
    jobId: job.id,
    fireId,
    name: job.name,
    prompt: job.prompt,
    agentId: job.agentId,
    model: job.model,
    workingFolder: job.workingFolder,
    sessionId: job.sessionId,
    firedAt,
    deliveryMode: job.deliveryMode ?? 'desktop',
    deliveryTarget: job.deliveryTarget,
    deleteAfterRun: job.deleteAfterRun ?? false,
    pluginId: job.pluginId,
    pluginType: job.pluginType,
    pluginChatId: job.pluginChatId,
    maxIterations: job.maxIterations ?? 15
  }))

  if (!sent) {
    runningJobIds.delete(job.id)
    console.warn(`[Cron] renderer unavailable for job ${job.id}`)
    return false
  }

  // One-shot jobs stop scheduling immediately, but stay queryable until the
  // renderer finishes execution and asks Main to archive the task.
  if (job.deleteAfterRun) clearJobTimers(job.id)
  return true
}

function scheduleJob(job: CronJob): boolean {
  clearJobTimers(job.id)
  const { schedule } = job

  if (schedule.kind === 'at') {
    const ts = resolveTimestamp(schedule.at)
    if (!ts || ts < Date.now()) return false
    nextRunTimes.set(job.id, ts)
    const scheduleNextChunk = (): void => {
      const remaining = ts - Date.now()
      if (remaining <= 0) {
        timers.delete(job.id)
        nextRunTimes.delete(job.id)
        void fireJob(job, true)
        return
      }
      timers.set(job.id, setTimeout(scheduleNextChunk, Math.min(remaining, MAX_TIMEOUT_DELAY)))
    }
    scheduleNextChunk()
    return true
  }

  if (schedule.kind === 'every') {
    const ms = schedule.every!
    nextRunTimes.set(job.id, Date.now() + ms)
    intervals.set(job.id, setInterval(() => {
      nextRunTimes.set(job.id, Date.now() + ms)
      void fireJob(job)
    }, ms))
    return true
  }

  if (schedule.kind === 'cron') {
    const expr = schedule.expr!
    const tz = schedule.tz ?? 'UTC'
    try {
      const task = cron.schedule(expr, () => {
        void fireJob(job)
        const nextRun = task.getNextRun()
        if (nextRun) nextRunTimes.set(job.id, nextRun.getTime())
        else nextRunTimes.delete(job.id)
      }, { timezone: tz })
      cronTasks.set(job.id, task)
      const nextRun = task.getNextRun()
      if (nextRun) nextRunTimes.set(job.id, nextRun.getTime())
      return true
    } catch {
      return false
    }
  }

  return false
}

// ── Handler functions ──

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
    schedule: schedule!,
    prompt,
    agentId: params.agentId as string | undefined,
    model: params.model as string | undefined,
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

export async function handleCronUpdate(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId) return { error: 'jobId is required' }
  if (runningJobIds.has(jobId)) return { error: `Job "${jobId}" is currently running` }
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
  if (patch.workingFolder !== undefined) next.workingFolder = patch.workingFolder as string | undefined
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
  next.updatedAt = Date.now()

  try {
    const result = await dbRequest<Record<string, unknown>>('db/crons-update', {
      id: jobId,
      patch: dbPatchFromCronPatch(
        patch.schedule === undefined ? patch : { ...patch, schedule: next.schedule }
      )
    })
    if (result && result.success === false) return result
    clearJobTimers(jobId)
    jobs.set(jobId, next)
    if (next.enabled && !next.deletedAt && !scheduleJob(next)) {
      return { error: `Failed to re-schedule job (kind=${next.schedule.kind})` }
    }
    return { success: true, jobId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handleCronDelete(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  if (!jobId) return { error: 'jobId is required' }
  if (runningJobIds.has(jobId)) return { error: `Job "${jobId}" is currently running` }
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
  if (runningJobIds.has(jobId)) return { error: `Job "${jobId}" is currently running` }
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
  if (runningJobIds.has(jobId)) return { error: `Job "${jobId}" is already running` }
  if (!await fireJob(job)) return { error: `Failed to deliver job "${jobId}" to the renderer` }
  return { success: true, jobId }
}

export async function handleCronRunComplete(params: Record<string, unknown>): Promise<unknown> {
  const jobId = (params.jobId ?? params.id) as string | undefined
  const fireId = params.fireId as string | undefined
  if (!jobId || !fireId) return { error: 'jobId and fireId are required' }
  if (runningJobIds.get(jobId) !== fireId) {
    return { error: `Job "${jobId}" completion does not match the active run` }
  }
  runningJobIds.delete(jobId)

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

export function registerCronHandlers(): void {
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:add', handleCronAdd)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:update', handleCronUpdate)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:delete', handleCronDelete)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:toggle', handleCronToggle)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:list', handleCronList)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:run-now', handleCronRunNow)
  registerMessagePackHandler<Record<string, unknown>, unknown>('cron:run-complete', handleCronRunComplete)
}

export function releaseCronRunsAfterRendererExit(): void {
  if (runningJobIds.size === 0) return
  console.warn(`[Cron] releasing ${runningJobIds.size} active run lock(s) after renderer exit`)
  runningJobIds.clear()
}

export function initializeCronScheduler(): Promise<void> {
  return restoreJobs()
}

/** Cron handler dispatch — maps method name to handler function */
export async function handleCronReverseRequest(
  method: string,
  params: unknown
): Promise<unknown> {
  const raw = (params as Record<string, unknown>) ?? {}
  // .NET executor sends { toolName, input: {...tool params...}, parameters }
  // Extract the actual tool input from the nested `input` field
  const args = (raw.input as Record<string, unknown>) ?? raw
  switch (method) {
    case 'cron:add':
      return handleCronAdd(args)
    case 'cron:update':
      return handleCronUpdate(args)
    case 'cron:delete':
      return handleCronDelete(args)
    case 'cron:toggle':
      return handleCronToggle(args)
    case 'cron:list':
      return handleCronList(args)
    case 'cron:run-now':
      return handleCronRunNow(args)
    case 'cron:run-complete':
      return handleCronRunComplete(args)
    default:
      return { error: `Unknown cron method: ${method}` }
  }
}
