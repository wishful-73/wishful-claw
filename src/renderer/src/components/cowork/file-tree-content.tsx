import type React from 'react'
import { RefreshCw, Search, Folder, MessageSquarePlus, Copy, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { TreeNode, FileSearchItem, TreeEditState, TreeActions } from './file-tree-types'
import { TreeItem } from './tree-item'
import { fileIcon, toRelativePath } from './file-tree-utils'
import type { TFunction } from 'i18next'

interface FileTreeContentProps {
  loading: boolean
  tree: TreeNode[]
  isSearching: boolean
  searchLoading: boolean
  searchResults: FileSearchItem[]
  activePath: string | null
  agentSurface: boolean
  agentRootExpanded: boolean
  setAgentRootExpanded: React.Dispatch<React.SetStateAction<boolean>>
  workingFolder: string
  rootNewItemInput: React.ReactNode
  t: TFunction
  handlePreview: (path: string) => void
  handleToggle: (path: string) => void
  handleAddToChat: (path: string) => void
  handleCopyPath: (path: string) => void
  editState: TreeEditState
  treeActions: TreeActions
}

/** Main content area: loading spinner, search results, or tree view. */
export function FileTreeContent(props: FileTreeContentProps): React.JSX.Element {
  const {
    loading, tree, isSearching, searchLoading, searchResults,
    activePath, agentSurface, agentRootExpanded, setAgentRootExpanded,
    workingFolder, rootNewItemInput, t,
    handlePreview, handleToggle, handleAddToChat, handleCopyPath,
    editState, treeActions
  } = props

  if (loading && tree.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <RefreshCw className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isSearching) {
    if (searchLoading) {
      return (
        <div className="workspace-filetree-empty flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-muted-foreground">
          <RefreshCw className="size-3.5 animate-spin" />
          <span>{t('fileTree.searching', { defaultValue: 'Searching files...' })}</span>
        </div>
      )
    }
    if (searchResults.length === 0) {
      return (
        <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-10 text-center">
          <Search className="size-5 text-muted-foreground/50" />
          <div className="text-xs text-muted-foreground">
            {t('fileTree.noSearchResults', { defaultValue: 'No matching files' })}
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-1.5">
        {searchResults.map((file) => {
          const isActive = activePath === file.path
          const relativePath = toRelativePath(file.path, workingFolder)
          return (
            <div
              key={file.path}
              className={cn(
                'workspace-filetree-row group flex w-full items-center text-left transition-all',
                agentSurface
                  ? 'workspace-filetree-row--agent h-[22px] gap-1 rounded-none px-1 py-0'
                  : 'gap-2 rounded-xl px-2.5 py-2',
                isActive ? 'workspace-filetree-row--active' : 'workspace-filetree-row--interactive'
              )}
              onClick={() => { if (file.type !== 'directory') handlePreview(file.path) }}
              title={file.path}
            >
              {file.type === 'directory' ? <Folder className="size-3.5 text-sky-500 dark:text-sky-400" /> : fileIcon(file.name)}
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate',
                    agentSurface
                      ? 'text-[12px] font-normal text-agent-files-fg'
                      : 'text-sm font-medium text-foreground/90'
                  )}
                >
                  {file.name}
                </div>
                {!agentSurface ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {relativePath}
                  </div>
                ) : null}
              </div>
              <div
                className={cn(
                  'flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100',
                  agentSurface && 'hidden'
                )}
              >
                <button
                  className="workspace-filetree-action rounded-md p-1"
                  onClick={(event) => { event.stopPropagation(); handleAddToChat(file.path) }}
                  title={t('fileTree.addToChat')}
                >
                  <MessageSquarePlus className="size-3" />
                </button>
                <button
                  className="workspace-filetree-action rounded-md p-1"
                  onClick={(event) => { event.stopPropagation(); handleCopyPath(file.path) }}
                  title={t('fileTree.copyPath')}
                >
                  <Copy className="size-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (tree.length === 0 && !rootNewItemInput) {
    return (
      <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-10 text-center">
        <Folder className="size-5 text-muted-foreground/50" />
        <div className="text-xs text-muted-foreground">
          {t('fileTree.empty', { defaultValue: 'No files in current directory' })}
        </div>
      </div>
    )
  }

  return (
    <div className={agentSurface ? 'space-y-0' : 'space-y-1'}>
      {agentSurface ? (
        <>
          <div
            className="workspace-filetree-row workspace-filetree-row--agent workspace-filetree-row--interactive group flex h-[22px] cursor-pointer items-center gap-0 px-0 py-0 text-[12px]"
            style={{ paddingLeft: 4 }}
            onClick={() => setAgentRootExpanded((value) => !value)}
            title={workingFolder}
          >
            <ChevronRight
              className="workspace-filetree-chevron shrink-0"
              style={{ transform: agentRootExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span className="min-w-0 flex-1 truncate text-agent-files-fg">
              {workingFolder.split(/[\\/]/).pop()}
            </span>
          </div>
          {agentRootExpanded ? (
            <>
              {rootNewItemInput}
              {tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={1}
                  activePath={activePath}
                  onToggle={handleToggle}
                  editState={editState}
                  actions={treeActions}
                  agentSurface
                />
              ))}
            </>
          ) : null}
        </>
      ) : (
        <>
          {rootNewItemInput}
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onToggle={handleToggle}
              editState={editState}
              actions={treeActions}
            />
          ))}
        </>
      )}
    </div>
  )
}
