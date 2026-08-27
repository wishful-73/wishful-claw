import type React from 'react'
import { FolderPlus, FilePlus2, RefreshCw, ChevronDown } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { FolderOpen } from 'lucide-react'
import type { useFileTree } from './use-file-tree'

interface FileTreeHeaderProps {
  workingFolder: string
  agentSurface: boolean
  compactSheetSurface: boolean
  isSearching: boolean
  treeStats: { folders: number; files: number }
  tree: ReturnType<typeof useFileTree>['tree']
  loading: boolean
  searchResults: ReturnType<typeof useFileTree>['searchResults']
  t: ReturnType<typeof useFileTree>['t']
  handleNewFile: (parent: string) => void
  handleNewFolder: (parent: string) => void
  handleCollapseAll: () => void
  refreshTree: () => void
}

/**
 * FileTree header — renders either card-surface or compact-sheet-surface variant.
 */
export function FileTreeHeader({
  workingFolder, agentSurface, compactSheetSurface, isSearching,
  treeStats, tree, loading, searchResults, t,
  handleNewFile, handleNewFolder, handleCollapseAll, refreshTree
}: FileTreeHeaderProps): React.JSX.Element | null {
  if (agentSurface) return null

  if (!compactSheetSurface) {
    return (
      <>
        <div className="flex items-start gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10">
            <FolderOpen className="size-4 text-sky-500 dark:text-sky-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div
                className="truncate text-sm font-medium text-foreground"
                title={workingFolder}
              >
                {workingFolder.split(/[\\/]/).pop()}
              </div>
            </div>
            <div
              className="mt-1 truncate text-[11px] text-muted-foreground"
              title={workingFolder}
            >
              {workingFolder}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              onClick={() => void handleNewFile(workingFolder)}
              disabled={isSearching}
              title={t('fileTree.newFile')}
            >
              <FilePlus2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              onClick={() => void handleNewFolder(workingFolder)}
              disabled={isSearching}
              title={t('fileTree.newFolder')}
            >
              <FolderPlus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              onClick={handleCollapseAll}
              disabled={tree.length === 0 || isSearching}
              title={t('action.showLess', { ns: 'common' })}
            >
              <ChevronDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              onClick={() => { void refreshTree() }}
              disabled={loading}
              title={t('action.refresh', { ns: 'common' })}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="workspace-filetree-chip rounded-full px-2 py-1">
            {treeStats.folders} {t('unit.folders', { ns: 'common' })}
          </span>
          <span className="workspace-filetree-chip rounded-full px-2 py-1">
            {treeStats.files} {t('unit.files', { ns: 'common' })}
          </span>
          {isSearching && (
            <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-1 text-primary/80">
              {searchResults.length} {t('unit.matches', { ns: 'common' })}
            </span>
          )}
        </div>
      </>
    )
  }

  // compactSheetSurface (sheet or agent)
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10">
        <FolderOpen className="size-3.5 text-sky-500 dark:text-sky-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground" title={workingFolder}>
          {workingFolder.split(/[\\/]/).pop()}
        </div>
        <div className="truncate text-[11px] text-muted-foreground" title={workingFolder}>
          {workingFolder}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          onClick={() => void handleNewFile(workingFolder)}
          disabled={isSearching}
          title={t('fileTree.newFile')}
        >
          <FilePlus2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          onClick={() => void handleNewFolder(workingFolder)}
          disabled={isSearching}
          title={t('fileTree.newFolder')}
        >
          <FolderPlus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          onClick={() => { void refreshTree() }}
          disabled={loading}
          title={t('action.refresh', { ns: 'common' })}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
    </div>
  )
}
