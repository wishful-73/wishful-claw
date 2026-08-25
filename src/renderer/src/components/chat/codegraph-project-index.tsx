import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Waypoints } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { useChatStore } from '@renderer/stores/chat-store'
import { resolvePluginsForProject, useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { CODEGRAPH_PLUGIN_ID } from '@renderer/lib/app-plugin/types'

// CodeGraphProjectIndexSection — the project-archive "code graph" block. Per-project
// index surface: enabled-gating (greyed + go-enable CTA when the CodeGraph plugin is
// off), current-project index status (files/nodes/dbSize/last indexed), and
// index/sync actions with a live progress bar. Storage is project-local
// ({workingFolder}/.wishful-claw/codegraph) — the main-process IPC layer injects the
// dataRoot; SSH projects pass an explicit home-side fallback dir.
// Extracted from AppPluginPanel's per-project rows during the archive migration.

interface CodeGraphIndexProgress {
  indexId: string
  phase: string
  filesDone: number
  filesTotal: number
  nodeCount: number
  edgeCount: number
}

interface CodeGraphIndexStatus {
  success?: boolean
  state?: string | null
  fileCount?: number
  nodeCount?: number
  edgeCount?: number
  dbSizeBytes?: number
  lastIndexedAt?: number | null
}

function formatDbSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function CodeGraphProjectIndexSection(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const activeProject = useChatStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null
  )
  const pluginsByProject = useAppPluginStore((state) => state.pluginsByProject)

  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<CodeGraphIndexStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [progress, setProgress] = useState<CodeGraphIndexProgress | null>(null)

  const pluginEnabled = Boolean(
    resolvePluginsForProject(pluginsByProject, activeProjectId).find(
      (p) => p.id === CODEGRAPH_PLUGIN_ID
    )?.enabled
  )
  const workingFolder = activeProject?.workingFolder ?? undefined
  // SSH projects cannot write .wishful-claw/ on the remote root; mirror the memory
  // strategy (ProjectArchivePage memoryRoot) and keep the graph DB under the
  // app-home project dir instead. SSH is keyed off sshConnectionId — a remote
  // workingFolder may still be set, so it must not gate this check.
  const isSshProject = Boolean(activeProject?.sshConnectionId)
  const dataRootOverride =
    isSshProject && activeProjectId ? `~/.wishful-claw/projects/${activeProjectId}/codegraph` : undefined

  useEffect(() => {
    return ipcClient.on(IPC.CODEGRAPH_INDEX_PROGRESS, (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const value = payload as Partial<CodeGraphIndexProgress>
      if (typeof value.indexId !== 'string') return
      setProgress({
        indexId: value.indexId,
        phase: typeof value.phase === 'string' ? value.phase : 'scan',
        filesDone: typeof value.filesDone === 'number' ? value.filesDone : 0,
        filesTotal: typeof value.filesTotal === 'number' ? value.filesTotal : 0,
        nodeCount: typeof value.nodeCount === 'number' ? value.nodeCount : 0,
        edgeCount: typeof value.edgeCount === 'number' ? value.edgeCount : 0
      })
    })
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!pluginEnabled || (!workingFolder && !dataRootOverride)) {
      setStatus(null)
      return
    }
    setStatusLoading(true)
    try {
      const { agentBridge } = await import('@renderer/lib/ipc/agent-bridge')
      const result = (await agentBridge.request(
        'codegraph/index-status',
        {
          workingFolder,
          ...(dataRootOverride ? { dataRoot: dataRootOverride } : {})
        },
        30_000
      )) as CodeGraphIndexStatus
      setStatus(result ?? null)
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [pluginEnabled, workingFolder, dataRootOverride])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const runAction = async (
    key: string,
    method: string,
    timeoutMs: number,
    phase: string
  ): Promise<void> => {
    if (!workingFolder && !dataRootOverride) return
    setBusy(key)
    const indexId = crypto.randomUUID()
    setProgress({
      indexId,
      phase,
      filesDone: 0,
      filesTotal: 0,
      nodeCount: 0,
      edgeCount: 0
    })
    try {
      const { agentBridge } = await import('@renderer/lib/ipc/agent-bridge')
      const result = (await agentBridge.request(
        method,
        {
          workingFolder,
          indexId,
          ...(dataRootOverride ? { dataRoot: dataRootOverride } : {})
        },
        timeoutMs
      )) as { success?: boolean; error?: string; message?: string }
      if (result?.success === false) {
        toast.error(t('projectArchive.codegraph.actionFailed', { defaultValue: 'Operation failed' }), {
          description: result.error ?? result.message
        })
      } else {
        toast.success(t('projectArchive.codegraph.actionDone', { defaultValue: 'Done' }))
      }
    } catch (error) {
      toast.error(t('projectArchive.codegraph.actionFailed', { defaultValue: 'Operation failed' }), {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setProgress(null)
      setBusy(null)
      void refreshStatus()
    }
  }

  const handleGoEnable = (): void => {
    useUIStore.getState().openSettingsPage('plugin')
  }

  const percentage =
    progress && progress.filesTotal > 0
      ? Math.min(100, Math.round((progress.filesDone / progress.filesTotal) * 100))
      : null

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Waypoints className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t('projectArchive.codegraph.title', { defaultValue: 'Code graph' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('projectArchive.codegraph.desc', {
                defaultValue:
                  'Indexes this project so the agent can navigate code structure without reading every file.'
              })}
            </p>
          </div>
        </div>
        {pluginEnabled ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={busy !== null}
              onClick={() => void runAction('index', 'codegraph/index', 600_000, 'scan')}
            >
              {busy === 'index'
                ? t('projectArchive.codegraph.indexing', { defaultValue: 'Indexing...' })
                : status?.state && status.state !== 'not_indexed'
                  ? t('projectArchive.codegraph.reindex', { defaultValue: 'Re-index' })
                  : t('projectArchive.codegraph.index', { defaultValue: 'Index' })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={busy !== null}
              onClick={() => void runAction('sync', 'codegraph/sync', 300_000, 'sync')}
            >
              {busy === 'sync'
                ? t('projectArchive.codegraph.syncing', { defaultValue: 'Syncing...' })
                : t('projectArchive.codegraph.sync', { defaultValue: 'Sync' })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={statusLoading}
              onClick={() => void refreshStatus()}
            >
              <RefreshCw className={statusLoading ? 'size-3 animate-spin' : 'size-3'} />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={handleGoEnable}
          >
            {t('projectArchive.codegraph.goEnable', { defaultValue: 'Enable in settings' })}
          </Button>
        )}
      </div>

      {!pluginEnabled ? (
        <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground opacity-70">
          {t('projectArchive.codegraph.disabledHint', {
            defaultValue:
              'CodeGraph is disabled for this project. Enable it to give the agent code-navigation tools.'
          })}
        </p>
      ) : progress ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{progress.phase}</span>
            <span>{percentage === null ? `${progress.filesDone} files` : `${percentage}%`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percentage ?? 35}%` }}
            />
          </div>
        </div>
      ) : busy === 'index' || busy === 'sync' ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t('projectArchive.codegraph.working', { defaultValue: 'Working...' })}
        </p>
      ) : status?.success && status.state && status.state !== 'not_indexed' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span
            className={`rounded-full px-2 py-0.5 ${
              status.state === 'complete'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {status.state}
          </span>
          <span>
            {t('projectArchive.codegraph.stats', {
              defaultValue: '{{files}} files · {{nodes}} nodes · {{edges}} edges',
              files: status.fileCount ?? 0,
              nodes: status.nodeCount ?? 0,
              edges: status.edgeCount ?? 0
            })}
          </span>
          {status.dbSizeBytes ? <span>{formatDbSize(status.dbSizeBytes)}</span> : null}
          {status.lastIndexedAt ? (
            <span>{new Date(status.lastIndexedAt).toLocaleString()}</span>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          {t('projectArchive.codegraph.notIndexed', {
            defaultValue: 'Not indexed yet. Run Index to build the code graph.'
          })}
        </p>
      )}
    </section>
  )
}
