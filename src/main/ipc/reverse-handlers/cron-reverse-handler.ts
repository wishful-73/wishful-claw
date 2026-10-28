/**
 * Cron reverse-request handlers —— 入口与装配。
 *
 * S-249 把原本 760 行的单文件按职责拆到 `./cron/` 下：
 * `types`（类型）、`state`（内存状态）、`db`（库访问）、`scheduling`（定时器与触发）、
 * `handlers`（七个反向调用处理器）。本文件只做三件事：注册 MessagePack 通道、
 * 提供启动/关停钩子、把 `handleCronReverseRequest` 分发到对应处理器。
 *
 * In-memory cron job scheduler — stores jobs in a Map and uses node-cron
 * for cron-expression scheduling. One-shot ("at") and interval ("every")
 * modes use setTimeout / setInterval.
 *
 * When a job fires, it sends a `cron:fire` event to the renderer which
 * can spawn an agent run with the stored prompt.
 */

import { registerMessagePackHandler } from '../messagepack-handler'
import {
  handleCronAdd,
  handleCronDelete,
  handleCronList,
  handleCronRunComplete,
  handleCronRunNow,
  handleCronToggle,
  handleCronUpdate
} from './cron/handlers'
import { restoreJobs } from './cron/scheduling'
import { cronRunLock, cronTasks, intervals, nextRunTimes, retryTimers, timers } from './cron/state'

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
  if (cronRunLock.size === 0) return
  console.warn(`[Cron] releasing ${cronRunLock.size} active run lock(s) after renderer exit`)
  cronRunLock.releaseAll()
}

export function initializeCronScheduler(): Promise<void> {
  return restoreJobs()
}

/** Stop all scheduling timers and pending fire retries (called on app quit). */
export function shutdownCronScheduler(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  for (const i of intervals.values()) clearInterval(i)
  intervals.clear()
  for (const task of cronTasks.values()) task.stop()
  cronTasks.clear()
  nextRunTimes.clear()
  for (const t of retryTimers.values()) clearTimeout(t)
  retryTimers.clear()
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
