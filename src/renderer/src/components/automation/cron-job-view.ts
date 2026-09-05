import type { ReasoningEffortLevel } from '@shared/types/provider'

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
  scope: 'global' | 'project'
  projectId?: string | null
  outputMode: 'none' | 'new_session' | 'reuse_session' | 'bot'
  reuseSessionId?: string | null
  runMode: 'background' | 'session'
  agentId?: string | null
  sessionId?: string | null
  model?: string
  thinkingEnabled?: boolean | null
  reasoningEffort?: ReasoningEffortLevel | null
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
  nextRunAt: number | null
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
    scope: record.scope === 'project' ? 'project' : 'global',
    projectId: record.projectId as string | null | undefined ?? record.project_id as string | null | undefined,
    outputMode: record.outputMode as CronJobView['outputMode'] ?? record.output_mode as CronJobView['outputMode']
      ?? (record.pluginId || record.plugin_id
        ? 'bot'
        : record.deliveryMode === 'session' || record.delivery_mode === 'session'
          ? 'reuse_session'
          : record.deliveryMode === 'none' || record.delivery_mode === 'none' ? 'none' : 'new_session'),
    reuseSessionId: record.reuseSessionId as string | null | undefined ?? record.reuse_session_id as string | null | undefined
      ?? ((record.deliveryMode === 'session' || record.delivery_mode === 'session')
        ? record.deliveryTarget as string | null | undefined ?? record.delivery_target as string | null | undefined
        : undefined),
    runMode: (record.runMode === 'session' || record.run_mode === 'session') ? 'session' : 'background',
    agentId: record.agentId as string | null | undefined ?? record.agent_id as string | null | undefined,
    sessionId: record.sessionId as string | null | undefined ?? record.session_id as string | null | undefined,
    model: record.model as string | undefined,
    thinkingEnabled: typeof (record.thinkingEnabled ?? record.thinking_enabled) === 'boolean'
      ? (record.thinkingEnabled ?? record.thinking_enabled) as boolean
      : null,
    reasoningEffort: record.reasoningEffort as ReasoningEffortLevel | null | undefined
      ?? record.reasoning_effort as ReasoningEffortLevel | null | undefined
      ?? null,
    workingFolder: record.workingFolder as string | undefined ?? record.working_folder as string | undefined,
    deliveryMode: record.deliveryMode as string | undefined ?? record.delivery_mode as string | undefined,
    deliveryTarget: record.deliveryTarget as string | null | undefined ?? record.delivery_target as string | null | undefined,
    pluginId: record.pluginId as string | null | undefined ?? record.plugin_id as string | null | undefined,
    pluginType: record.pluginType as string | null | undefined ?? record.plugin_type as string | null | undefined,
    pluginChatId: record.pluginChatId as string | null | undefined ?? record.plugin_chat_id as string | null | undefined,
    deleteAfterRun: Boolean(record.deleteAfterRun),
    maxIterations: Number(record.maxIterations ?? 15),
    enabled: Boolean(record.enabled),
    deletedAt: (record.deletedAt as number | null) ?? null,
    lastFiredAt: (record.lastFiredAt as number | null) ?? null,
    nextRunAt: (record.nextRunAt as number | null) ?? null,
    lastRunAt: (record.lastRunAt as number | null) ?? null,
    lastRunStatus: record.lastRunStatus as string | undefined,
    lastRunSummary: record.lastRunSummary as string | undefined,
    lastError: record.lastError as string | undefined,
    fireCount: Number(record.fireCount ?? 0)
  }
}
