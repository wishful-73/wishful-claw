import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { History, Loader2 } from 'lucide-react'

/**
 * Agent timeline panel (S-25, iteration 29).
 * Shows decision-level agent events (task dispatch/report, todo transitions,
 * cron firings, sub-agent runs) from agent_timeline_events, newest first.
 * Scope toggles between the panel's session and the global feed; pages load
 * more via the (beforeCreatedAt, beforeId) cursor.
 */

interface AgentTimelineEventRow {
  id: number
  sessionId: string | null
  projectId: string | null
  eventType: string
  message: string | null
  metadataJson: string | null
  createdAt: number
}

interface AgentTimelinePageResult {
  items: AgentTimelineEventRow[]
  hasMore: boolean
  nextCreatedAt: number | null
  nextId: number | null
}

type TimelineScope = 'session' | 'global'

const PAGE_SIZE = 60

export function TimelinePanel({
  sessionId
}: {
  sessionId: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [scope, setScope] = React.useState<TimelineScope>('session')
  const [events, setEvents] = React.useState<AgentTimelineEventRow[]>([])
  const [cursor, setCursor] = React.useState<{ createdAt: number; id: number } | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // `session` scope filters to this session; `global` is unfiltered — the backend
  // takes neither sessionId nor projectId and returns every row, app-level ones
  // included. (Filtering the global feed by the active project made the "all
  // sessions" label a lie: with a project open you only ever saw that project.)
  const activeSessionId = scope === 'session' ? sessionId : null

  const loadPage = React.useCallback(
    async (next: boolean) => {
      if (scope === 'session' && !sessionId && !next) {
        // Session scope without a session id: nothing to query yet.
        setEvents([])
        setHasMore(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const params: Record<string, unknown> = { limit: PAGE_SIZE }
        if (activeSessionId) params.sessionId = activeSessionId
        if (next && cursor) {
          params.beforeCreatedAt = cursor.createdAt
          params.beforeId = cursor.id
        }
        const result = await window.api.workerRequest<AgentTimelinePageResult>(
          'db/agent-timeline-list-page',
          params
        )
        setEvents((prev) => (next ? [...prev, ...result.items] : result.items))
        setHasMore(result.hasMore)
        setCursor(
          result.hasMore && result.nextCreatedAt !== null && result.nextId !== null
            ? { createdAt: result.nextCreatedAt, id: result.nextId }
            : null
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [activeSessionId, cursor, scope, sessionId]
  )

  // Reset + reload whenever scope or session changes.
  React.useEffect(() => {
    setEvents([])
    setCursor(null)
    setHasMore(false)
    void loadPage(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeSessionId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('timeline.title')}</span>
        </div>
        <div className="flex items-center rounded-md border border-border text-[11px]">
          <button
            onClick={() => setScope('session')}
            className={
              'px-2 py-0.5 transition-colors ' +
              (scope === 'session'
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {t('timeline.scopeSession')}
          </button>
          <button
            onClick={() => setScope('global')}
            className={
              'px-2 py-0.5 transition-colors ' +
              (scope === 'global'
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {t('timeline.scopeGlobal')}
          </button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <div className="py-4 text-center text-xs text-destructive">{error}</div>
        ) : events.length === 0 && !loading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {t('timeline.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <TimelineEventRow key={event.id} event={event} t={t} />
            ))}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {!loading && hasMore ? (
          <div className="py-2 text-center">
            <button
              onClick={() => void loadPage(true)}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('timeline.loadMore')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TimelineEventRow({
  event,
  t
}: {
  event: AgentTimelineEventRow
  t: (key: string, options?: Record<string, unknown>) => string
}): React.JSX.Element {
  const typeLabel = t(`timeline.events.${event.eventType}`, { defaultValue: event.eventType })
  return (
    <div className="flex gap-2 text-xs">
      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{typeLabel}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {new Date(event.createdAt).toLocaleString()}
          </span>
        </div>
        {event.message ? (
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
            {event.message}
          </p>
        ) : null}
        {!event.sessionId ? (
          <span className="mt-0.5 inline-block rounded bg-muted px-1 text-[10px] text-muted-foreground">
            {t('timeline.appLevel')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
