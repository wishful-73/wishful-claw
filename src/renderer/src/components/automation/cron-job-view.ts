export interface CronScheduleView {
  kind: 'at' | 'every' | 'cron'
  at?: number | string
  every?: number
  expr?: string
  tz?: string
}

export interface CronJobView {
  id: string
  name: string
  schedule: CronScheduleView
  prompt: string
  model?: string
  workingFolder?: string
  deliveryMode?: string
  deliveryTarget?: string | null
  pluginId?: string | null
  pluginType?: string | null
  pluginChatId?: string | null
  deleteAfterRun: boolean
  maxIterations: number
  enabled: boolean
  deletedAt: number | null
  lastFiredAt: number | null
  lastRunAt: number | null
  lastRunStatus?: string
  lastRunSummary?: string
  lastError?: string
  fireCount: number
}

export function asCronJob(value: unknown): CronJobView | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.schedule) return null
  return {
    id: record.id,
    name: String(record.name ?? ''),
    schedule: record.schedule as CronScheduleView,
    prompt: String(record.prompt ?? ''),
    model: record.model as string | undefined,
    workingFolder: record.workingFolder as string | undefined,
    deliveryMode: record.deliveryMode as string | undefined,
    deliveryTarget: record.deliveryTarget as string | null | undefined,
    pluginId: record.pluginId as string | null | undefined,
    pluginType: record.pluginType as string | null | undefined,
    pluginChatId: record.pluginChatId as string | null | undefined,
    deleteAfterRun: Boolean(record.deleteAfterRun),
    maxIterations: Number(record.maxIterations ?? 15),
    enabled: Boolean(record.enabled),
    deletedAt: (record.deletedAt as number | null) ?? null,
    lastFiredAt: (record.lastFiredAt as number | null) ?? null,
    lastRunAt: (record.lastRunAt as number | null) ?? null,
    lastRunStatus: record.lastRunStatus as string | undefined,
    lastRunSummary: record.lastRunSummary as string | undefined,
    lastError: record.lastError as string | undefined,
    fireCount: Number(record.fireCount ?? 0)
  }
}
