/**
 * 定时任务的调度核心：计划校验、按 at / every / cron 起停定时器、触发与重试。
 *
 * S-249 从 `cron-reverse-handler.ts` 搬出。这里的每个函数都要读写 `./state` 里那六张表，
 * 所以状态只搬不改，表还是同一份引用。
 *
 * `restoreJobs` 住在这一层而不是 `db.ts`：它需要 `scheduleJob`，放过去会和 db 形成环。
 */

import cron from 'node-cron'
import { safeSendMessagePackToWindow } from '../../../window-ipc'
import { getMainWindow } from '../../../main-window-registry'
import { dbRequest, fromDbRow } from './db'
import {
  jobs,
  timers,
  intervals,
  cronTasks,
  nextRunTimes,
  retryTimers,
  cronRunLock,
  MAX_TIMEOUT_DELAY,
  FIRE_RETRY_DELAY_MS,
  MAX_FIRE_RETRIES
} from './state'
import type { CronJob, CronSchedule } from './types'

let restorePromise: Promise<void> | null = null
let restored = false

export function normalizeSchedule(schedule: CronSchedule): CronSchedule {
  if (schedule.kind !== 'at' || typeof schedule.at !== 'string') return schedule
  const match = /^\+(\d+)([smhd])$/.exec(schedule.at.trim())
  if (!match) return schedule
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return { ...schedule, at: Date.now() + Number(match[1]) * multipliers[match[2]] }
}

export function usesTargetSessionModel(job: Pick<CronJob, 'runMode' | 'outputMode'>): boolean {
  return job.runMode === 'session' && job.outputMode === 'reuse_session'
}

export function clearTaskModel(job: CronJob): void {
  if (!usesTargetSessionModel(job)) return
  job.agentId = undefined
  job.model = undefined
  job.thinkingEnabled = null
  job.reasoningEffort = null
}

export async function restoreJobs(): Promise<void> {
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

export function resolveTimestamp(value: number | string | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function validateTimeZone(timeZone: string): string | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return null
  } catch {
    return `schedule.tz is not a valid IANA timezone: "${timeZone}"`
  }
}

export function validateSchedule(schedule: CronSchedule): string | null {
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

export function clearJobTimers(jobId: string): void {
  const t = timers.get(jobId)
  if (t) { clearTimeout(t); timers.delete(jobId) }
  const i = intervals.get(jobId)
  if (i) { clearInterval(i); intervals.delete(jobId) }
  const task = cronTasks.get(jobId)
  if (task) { task.stop(); cronTasks.delete(jobId) }
  const retry = retryTimers.get(jobId)
  if (retry) { clearTimeout(retry); retryTimers.delete(jobId) }
  nextRunTimes.delete(jobId)
}

export function buildFirePayload(job: CronJob, fireId: string, firedAt: number): Record<string, unknown> {
  return {
    jobId: job.id,
    fireId,
    name: job.name,
    prompt: job.prompt,
    agentId: job.agentId,
    model: job.model,
    thinkingEnabled: job.thinkingEnabled,
    reasoningEffort: job.reasoningEffort,
    workingFolder: job.workingFolder,
    sessionId: job.sessionId,
    scope: job.scope ?? 'global',
    projectId: job.projectId,
    outputMode: job.outputMode ?? 'new_session',
    reuseSessionId: job.reuseSessionId,
    runMode: job.runMode ?? 'background',
    firedAt,
    deliveryMode: job.deliveryMode ?? 'desktop',
    deliveryTarget: job.deliveryTarget,
    deleteAfterRun: job.deleteAfterRun ?? false,
    pluginId: job.pluginId,
    pluginType: job.pluginType,
    pluginChatId: job.pluginChatId,
    maxIterations: job.maxIterations ?? 15
  }
}

/**
 * Retry delivering a one-shot fire to the renderer. One-shot jobs get no
 * second chance from the scheduler, so when the main window is unavailable
 * at fire time the trigger would otherwise be silently lost.
 */
export function scheduleFireRetry(job: CronJob, fireId: string, firedAt: number, attempt = 1): void {
  if (attempt > MAX_FIRE_RETRIES) {
    console.error(`[Cron] one-shot job ${job.id} delivery abandoned after ${MAX_FIRE_RETRIES} retries — trigger lost`)
    return
  }
  const timer = setTimeout(() => {
    retryTimers.delete(job.id)
    const current = jobs.get(job.id)
    if (!current || current.deletedAt) return
    const win = getMainWindow()
    const sent = Boolean(win && safeSendMessagePackToWindow(win, 'cron:fire', buildFirePayload(current, fireId, firedAt)))
    if (!sent) scheduleFireRetry(job, fireId, firedAt, attempt + 1)
  }, FIRE_RETRY_DELAY_MS)
  retryTimers.set(job.id, timer)
}

export async function fireJob(job: CronJob, consumeOneShot = false): Promise<boolean> {
  const firedAt = Date.now()
  const fireId = `${job.id}:${firedAt}:${Math.random().toString(36).slice(2, 10)}`
  if (!cronRunLock.tryAcquire(job.id, fireId)) return false
  try {
    await dbRequest('db/crons-mark-fired', { id: job.id, firedAt, disable: consumeOneShot })
  } catch (error) {
    cronRunLock.release(job.id, fireId)
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
  const sent = Boolean(win && safeSendMessagePackToWindow(win, 'cron:fire', buildFirePayload(job, fireId, firedAt)))

  if (!sent) {
    cronRunLock.release(job.id, fireId)
    if (consumeOneShot) {
      scheduleFireRetry(job, fireId, firedAt)
      console.warn(`[Cron] renderer unavailable for one-shot job ${job.id}, delivery retries scheduled`)
    } else {
      console.warn(`[Cron] renderer unavailable for job ${job.id}`)
    }
    return false
  }

  // One-shot jobs stop scheduling immediately, but stay queryable until the
  // renderer finishes execution and asks Main to archive the task.
  if (job.deleteAfterRun) clearJobTimers(job.id)
  return true
}

export function scheduleJob(job: CronJob): boolean {
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