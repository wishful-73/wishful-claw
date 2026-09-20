import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ChevronRight, Database, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  memoryEntries,
  memorySearch,
  type MemorySearchResult,
  type MemoryStatusEntry
} from '@renderer/stores/chat-store/memory-helpers'
import { SettingsSection } from './settings-primitives'

/**
 * Rows per page. Paging is server-side (iter-33 S-98): this is the `limit` sent to
 * `memory/entries`, and the worker's `LIMIT`/`OFFSET` plus the `total` it returns drive the
 * pager — so there is no browsing ceiling, and flipping the sort or stepping a page re-reads
 * from the database instead of re-slicing a fixed snapshot.
 */
const PAGE_SIZE = 20

/** One rendered row, normalized across the two sources below (browse list vs search hit). */
interface EntryRow {
  key: string
  title: string
  meta: string
  content: string
  /** Milliseconds since epoch; 0 when the source carried no parsable timestamp. */
  updatedAtMs: number
}

function fromEntry(entry: MemoryStatusEntry): EntryRow {
  return {
    key: `entry-${entry.id}`,
    title: entry.title ?? '',
    meta: `${entry.priority} · ${entry.status}`,
    content: entry.content,
    // memory/entries reports updated_at as Unix SECONDS (MemoryEntryRow.UpdatedAt is a long).
    updatedAtMs: (entry.updatedAt ?? 0) * 1000
  }
}

function fromHit(hit: MemorySearchResult): EntryRow {
  return {
    key: `hit-${hit.key}`,
    title: hit.title,
    meta: `${hit.tier} · ${hit.scope}`,
    content: hit.content,
    // memory/search reports updated_at as an ISO string (MemorySearchResult.UpdatedAt is DateTimeOffset).
    updatedAtMs: Date.parse(hit.updatedAt) || 0
  }
}

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(ms)
}

/**
 * Global memory library — the `memory_entries` rows in scope `global` (iter-33 S-96, list
 * presentation reworked in S-97, paging moved server-side in S-98). Read-only: the DB tier is
 * derived data, and the editable surface for hand-tuning memory is the hot tab next door.
 *
 * Two sources, one list: an empty query browses everything in the scope via `memory/entries`
 * (which, unlike `memory/entries-by-status`, carries no status predicate), a non-empty query
 * switches to `memory/search`. Clearing the query returns to browsing.
 *
 * Browsing is paged by the worker — one page per request, with the scope's total coming back
 * alongside — because the query used to be `LIMIT`-bounded with no `OFFSET`, which put a hard
 * ceiling on what could ever be read. Search hits are a single bounded response and stay
 * client-side.
 *
 * Rows are collapsed by default (title + tier/status + last-modified time only) because entries
 * are long-form prose and an expanded list of hundreds is unreadable; the timestamp is the
 * last-modified one, which is what makes "when did this change" answerable at a glance.
 *
 * Scope is hard-coded to `global` because this is the global settings page.
 */
function MemoryEntriesTab(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [hits, setHits] = useState<EntryRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newestFirst, setNewestFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  /** Reads exactly one page from the worker; nothing is sliced here any more. */
  const load = useCallback(async (targetPage: number, newest: boolean): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryEntries(
        'global',
        undefined,
        PAGE_SIZE,
        undefined,
        undefined,
        (targetPage - 1) * PAGE_SIZE,
        newest ? 'desc' : 'asc'
      )
      setEntries((result.entries ?? []).map(fromEntry))
      setTotal(result.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  // Browse mode only. A search hit list is one bounded response with its own client-side
  // slicing, so there is nothing to re-read when its page flips.
  useEffect(() => {
    if (hits === null) void load(page, newestFirst)
  }, [load, page, newestFirst, hits])

  const handleSearch = useCallback(async (): Promise<void> => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits(null)
      return
    }
    setSearching(true)
    setError(null)
    try {
      const result = await memorySearch(trimmed, 'global', 20)
      setHits((result.hits ?? []).map(fromHit))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setHits([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const browsing = hits === null

  // Browsing: the worker applied the ordering already, so its page is served as-is. Searching:
  // the hit list arrives in one bounded response and is ordered here, the way it always was.
  const rows = useMemo(() => {
    if (browsing) return entries
    const copy = [...(hits ?? [])]
    copy.sort((a, b) =>
      newestFirst ? b.updatedAtMs - a.updatedAtMs : a.updatedAtMs - b.updatedAtMs
    )
    return copy
  }, [browsing, entries, hits, newestFirst])

  const rowCount = browsing ? total : rows.length
  const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = browsing
    ? rows
    : rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // A new result set (search on/off) or a sort flip starts reading from the top. `rows` is
  // deliberately NOT a dependency: in browse mode it changes on every page turn, which would
  // otherwise kick the pager back to page 1 in a loop.
  useEffect(() => {
    setPage(1)
  }, [hits, newestFirst])

  const toggleRow = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const browsingNothing = !loading && browsing && rowCount === 0

  return (
    <SettingsSection
      id="sec-memory-entries"
      title={t('memoryPage.entries.title')}
      description={t('memoryPage.entries.desc')}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-md px-2.5 text-xs"
          onClick={() => void load(currentPage, newestFirst)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-3" />
          )}
          {t('memoryPage.entries.refresh')}
        </Button>
      }
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              const next = e.target.value
              setQuery(next)
              // Clearing the box returns the list to browsing; there is no
              // debounce because search is an explicit action (Enter / button).
              if (!next.trim()) setHits(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch()
            }}
            placeholder={t('memoryPage.entries.searchPlaceholder')}
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
          {t('memoryPage.entries.search')}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {rowCount > 0 && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-md px-2.5 text-xs"
              onClick={() => setNewestFirst((prev) => !prev)}
            >
              <ArrowDownUp className="mr-1 size-3" />
              {newestFirst ? t('memoryPage.entries.sortNewest') : t('memoryPage.entries.sortOldest')}
            </Button>
            {hits !== null && !searching && (
              <span className="text-[11px] text-muted-foreground">
                {t('memoryPage.entries.matches', { count: hits.length })}
              </span>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2 text-xs"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                {t('memoryPage.entries.prevPage')}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {t('memoryPage.entries.pageOf', { page: currentPage, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2 text-xs"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                {t('memoryPage.entries.nextPage')}
              </Button>
            </div>
          )}
        </div>
      )}

      {loading && pageRows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t('memoryPage.entries.loading')}
        </div>
      ) : pageRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Database className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {browsingNothing ? t('memoryPage.entries.empty') : t('memoryPage.entries.noResults')}
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
                  title={t('memoryPage.entries.rowHint')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {row.title || t('memoryPage.entries.untitled')}
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                    {row.meta}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {row.updatedAtMs > 0 ? formatTimestamp(row.updatedAtMs) : ''}
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
    </SettingsSection>
  )
}

export default MemoryEntriesTab
