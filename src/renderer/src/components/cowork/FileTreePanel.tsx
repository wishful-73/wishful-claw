import type React from 'react'
import { File, Folder, FolderPlus, AlertCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent
} from '@renderer/components/ui/context-menu'
import type { AgentFileTreeCommand } from './file-tree-types'
import { useFileTree } from './use-file-tree'
import { useFileTreeActions } from './use-file-tree-actions'
import { InlineInput } from './tree-item'
import { FileTreeHeader } from './file-tree-header'
import { FileTreeSearchBar } from './file-tree-search-bar'
import { FileTreeContent } from './file-tree-content'
import { FileTreeContextMenuItems } from './file-tree-context-menu'
import { AgentFileTreeToolbar } from './agent-file-tree-toolbar'

interface FileTreePanelProps {
  sessionId?: string | null
  surface?: 'card' | 'sheet' | 'agent'
  agentSearchOpen?: boolean
  agentCommand?: AgentFileTreeCommand | null
  watchEnabled?: boolean
}

export function FileTreePanel({
  sessionId = null,
  surface = 'card',
  agentSearchOpen = false,
  agentCommand = null,
  watchEnabled = true
}: FileTreePanelProps): React.JSX.Element {
  const fileTreeState = useFileTree({ sessionId, surface, agentSearchOpen, watchEnabled } as any)
  const actions = useFileTreeActions(fileTreeState, { agentCommand }) as any
  const {
    t, workingFolder, agentSurface, tree, loading, error,
    searchQuery, setSearchQuery, searchResults, searchLoading,
    agentRootExpanded, setAgentRootExpanded,
    newItemParent, newItemType, handleToggle,
    refreshTree, sshConnectionId,
    handleAddToChat, handleCopyPath
  } = fileTreeState
  const { treeActions, editState, treeStats, activePath } = actions
  const compactSheetSurface = surface === 'sheet' || surface === 'agent'
  const showSearchInput = !agentSurface || agentSearchOpen
  const isSearching = searchQuery.trim().length > 0

  const rootNewItemInput =
    newItemParent === workingFolder ? (
      <InlineInput
        defaultValue={newItemType === 'file' ? 'untitled' : 'new-folder'}
        depth={agentSurface ? 1 : 0}
        icon={
          newItemType === 'file' ? (
            <File className="size-3.5 text-muted-foreground/60" />
          ) : (
            <Folder className="size-3.5 text-sky-500 dark:text-sky-400" />
          )
        }
        onConfirm={actions.handleNewItemConfirm}
        onCancel={actions.handleNewItemCancel}
      />
    ) : null

  if (!workingFolder) {
    return (
      <div className="workspace-filetree-empty flex flex-col items-center justify-center gap-2 rounded-xl py-8 text-muted-foreground/70">
        <FolderPlus className="size-8" />
        <p className="text-xs">{t('fileTree.selectFolder')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'workspace-filetree-surface flex min-h-0 flex-1 flex-col overflow-hidden',
          agentSurface
            ? 'workspace-filetree-surface--agent'
            : compactSheetSurface
              ? 'workspace-filetree-surface--sheet'
              : 'workspace-filetree-surface--card rounded-[20px]'
        )}
      >
                {agentSurface && (
          <AgentFileTreeToolbar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            loading={loading}
            refreshTree={refreshTree}
            workingFolder={workingFolder}
            sshConnectionId={sshConnectionId ?? null}
            t={t}
            handleNewFile={actions.handleNewFile}
            handleNewFolder={actions.handleNewFolder}
            handleCopyPath={handleCopyPath}
            handleOpenTerminal={actions.handleOpenTerminal}
            handleOpenDefault={actions.handleOpenDefault}
            handleOpenWithCode={actions.handleOpenWithCode}
            handleReveal={actions.handleReveal}
          />
        )}

<div
          className={cn(
            'workspace-filetree-header',
            agentSurface ? 'workspace-filetree-header--agent px-0 py-0' : 'px-3 py-3'
          )}
        >
          <FileTreeHeader
            workingFolder={workingFolder}
            agentSurface={agentSurface}
            compactSheetSurface={compactSheetSurface}
            isSearching={isSearching}
            treeStats={treeStats}
            tree={tree}
            loading={loading}
            searchResults={searchResults}
            t={t}
            handleNewFile={actions.handleNewFile}
            handleNewFolder={actions.handleNewFolder}
            handleCollapseAll={actions.handleCollapseAll}
            refreshTree={refreshTree}
          />

          <FileTreeSearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            t={t}
            agentSurface={agentSurface}
            compactSheetSurface={compactSheetSurface}
            showSearchInput={showSearchInput}
          />
        </div>

        {error && (
          <div className="workspace-filetree-header flex items-center gap-1.5 px-3 py-2 text-[11px] text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'min-h-0 flex-1 overflow-y-auto text-[12px]',
                agentSurface ? 'px-0 py-1' : compactSheetSurface ? 'px-3 py-3' : 'px-2 py-2'
              )}
            >
              <FileTreeContent
                loading={loading}
                tree={tree}
                isSearching={isSearching}
                searchLoading={searchLoading}
                searchResults={searchResults}
                activePath={activePath}
                agentSurface={agentSurface}
                agentRootExpanded={agentRootExpanded}
                setAgentRootExpanded={setAgentRootExpanded}
                workingFolder={workingFolder}
                rootNewItemInput={rootNewItemInput}
                t={t}
                handlePreview={actions.handlePreview}
                handleToggle={handleToggle}
                handleAddToChat={handleAddToChat}
                handleCopyPath={handleCopyPath}
                editState={editState}
                treeActions={treeActions}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <FileTreeContextMenuItems
              workingFolder={workingFolder}
              sshConnectionId={sshConnectionId ?? null}
              t={t}
              handleNewFile={actions.handleNewFile}
              handleNewFolder={actions.handleNewFolder}
              refreshTree={refreshTree}
              handleAddToChat={handleAddToChat}
              handleCopyPath={handleCopyPath}
              handleOpenTerminal={actions.handleOpenTerminal}
              handleOpenDefault={actions.handleOpenDefault}
              handleOpenWithCode={actions.handleOpenWithCode}
              handleReveal={actions.handleReveal}
            />
          </ContextMenuContent>
        </ContextMenu>

        {!compactSheetSurface && (
          <div className="workspace-filetree-footer px-3 py-2 text-[10px] text-muted-foreground/80">
            {isSearching
              ? t('fileTree.searchHint', {
                  defaultValue: 'Click to preview, or use Add to Chat to insert a file reference'
                })
              : t('fileTree.stats', {
                  folders: treeStats.folders,
                  files: treeStats.files
                })}
          </div>
        )}
      </div>
    </div>
  )
}
