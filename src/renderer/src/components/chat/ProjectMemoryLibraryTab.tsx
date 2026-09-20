import { useCallback, useEffect, useState } from 'react'
import { Database, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import {
  MEMORY_TIME_RANGE_IDS,
  resolveMemoryTimeBounds,
  type MemoryTimeRangeId
} from '@renderer/lib/memory-time-range'
import {
  memoryEntries,
  type MemoryStatusEntry
} from '@renderer/stores/chat-store/memory-helpers'

/** Rows per page — the worker does the paging (iter-33 S-98). */
const PAGE_SIZE = 20

/** Same rendering as the global tab, so a timestamp reads the same on both pages. */
function formatUpdatedAt(seconds: number): string {
  if (!seconds) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
    seconds * 1000
  )
}

/**
 * Read-only memory library for one project (iter-33 S-91): every `memory_entries` row in this
 * project's scope, whatever its status, so the DB tier finally has an entry point next to the
 * hot MEMORY.md. Paged server-side in S-98, which is what lifts the old "one 200-row request"
 * ceiling. Split out of ProjectArchivePage to stay inside the 500-line budget.
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
  const { t } = useTranslation('chat')
  const [entries, setEntries] = useState<MemoryStatusEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<MemoryTimeRangeId>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        // scope='project' is resolved worker-side (workingFolder for local projects,
        // projectId + sshConnectionId for SSH ones) — never hand-build the scope here.
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
        setEntries(result.entries ?? [])
        setTotal(result.total ?? 0)
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

  // Switching project invalidates the page number — page 3 of the previous project says
  // nothing about this one.
  useEffect(() => {
    setPage(1)
  }, [projectId, workingFolder, sshConnectionId, range])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const hasRows = entries.length > 0

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
          onClick={() => void load(currentPage)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-3" />
          )}
          {t('projectArchive.memoryLibrary.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {MEMORY_TIME_RANGE_IDS.map((id) => (
          <Button
            key={id}
            variant={range === id ? 'default' : 'outline'}
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => setRange(id)}
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
            {t('projectArchive.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : !hasRows ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
            <Database className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {t('projectArchive.memoryLibrary.empty', {
                defaultValue: 'No memory entries stored for this project yet.'
              })}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-md border border-border/60 bg-background/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-foreground">
                    {entry.title ||
                      t('projectArchive.memoryLibrary.untitled', { defaultValue: 'Untitled' })}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {entry.updatedAt > 0
                      ? `${formatUpdatedAt(entry.updatedAt)} · ${entry.priority} · ${entry.status}`
                      : `${entry.priority} · ${entry.status}`}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {entry.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2">
          <span className="text-[11px] text-muted-foreground">
            {t('projectArchive.memoryLibrary.total', {
              count: total,
              defaultValue: '{{count}} entries'
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
