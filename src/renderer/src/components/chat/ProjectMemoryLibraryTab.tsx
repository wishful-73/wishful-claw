import { useCallback, useEffect, useState } from 'react'
import { Database, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import {
  memoryEntries,
  type MemoryStatusEntry
} from '@renderer/stores/chat-store/memory-helpers'

/**
 * Read-only memory library for one project (iter-33 S-91): every `memory_entries` row in this
 * project's scope, whatever its status, so the DB tier finally has an entry point next to the
 * hot MEMORY.md. Split out of ProjectArchivePage to stay inside the 500-line budget.
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // scope='project' is resolved worker-side (workingFolder for local projects,
      // projectId + sshConnectionId for SSH ones) — never hand-build the scope here.
      const result = await memoryEntries(
        'project',
        workingFolder ?? undefined,
        200,
        projectId ?? undefined,
        sshConnectionId ?? undefined
      )
      setEntries(result.entries ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [projectId, workingFolder, sshConnectionId])

  useEffect(() => {
    void load()
  }, [load])

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
          onClick={() => void load()}
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

      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 flex-1 overflow-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('projectArchive.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : entries.length === 0 ? (
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
                    {entry.priority} · {entry.status}
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
    </div>
  )
}

export default ProjectMemoryLibraryTab
