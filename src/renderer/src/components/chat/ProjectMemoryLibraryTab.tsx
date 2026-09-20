import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Database, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  MEMORY_TIME_RANGE_IDS,
  resolveMemoryTimeBounds,
  type MemoryTimeRangeId
} from '@renderer/lib/memory-time-range'
import {
  memoryEntries,
  memorySearch,
  type MemorySearchResult,
  type MemoryStatusEntry
} from '@renderer/stores/chat-store/memory-helpers'

/** Rows per page — the worker does the paging (iter-33 S-98). */
const PAGE_SIZE = 20

/**
 * One rendered row, normalized across the two sources below (browse page vs search hit).
 *
 * The two sources disagree on the timestamp: `memory/entries` reports `updated_at` as Unix
 * SECONDS, while `memory/search` reports it as an ISO string. Normalizing to milliseconds here
 * is what keeps the two modes rendering the same way.
 */
interface EntryRow {
  key: string
  title: string
  /** Raw worker enum values — localized at render time, never baked into the row. */
  priority: string
  status: string
  content: string
  /** Milliseconds since epoch; 0 when the source carried no parsable timestamp. */
  updatedAtMs: number
}

function fromEntry(entry: MemoryStatusEntry): EntryRow {
  return {
    key: `entry-${entry.id}`,
    title: entry.title ?? '',
    priority: entry.priority,
    status: entry.status,
    content: entry.content,
    updatedAtMs: (entry.updatedAt ?? 0) * 1000
  }
}

/**
 * `MemorySearchResult` is consumed straight off the wire (no mapping layer between the worker and
 * the renderer), and the C# record carries `Id / Title / Content / Scope / Priority / Status /
 * UpdatedAt / Score` — there is NO `key` and NO `tier` field, despite what the TS interface claims.
 * So this reads `id` and builds the meta from fields that actually exist; using `hit.key` /
 * `hit.tier` would yield `undefined` and produce duplicate React keys plus a `" · scope"` meta.
 */
function fromHit(hit: MemorySearchResult): EntryRow {
  return {
    key: `hit-${hit.id}`,
    title: hit.title,
    priority: hit.priority,
    status: hit.status,
    content: hit.content,
    updatedAtMs: Date.parse(hit.updatedAt) || 0
  }
}

/**
 * Renders the two worker enums through i18n, falling back to the raw value so a status or priority
 * this build does not know about still shows *something* rather than an empty meta column.
 *
 * The labels live under `memoryPage.entries` in the settings namespace rather than here, because
 * they describe a worker enum shared with the global memory library — one source for both pages,
 * so the two can never drift apart.
 */
function localizeMeta(
  t: (key: string, options?: { defaultValue?: string; ns?: string }) => string,
  priority: string,
  status: string
): string {
  // `ns` is spelled out even though the hook already carries `['chat', 'settings']` — the labels
  // are the one thing this page reads from another namespace, so naming it removes any doubt about
  // which bundle they come from.
  const priorityLabel = t(`memoryPage.entries.priority.${priority}`, {
    ns: 'settings',
    defaultValue: priority
  })
  const statusLabel = t(`memoryPage.entries.status.${status}`, {
    ns: 'settings',
    defaultValue: status
  })
  return `${priorityLabel} · ${statusLabel}`
}

/** Same rendering as the global tab, so a timestamp reads the same on both pages. */
function formatUpdatedAt(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(ms)
}

/**
 * Read-only memory library for one project (iter-33 S-91): every `memory_entries` row in this
 * project's scope, whatever its status, so the DB tier finally has an entry point next to the
 * hot MEMORY.md. Paged server-side in S-98, which is what lifts the old "one 200-row request"
 * ceiling. Split out of ProjectArchivePage to stay inside the 500-line budget.
 *
 * Searching was added in S-106, mirroring the global tab's two-source shape: an empty query
 * browses via `memory/entries`, a non-empty one switches to `memory/search`, and clearing the box
 * returns to browsing. Scope resolution is identical for both (`scope='project'` plus the three
 * locators — never hand-built here).
 *
 * Known asymmetry, recorded in the plan rather than fixed: `memory/entries` carries no status
 * predicate, so cold/deprecated rows are browsable; `memory/search` defaults to
 * `includeDeprecated=false`, so those same rows are not findable by search.
 *
 * Rows are collapsed by default — title + tier/status + last-modified time only, click to unfold
 * the body — matching the global tab. Entries are long-form prose, so a page of twenty expanded
 * rows is unreadable; the collapsed form also puts the timestamp in the same column on both pages.
 *
 * Scope is resolved worker-side (workingFolder for local projects, projectId + sshConnectionId
 * for SSH ones) — never hand-build the scope string here.
 */
