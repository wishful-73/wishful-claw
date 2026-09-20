import { useCallback, useEffect, useState } from 'react'
import { Database, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  memoryEntries,
  memorySearch,
  type MemorySearchResult,
  type MemoryStatusEntry
} from '@renderer/stores/chat-store/memory-helpers'
import { SettingsSection, SettingHint } from './settings-primitives'

/** One rendered row, normalized across the two sources below (list vs search hit). */
interface EntryRow {
  key: string
  title: string
  meta: string
  content: string
}

function fromEntry(entry: MemoryStatusEntry): EntryRow {
  return {
    key: `entry-${entry.id}`,
    title: entry.title ?? '',
    meta: `${entry.priority} · ${entry.status}`,
    content: entry.content
  }
}

function fromHit(hit: MemorySearchResult): EntryRow {
  return {
    key: `hit-${hit.key}`,
    title: hit.title,
    meta: `${hit.tier} · ${hit.scope}`,
    content: hit.content
  }
}

/**
 * Global regular memory — the `memory_entries` rows in scope `global`
 * (iter-33 S-96). Read-only: the DB tier is derived data, and the editable
 * surface for hand-tuning memory is the hot tab next door.
 *
 * Two sources, one list: an empty query browses everything in the scope via
 * `memory/entries` (which, unlike `memory/entries-by-status`, carries no status
 * predicate), a non-empty query switches to `memory/search`. Clearing the query
 * returns to browsing.
 *
 * Scope is hard-coded to `global` because this is the global settings page.
 */
function MemoryEntriesTab(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [hits, setHits] = useState<EntryRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryEntries('global', undefined, 200)
      setEntries((result.entries ?? []).map(fromEntry))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSearch = useCallback(async () => {
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

  const rows = hits ?? entries
  const browsingNothing = !loading && hits === null && entries.length === 0

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
          onClick={() => void load()}
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

      {hits !== null && !searching && (
        <SettingHint>
          {t('memoryPage.entries.matches', { count: hits.length })}
        </SettingHint>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t('memoryPage.entries.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Database className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {browsingNothing ? t('memoryPage.entries.empty') : t('memoryPage.entries.noResults')}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="rounded-md border border-border/60 bg-background/60 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-medium text-foreground">
                  {row.title || t('memoryPage.entries.untitled')}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{row.meta}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                {row.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

export default MemoryEntriesTab
