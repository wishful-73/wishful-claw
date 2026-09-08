import * as React from 'react'
import { File, FilePlus, RefreshCw, AlertCircle, Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
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

export function ChangesPanel({ workingFolder }: { workingFolder: string }): React.JSX.Element {
  const { repositories, repoDetailsByPath, scanRepositories, refreshRepository, loadFileDiff } = useGitStore()
  const [selected, setSelected] = React.useState<{ repo: GitRepositoryItem; file: GitStatusFile; staged: boolean } | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const repo = repositories.find((item) => workingFolder === item.fullPath || workingFolder.startsWith(`${item.fullPath}/`)) ?? repositories[0]
  const details = repo ? repoDetailsByPath[repo.fullPath] : undefined
  const changeRows = details?.status ? rows(details.status) : []

  React.useEffect(() => { void scanRepositories() }, [scanRepositories, workingFolder])
  React.useEffect(() => {
    if (repo && selected && selected.repo.fullPath === repo.fullPath) void loadFileDiff(repo.fullPath, selected.file.path, selected.staged)
  }, [loadFileDiff, repo, selected])

  if (!repo) return <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">不是 Git 仓库</div>
  const diff = selected ? (repoDetailsByPath[repo.fullPath]?.diffByKey[`${selected.staged ? 'staged' : 'unstaged'}:${selected.file.path}`] ?? '') : ''
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">变更 ({changeRows.length})</span>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => void refreshRepository(repo.fullPath, { force: true })}><RefreshCw className="size-3.5" /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {details?.error ? <div className="flex items-center gap-1 p-3 text-xs text-destructive"><AlertCircle className="size-3" />{details.error}</div> : null}
      {changeRows.length === 0 && !details?.loading ? <div className="p-4 text-center text-xs text-muted-foreground">暂无变更</div> : null}
      {changeRows.map(({ file, section }) => <button key={`${section}:${file.path}`} type="button" onClick={() => setSelected({ repo, file, staged: section === 'staged' })} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60', selected?.file.path === file.path && 'bg-muted')}><span className="font-mono text-muted-foreground">{section === 'untracked' ? 'U' : section === 'conflicted' ? '!' : section === 'staged' ? file.stagedStatus : file.unstagedStatus}</span>{section === 'untracked' ? <FilePlus className="size-3.5" /> : <File className="size-3.5" />}<span className="truncate font-mono">{file.path}</span></button>)}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className={cn('grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0', fullscreen ? 'h-[92vh] w-[96vw] max-w-[96vw]' : 'h-[82vh] w-[96vw] max-w-[1600px]')}>
          <DialogHeader className="flex h-10 flex-row items-center gap-2 border-b border-border px-3">
            <DialogTitle className="min-w-0 flex-1 truncate font-mono text-sm">{selected?.file.path ?? 'Diff'}</DialogTitle>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelected(null)}><X className="size-3.5" /></Button>
          </DialogHeader>
          <div className="min-h-0 overflow-hidden p-3">{diff ? <CodeDiffViewer chunks={toChunks(diff)} fillHeight showModeToggle /> : <div className="p-3 text-xs text-muted-foreground">暂无可用 Diff（可能是二进制或未追踪文件）</div>}</div>
        </DialogContent>
      </Dialog>
    </div>
  </div>
}
