import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  Play,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { cronEvents, type CronEvent } from '@renderer/lib/tools/cron-events'

interface CronScheduleView {
  kind: 'at' | 'every' | 'cron'
  at?: number | string
  every?: number
  expr?: string
  tz?: string
}

interface CronJobView {
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

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'success' | 'error'

interface CronJobResponse {
  error?: string
}

function asJob(value: unknown): CronJobView | null {
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

function formatSchedule(schedule: CronScheduleView): string {
  if (schedule.kind === 'at') {
    const ts = typeof schedule.at === 'number' ? schedule.at : Date.parse(String(schedule.at))
    return Number.isNaN(ts) ? `at ${String(schedule.at)}` : new Date(ts).toLocaleString()
  }
  if (schedule.kind === 'every') {
    const ms = schedule.every ?? 0
    if (ms % 3_600_000 === 0) return `every ${ms / 3_600_000}h`
    if (ms % 60_000 === 0) return `every ${ms / 60_000}m`
    return `every ${Math.round(ms / 1000)}s`
  }
  return `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`
}

/** Rough next-run estimate; exact timers live in the Main scheduler. */
function estimateNextRun(job: CronJobView): string | null {
  if (!job.enabled || job.deletedAt) return null
  const { schedule } = job
  if (schedule.kind === 'at') {
    const ts = typeof schedule.at === 'number' ? schedule.at : Date.parse(String(schedule.at))
    return Number.isNaN(ts) ? null : new Date(ts).toLocaleString()
  }
  if (schedule.kind === 'every' && job.lastFiredAt && schedule.every) {
    const next = job.lastFiredAt + schedule.every
    return next > Date.now() ? new Date(next).toLocaleString() : null
  }
  return null
}

export function AutomationPage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [jobs, setJobs] = useState<CronJobView[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await ipcClient.invoke('cron:list', {})
      const list = Array.isArray(result) ? result : []
      setJobs(list.map(asJob).filter((job): job is CronJobView => job !== null && !job.deletedAt))
    } catch (error) {
      console.error('[AutomationPage] failed to load jobs:', error)
      toast.error(t('automation.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
    // Live status updates from cron runtime events
    const unsubscribe = cronEvents.on((event: CronEvent): void => {
      if (event.type === 'run_started') {
        setRunningIds((prev) => new Set(prev).add(event.jobId))
      } else if (event.type === 'run_finished' || event.type === 'job_removed') {
        setRunningIds((prev) => {
          const next = new Set(prev)
          next.delete(event.jobId)
          return next
        })
        if (event.type === 'run_finished' || event.type === 'job_removed') void refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  const toggleJob = useCallback(
    async (job: CronJobView, enabled: boolean): Promise<void> => {
      try {
        const result = (await ipcClient.invoke('cron:toggle', {
          jobId: job.id,
          enabled
        })) as CronJobResponse
        if (result?.error) throw new Error(result.error)
        setJobs((prev) =>
          prev.map((candidate) =>
            candidate.id === job.id ? { ...candidate, enabled } : candidate
          )
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    []
  )

  const deleteJob = useCallback(
    async (job: CronJobView): Promise<void> => {
      try {
        const result = (await ipcClient.invoke('cron:delete', {
          jobId: job.id
        })) as CronJobResponse
        if (result?.error) throw new Error(result.error)
        setJobs((prev) => prev.filter((candidate) => candidate.id !== job.id))
        toast.success(t('automation.deleted'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [t]
  )

  const runNow = useCallback(
    async (job: CronJobView): Promise<void> => {
      setRunningIds((prev) => new Set(prev).add(job.id))
      try {
        const result = (await ipcClient.invoke('cron:run-now', {
          jobId: job.id
        })) as CronJobResponse
        if (result?.error) throw new Error(result.error)
        toast.success(t('automation.runTriggered', { name: job.name }))
      } catch (error) {
        setRunningIds((prev) => {
          const next = new Set(prev)
          next.delete(job.id)
          return next
        })
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [t]
  )

  const filteredJobs = useMemo(() => {
    switch (filter) {
      case 'enabled':
        return jobs.filter((job) => job.enabled)
      case 'disabled':
        return jobs.filter((job) => !job.enabled)
      case 'success':
        return jobs.filter((job) => job.lastRunStatus === 'success')
      case 'error':
        return jobs.filter((job) => job.lastRunStatus === 'error' || Boolean(job.lastError))
      default:
        return jobs
    }
  }, [jobs, filter])

  const filters: StatusFilter[] = ['all', 'enabled', 'disabled', 'success', 'error']

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('automation.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} title={t('automation.refresh')}>
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" disabled title={t('automation.formComingSoon')}>
            <Plus className="mr-1 size-4" />
            {t('automation.newTask')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 px-6 py-3">
        {filters.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setFilter(candidate)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              filter === candidate
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {t(`automation.filter.${candidate}`)}
          </button>
        ))}
      </div>

      {/* Job list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('automation.loading')}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {jobs.length === 0 ? t('automation.empty') : t('automation.noMatch')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredJobs.map((job) => {
              const running = runningIds.has(job.id)
              const expanded = expandedId === job.id
              const nextRun = estimateNextRun(job)
              return (
                <div key={job.id} className="rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Switch
                      checked={job.enabled}
                      onCheckedChange={(checked) => void toggleJob(job, checked)}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedId(expanded ? null : job.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{job.name}</span>
                        {running && (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                        )}
                        {job.lastRunStatus === 'success' && (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        )}
                        {(job.lastRunStatus === 'error' || job.lastError) && (
                          <XCircle className="size-3.5 shrink-0 text-destructive" />
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{formatSchedule(job.schedule)}</span>
                        {nextRun && <span>· {t('automation.nextRun')}: {nextRun}</span>}
                        {job.lastRunAt && (
                          <span>
                            · {t('automation.lastRun')}: {new Date(job.lastRunAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={running}
                        onClick={() => void runNow(job)}
                        title={t('automation.runNow')}
                      >
                        {running ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void deleteJob(job)}
                        title={t('automation.delete')}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setExpandedId(expanded ? null : job.id)}
                      >
                        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-border px-4 py-3 text-xs">
                      <div className="mb-2 whitespace-pre-wrap text-muted-foreground">
                        {job.prompt.length > 300 ? `${job.prompt.slice(0, 300)}…` : job.prompt}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>
                          {t('automation.fireCount')}: {job.fireCount}
                        </span>
                        <span>
                          {t('automation.delivery')}:{' '}
                          {job.pluginId
                            ? `${job.pluginType ?? 'plugin'}:${job.pluginChatId ?? '-'}`
                            : (job.deliveryMode ?? 'desktop')}
                        </span>
                        <span>
                          {t('automation.maxIterations')}: {job.maxIterations}
                        </span>
                        {job.model && (
                          <span>
                            {t('automation.model')}: {job.model}
                          </span>
                        )}
                        {job.workingFolder && (
                          <span className="truncate">
                            {t('automation.workingFolder')}: {job.workingFolder}
                          </span>
                        )}
                      </div>
                      {job.lastRunSummary && (
                        <div className="mt-2 rounded bg-muted/50 p-2 text-muted-foreground">
                          {job.lastRunSummary.length > 400
                            ? `${job.lastRunSummary.slice(0, 400)}…`
                            : job.lastRunSummary}
                        </div>
                      )}
                      {job.lastError && (
                        <div className="mt-2 flex items-start gap-1.5 rounded bg-destructive/10 p-2 text-destructive">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span className="break-all">{job.lastError}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
        <Power className="mr-1 inline size-3" />
        {t('automation.hint')}
      </div>
    </div>
  )
}