function ProjectMemoryLibraryTab({
  projectId,
  workingFolder,
  sshConnectionId
}: {
  projectId?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
}): React.JSX.Element {
  // The `settings` namespace is pulled in for the shared priority/status enum labels only.
  const { t } = useTranslation(['chat', 'settings'])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [hits, setHits] = useState<EntryRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<MemoryTimeRangeId>('all')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Monotonic id for in-flight searches. Clearing the box while a request is on its way would
   * otherwise leave an empty input above the previous query's hit list — the response lands after
   * `setHits(null)` and unconditionally reinstates itself. Only the newest response may commit.
   */
  const searchSeq = useRef(0)

  const load = useCallback(
    async (targetPage: number): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const { from, to } = resolveMemoryTimeBounds(range)
        const result = await memoryEntries(
          'project',
          workingFolder ?? undefined,
          PAGE_SIZE,
          projectId ?? undefined,
          sshConnectionId ?? undefined,
          (targetPage - 1) * PAGE_SIZE,
          'desc',
          from,
          to
        )
        const pageTotal = result.total ?? 0
        // The list can shrink under the pager (entries removed elsewhere, a refresh after the page
        // number was set). Landing past the end would render an empty page whose only way out is
        // "previous", so snap back to the last real page and let the effect re-read it.
        const lastPage = Math.max(1, Math.ceil(pageTotal / PAGE_SIZE))
        if (targetPage > lastPage) {
          setPage(lastPage)
          return
        }
        setEntries((result.entries ?? []).map(fromEntry))
        setTotal(pageTotal)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setEntries([])
        setTotal(0)
      } finally {
        setLoading(false)
      }
    },
    [projectId, workingFolder, sshConnectionId, range]
  )

  const handleSearch = useCallback(async (): Promise<void> => {
    const trimmed = query.trim()
    if (!trimmed) {
      // Bump the sequence as well: a request already in flight must not repopulate the list after
      // the box has been cleared.
      searchSeq.current += 1
      setHits(null)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    setError(null)
    try {
      const { from, to } = resolveMemoryTimeBounds(range)
      const result = await memorySearch(
        trimmed,
        'project',
        PAGE_SIZE,
        workingFolder ?? undefined,
        projectId ?? undefined,
        sshConnectionId ?? undefined,
        from,
        to
      )
      // Enter can be pressed twice before the first response lands; only the newest request wins.
      if (seq !== searchSeq.current) return
      setHits((result.hits ?? []).map(fromHit))
    } catch (e) {
      if (seq !== searchSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setHits([])
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }, [query, range, projectId, workingFolder, sshConnectionId])

  const browsing = hits === null

  // Browse mode only. A search hit list is one bounded response, so there is nothing to re-read
  // when its page flips — and re-reading here would overwrite `entries` / `total` underneath a
  // search view that no longer displays them.
  useEffect(() => {
    if (hits === null) void load(page)
  }, [load, page, hits])

  // Re-run the query when the time-range chips change while a search is active. The global tab
  // deliberately does NOT do this (it only resets the page), which leaves the hit list showing
  // results from the previous range until the user presses Search again — that reads as a bug.
  useEffect(() => {
    if (hits !== null) void handleSearch()
    // `hits` is intentionally absent: this must fire on a range change, not on every new result
    // set (which would loop). `handleSearch` already closes over the current range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  // Switching project, or moving between browse and search, invalidates the page number — page 3
  // of the previous list says nothing about this one.
  //
  // Search state is dropped here too: the tab is not remounted when the active project changes
  // (only an explicit refresh bumps the parent's `reloadToken`), so a hit list belonging to the
  // previous project would otherwise linger on screen under the new project's name.
  //
  // The time-range chips are deliberately NOT in these dependencies: they reset the page in their
  // own click handler. If they relied on this effect, an in-flight browse request issued for the
  // old page would land afterwards, find its page number past the end of the new (smaller) range,
  // and clamp the user to the last page instead of the first.
  useEffect(() => {
    searchSeq.current += 1
    setPage(1)
    setHits(null)
    setQuery('')
  }, [projectId, workingFolder, sshConnectionId])

  const toggleRow = useCallback((key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const rowCount = browsing ? total : (hits?.length ?? 0)
  const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = browsing
    ? entries
    : (hits ?? []).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const hasRows = pageRows.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Database className="size-4 shrink-0" />
          <span className="truncate text-xs">
            {t('projectArchive.memoryLibrary.desc', {
              defaultValue: 'Entries stored in the local memory database for this project.'
            })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 rounded-md px-2.5 text-xs"
          onClick={() => (browsing ? void load(currentPage) : void handleSearch())}
          disabled={loading || searching}
        >
          {loading || searching ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-3" />
          )}
          {t('projectArchive.memoryLibrary.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              const next = e.target.value
              setQuery(next)
              // Clearing the box returns the list to browsing; search itself is an explicit
              // action (Enter / button), so there is no debounce.
              //
              // The sequence bump is load-bearing: the Search button is disabled while a request
              // is in flight, so clearing the box mid-flight can only arrive through here. Without
              // it the response lands after `setHits(null)` and reinstates the results the user
              // just dismissed, leaving an empty box above a stale hit list.
              if (!next.trim()) {
                searchSeq.current += 1
                setHits(null)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch()
            }}
            placeholder={t('projectArchive.memoryLibrary.searchPlaceholder', {
              defaultValue: "Search this project's memory…"
            })}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          className="h-8 rounded-md px-3 text-xs"
          onClick={() => void handleSearch()}
          disabled={searching || !query.trim()}
        >
          {searching ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <Search className="mr-1 size-3" />
          )}
          {t('projectArchive.memoryLibrary.search', { defaultValue: 'Search' })}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {MEMORY_TIME_RANGE_IDS.map((id) => (
          <Button
            key={id}
            variant={range === id ? 'default' : 'outline'}
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => {
              setRange(id)
              setPage(1)
            }}
          >
            {t(`projectArchive.memoryLibrary.ranges.${id}`, { defaultValue: id })}
          </Button>
        ))}
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 flex-1 overflow-auto">
        {loading && !hasRows ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('projectArchive.memoryLibrary.loading', { defaultValue: 'Loading…' })}
          </div>
        ) : !hasRows ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
            <Database className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {browsing
                ? t('projectArchive.memoryLibrary.empty', {
                    defaultValue: 'No memory entries stored for this project yet.'
                  })
                : t('projectArchive.memoryLibrary.noResults', {
                    defaultValue: 'No matching memory entries.'
                  })}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {pageRows.map((row) => {
              const isOpen = expandedKeys.has(row.key)
              return (
                <li
                  key={row.key}
                  className="overflow-hidden rounded-md border border-border/60 bg-background/60"
                >
                  <button
                    type="button"
                    onClick={() => toggleRow(row.key)}
                    aria-expanded={isOpen}
                    title={t('projectArchive.memoryLibrary.rowHint', {
                      defaultValue: 'Click to expand or collapse'
                    })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        isOpen && 'rotate-90'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {row.title ||
                        t('projectArchive.memoryLibrary.untitled', { defaultValue: 'Untitled' })}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                      {localizeMeta(t, row.priority, row.status)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">
                      {row.updatedAtMs > 0 ? formatUpdatedAt(row.updatedAtMs) : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <p className="whitespace-pre-wrap break-words border-t border-border/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {row.content}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {rowCount > 0 && (
        <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2">
          <span className="text-[11px] text-muted-foreground">
            {browsing
              ? t('projectArchive.memoryLibrary.total', {
                  count: total,
                  defaultValue: '{{count}} entries'
                })
              : t('projectArchive.memoryLibrary.matches', {
                  count: hits?.length ?? 0,
                  defaultValue: '{{count}} matches'
                })}
          </span>
          {totalPages > 1 && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2 text-xs"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1 || loading}
              >
                {t('projectArchive.memoryLibrary.prevPage', { defaultValue: 'Prev' })}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {t('projectArchive.memoryLibrary.pageOf', {
                  page: currentPage,
                  total: totalPages,
                  defaultValue: 'Page {{page}} / {{total}}'
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2 text-xs"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages || loading}
              >
                {t('projectArchive.memoryLibrary.nextPage', { defaultValue: 'Next' })}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProjectMemoryLibraryTab
