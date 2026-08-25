import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import type { CronJobView } from './cron-job-view'

interface AutomationCalendarProps {
  jobs: CronJobView[]
  runningIds: Set<string>
  onSelectJob: (jobId: string) => void
}

interface CalendarCell {
  date: Date
  inMonth: boolean
  isToday: boolean
  entries: { job: CronJobView; timeLabel: string | null }[]
}

const WEEKDAY_KEYS = [
  'automation.calendar.sun',
  'automation.calendar.mon',
  'automation.calendar.tue',
  'automation.calendar.wed',
  'automation.calendar.thu',
  'automation.calendar.fri',
  'automation.calendar.sat'
]

function startOfMonthGrid(monthAnchor: Date): Date {
  return new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Return the scheduler-provided next occurrence when it falls on the given day. */
function occurrenceOnDay(job: CronJobView, day: Date): number | null {
  if (!job.nextRunAt) return null
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  return job.nextRunAt >= dayStart && job.nextRunAt < nextDay ? job.nextRunAt : null
}

export function AutomationCalendar({
  jobs,
  runningIds,
  onSelectJob
}: AutomationCalendarProps): React.JSX.Element {
  const { t, i18n } = useTranslation('layout')
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const cells = useMemo<CalendarCell[]>(() => {
    const first = startOfMonthGrid(monthAnchor)
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - first.getDay()) // back to Sunday

    const today = new Date()
    const result: CalendarCell[] = []
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + i)
      const entries: CalendarCell['entries'] = []
      for (const job of jobs) {
        if (!job.enabled || job.deletedAt) continue
        const ts = occurrenceOnDay(job, date)
        if (ts !== null) {
          entries.push({ job, timeLabel: new Date(ts).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })
        }
      }
      entries.sort((a, b) => (a.timeLabel ?? '').localeCompare(b.timeLabel ?? ''))
      result.push({ date, inMonth: date.getMonth() === monthAnchor.getMonth(), isToday: sameDay(date, today), entries })
    }
    return result
  }, [jobs, monthAnchor, i18n.language])

  const monthLabel = monthAnchor.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' })

  const shiftMonth = (delta: number): void => {
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="text-sm font-medium">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px pb-1">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="px-1 text-center text-xs text-muted-foreground">
            {t(key)}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {cells.map((cell) => (
          <div
            key={cell.date.toISOString()}
            className={`flex min-h-0 flex-col overflow-hidden bg-card p-1 text-xs ${
              cell.inMonth ? '' : 'opacity-40'
            }`}
          >
            <div
              className={`mb-0.5 px-0.5 text-[10px] ${
                cell.isToday
                  ? 'inline-flex size-4 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {cell.date.getDate()}
            </div>
            <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
              {cell.entries.map(({ job, timeLabel }) => {
                const running = runningIds.has(job.id)
                const hasError = job.lastRunStatus === 'error' || Boolean(job.lastError)
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onSelectJob(job.id)}
                    title={`${job.name}${timeLabel ? ` · ${timeLabel}` : ''}`}
                    className={`flex shrink-0 items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-muted ${
                      running
                        ? 'bg-primary/15 text-primary'
                        : hasError
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-muted/60'
                    }`}
                  >
                    {running ? (
                      <Loader2 className="size-2.5 shrink-0 animate-spin" />
                    ) : (
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          hasError ? 'bg-destructive' : 'bg-emerald-500'
                        }`}
                      />
                    )}
                    <span className="truncate">{job.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
