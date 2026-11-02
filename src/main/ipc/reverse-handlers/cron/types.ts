/**
 * 定时任务的共享类型。
 *
 * S-249 从 `cron-reverse-handler.ts` 搬出。原文件里这两个接口是文件内私有，
 * 拆开后跨文件可见，故一并 export —— **只加可见性，字段一字未改**。
 */

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  at?: number | string
  every?: number
  expr?: string
  tz?: string
}

/**
 * 定时任务轮次上限的默认值。**0 = 不限**，与主聊天（`use-chat-actions.ts` 的
 * `maxIterations: 0`）以及 `AgentLoop.cs` 的 `0 = unlimited` 保持同一语义。
 *
 * S-299：原来这里散落着五处 `?? 15`，把「0 = 不限」反向解释成「0 = 没填 = 15」，
 * 于是用户改成不限却看起来没生效。默认值统一收在这个常量里，改一处即可。
 *
 * ⚠️ 不要用「填个更大的数字」来「放宽」——轮次跟任务复杂度没有比例关系，
 * 同样的 15 轮可能是 20 秒也可能是 45 分钟，它当不了护栏。
 */
export const DEFAULT_MAX_ITERATIONS = 0

export interface CronJob {
  id: string
  name: string
  sessionId?: string
  scope?: 'global' | 'project'
  projectId?: string
  outputMode?: 'new_session' | 'reuse_session' | 'bot'
  reuseSessionId?: string
  runMode?: 'background' | 'session'
  schedule: CronSchedule
  prompt: string
  agentId?: string
  model?: string
  thinkingEnabled?: boolean | null
  reasoningEffort?: string | null
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
