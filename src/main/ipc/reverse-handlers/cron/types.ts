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
