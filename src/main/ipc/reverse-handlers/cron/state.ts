/**
 * 定时任务的全部内存状态。
 *
 * S-249 从 `cron-reverse-handler.ts` 搬出。六张表 + 一把运行锁都是 Map / 对象（引用不变），
 * 各模块 import 后直接原地读写 —— 因此**没有 setter**，只有 `idCounter` 这种标量跟着
 * `generateId` 一起住在本文件里，不外露。
 *
 * 谁能看到这张表：`db.ts`（恢复与加载）、`scheduling.ts`（起停定时器、发事件）、
 * `handlers.ts`（增删改查）、入口文件（关停）。
 */

import cron from 'node-cron'
import { CronRunLock } from '../cron-execution-coordinator'
import type { CronJob } from './types'

export const jobs = new Map<string, CronJob>()
export const timers = new Map<string, ReturnType<typeof setTimeout>>()
export const intervals = new Map<string, ReturnType<typeof setInterval>>()
export const cronTasks = new Map<string, ReturnType<typeof cron.schedule>>()
export const nextRunTimes = new Map<string, number>()
export const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
export const cronRunLock = new CronRunLock()

export const MAX_TIMEOUT_DELAY = 2_147_000_000
export const FIRE_RETRY_DELAY_MS = 30_000
export const MAX_FIRE_RETRIES = 10

let idCounter = 0

export function generateId(): string {
  idCounter += 1
  return `cron-${Date.now().toString(36)}-${idCounter}`
}
