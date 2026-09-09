import * as React from 'react'
import { File, FilePlus, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Maximize2, Minimize2, X, ExternalLink, Loader2, GitBranch, GitCommitHorizontal, Upload, Cloud, ChevronDown, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { useGitStore, type GitRepositoryItem, type GitStatusFile } from '@renderer/stores/git-store'
import { CodeDiffViewer, type DiffViewerChunk, type DiffViewerLine } from '@renderer/components/chat/CodeDiffViewer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { parseDiffBlocks } from '@renderer/components/chat/GitPage/utils'

function rows(status: NonNullable<ReturnType<typeof useGitStore.getState>['repoDetailsByPath'][string]['status']>) {
  return [
    ...status.conflicted.map((file) => ({ file, section: 'conflicted' as const })),
    ...status.staged.map((file) => ({ file, section: 'staged' as const })),
    ...status.unstaged.map((file) => ({ file, section: 'unstaged' as const })),
    ...status.untracked.map((file) => ({ file, section: 'untracked' as const }))
  ]
}

function toChunks(text: string): DiffViewerChunk[] {
  return parseDiffBlocks(text).map((block) => ({
    type: 'lines',
    lines: block.lines.flatMap((line): DiffViewerLine[] => {
      if (line.type === 'add') return [{ type: 'add' as const, text: line.content.slice(1), newNum: Number(line.right) }]
      if (line.type === 'remove') return [{ type: 'del' as const, text: line.content.slice(1), oldNum: Number(line.left) }]
      if (line.type === 'context') return [{ type: 'keep' as const, text: line.content, oldNum: Number(line.left), newNum: Number(line.right) }]
      return []
    })
  }))
}

type CommitAction = 'commit' | 'amend' | 'push' | 'sync'

export function ChangesPanel({ workingFolder }: { workingFolder: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { repositories, repoDetailsByPath, scanRepositories, refreshRepository, loadFileDiff, stageAll, commit, pushRepository, syncRepository } = useGitStore()
  const [selected, setSelected] = React.useState<{ repo: GitRepositoryItem; file: GitStatusFile; staged: boolean } | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState('')
  const [busyAction, setBusyAction] = React.useState<CommitAction | null>(null)
  const openFilePreview = useUIStore((state) => state.openFilePreview)
  const repo = repositories.find((item) => workingFolder === item.fullPath || workingFolder.startsWith(`${item.fullPath}/`)) ?? repositories[0]
  const details = repo ? repoDetailsByPath[repo.fullPath] : undefined
  const changeRows = details?.status ? rows(details.status) : []
  const branch = details?.status?.branch ?? details?.currentBranch ?? null
  const upstream = details?.status?.upstream ?? null
  const ahead = details?.status?.ahead ?? 0
  const behind = details?.status?.behind ?? 0

  React.useEffect(() => { void scanRepositories() }, [scanRepositories, workingFolder])
  React.useEffect(() => {
    if (repo && selected && selected.repo.fullPath === repo.fullPath) void loadFileDiff(repo.fullPath, selected.file.path, selected.staged)
  }, [loadFileDiff, repo, selected])

  const runCommit = async (action: CommitAction): Promise<void> => {
    if (!repo || !commitMessage.trim()) return
    setBusyAction(action)
    try {
      const stageResult = await stageAll(repo.fullPath)
      if (!stageResult.success) { toast.error(stageResult.error); return }
      const commitResult = await commit(repo.fullPath, commitMessage.trim())
      if (!commitResult.success) { toast.error(commitResult.error); return }
      if (action === 'push') {
        const pushResult = await pushRepository(repo.fullPath)
        if (!pushResult.success) { toast.error(pushResult.error); return }
      } else if (action === 'sync') {
        const syncResult = await syncRepository(repo.fullPath)
        if (!syncResult.success) { toast.error(syncResult.error); return }
      }
      setCommitMessage('')
      toast.success(t(`agentFiles.${action}Done`))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  if (!repo) return <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">{t('agentFiles.notGitRepo', { defaultValue: 'Not a Git repository' })}</div>
  const diff = selected ? (repoDetailsByPath[repo.fullPath]?.diffByKey[`${selected.staged ? 'staged' : 'unstaged'}:${selected.file.path}`] ?? '') : ''

  const rowClass = (file: GitStatusFile): string => cn(
    'group flex w-full items-center gap-2 border-0 px-3 py-1.5 text-left text-xs text-agent-files-fg transition-colors hover:bg-agent-files-hover focus-visible:bg-agent-files-hover',
    selected?.file.path === file.path && 'agent-files-change-row--selected'
  )

  const canCommit = !!commitMessage.trim() && !busyAction && changeRows.length > 0

  return <div className="agent-files-explorer flex h-full min-h-0 flex-col">
    <div className="agent-files-explorer-header flex h-9 shrink-0 items-center justify-between border-b px-3">
      <span className="agent-files-explorer-title text-[11px] font-semibold uppercase tracking-wide">{t('agentFiles.changesCount', { count: changeRows.length, defaultValue: 'Changes ({{count}})' })}</span>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => void refreshRepository(repo.fullPath, { force: true })}><RefreshCw className="size-3.5" /></Button>
    </div>

    <div className="shrink-0 border-b border-agent-files-border bg-agent-files-panel p-2 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-agent-files-muted">
        <GitBranch className="size-3" />
        <span className="truncate font-mono">{branch ?? '—'}</span>
        {upstream ? (
          <span className="text-agent-files-muted">{upstream} ↑{ahead} ↓{behind}</span>
        ) : null}
      </div>
      <Textarea
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        placeholder={t('agentFiles.commitPlaceholder', { defaultValue: 'Commit message' })}
        disabled={!!busyAction}
        className="min-h-[60px] resize-y font-mono text-xs"
        rows={3}
      />
      <span className="text-[11px] text-agent-files-muted">
        {t('agentFiles.commitScope', { count: changeRows.length, defaultValue: '{{count}} change(s) will be staged and committed' })}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" className="min-w-0 flex-1" disabled={!canCommit || busyAction !== null} onClick={() => void runCommit('commit')}>
          {busyAction === 'commit' ? <Loader2 className="size-3.5 animate-spin" /> : <GitCommitHorizontal className="size-3.5" />}
          {t('agentFiles.commit', { defaultValue: 'Commit' })}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" disabled={!canCommit || busyAction !== null}>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void runCommit('commit')}>
              <GitCommitHorizontal className="size-3.5" />
              {t('agentFiles.commit', { defaultValue: 'Commit' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runCommit('amend')}>
              <RotateCcw className="size-3.5" />
              {t('agentFiles.commitAmend', { defaultValue: 'Commit (Amend)' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runCommit('push')}>
              <Upload className="size-3.5" />
              {t('agentFiles.commitPush', { defaultValue: 'Commit & Push' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runCommit('sync')}>
              <Cloud className="size-3.5" />
              {t('agentFiles.commitSync', { defaultValue: 'Commit & Sync' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div className="min-h-0 flex-1 overflow-auto">
      {details?.error ? <div className="flex items-center gap-1 p-3 text-xs text-destructive"><AlertCircle className="size-3" />{details.error}</div> : null}
      {changeRows.length === 0 && !details?.loading ? <div className="p-4 text-center text-xs text-muted-foreground">{t('agentFiles.noChanges', { defaultValue: 'No changes' })}</div> : null}
      {changeRows.map(({ file, section }) => <button key={`${section}:${file.path}`} type="button" onClick={() => setSelected({ repo, file, staged: section === 'staged' })} className={rowClass(file)}><span className="font-mono text-muted-foreground">{section === 'untracked' ? 'U' : section === 'conflicted' ? '!' : section === 'staged' ? file.stagedStatus : file.unstagedStatus}</span>{section === 'untracked' ? <FilePlus className="size-3.5" /> : <File className="size-3.5" />}<span className="truncate font-mono">{file.path}</span></button>)}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent showCloseButton={false} className={cn('grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0', fullscreen ? 'h-[92vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[96vw]' : 'h-[82vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[96vw]')}>
          <DialogHeader className="flex h-10 flex-row items-center gap-2 border-b border-agent-files-border bg-agent-files-panel px-2">
            <DialogTitle className="min-w-0 flex-1 truncate font-mono text-xs">{selected?.file.path ?? 'Diff'}</DialogTitle>
            <span className="rounded bg-agent-files-hover px-1.5 py-0.5 text-[11px] text-agent-files-muted">{Math.max(1, changeRows.findIndex(({ file }) => file.path === selected?.file.path) + 1)} / {changeRows.length}</span>
            <Button variant="ghost" size="icon-xs" onClick={() => { const i = changeRows.findIndex(({ file }) => file.path === selected?.file.path); const next = changeRows[(i - 1 + changeRows.length) % changeRows.length]; if (next) setSelected({ repo, file: next.file, staged: next.section === 'staged' }) }}><ChevronLeft className="size-3.5" /></Button>
            <Button variant="ghost" size="icon-xs" onClick={() => { const i = changeRows.findIndex(({ file }) => file.path === selected?.file.path); const next = changeRows[(i + 1) % changeRows.length]; if (next) setSelected({ repo, file: next.file, staged: next.section === 'staged' }) }}><ChevronRight className="size-3.5" /></Button>
            <Button variant="ghost" size="icon-xs" onClick={() => selected && openFilePreview(`${repo.fullPath}/${selected.file.path}`)}><ExternalLink className="size-3.5" /></Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setSelected(null)}><X className="size-3.5" /></Button>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] bg-agent-files-panel">
            <div className="min-h-0 overflow-y-auto border-r border-agent-files-border py-1"><div className="px-3 py-1 text-[11px] font-semibold text-agent-files-muted">{t('agentFiles.changedFiles', { defaultValue: 'Changed Files' })}</div>{changeRows.map(({ file, section }) => <button key={`${section}:${file.path}`} type="button" onClick={() => setSelected({ repo, file, staged: section === 'staged' })} className={rowClass(file)}><File className="size-3.5 shrink-0 text-agent-files-icon" /><span className="truncate font-mono">{file.path}</span><span className="ml-auto font-mono text-[11px] text-agent-files-added">{section === 'untracked' ? 'U' : section === 'staged' ? file.stagedStatus : file.unstagedStatus}</span></button>)}</div>
            <div className="min-h-0 overflow-hidden p-3">{diff ? <CodeDiffViewer chunks={toChunks(diff)} fillHeight showModeToggle /> : <div className="p-3 text-xs text-muted-foreground">{t('agentFiles.noDiffDesc', { defaultValue: 'This file has no renderable text diff.' })}</div>}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  </div>
}
