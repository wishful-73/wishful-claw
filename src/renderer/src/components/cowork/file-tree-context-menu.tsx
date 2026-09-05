import type React from 'react'
import {
  FilePlus2, FolderPlus, RefreshCw, MessageSquarePlus, Copy,
  SquareTerminal, ExternalLink, Code2, FolderOpen
} from 'lucide-react'
import {
  ContextMenuItem, ContextMenuSeparator
} from '@renderer/components/ui/context-menu'
import type { TFunction } from 'i18next'

interface FileTreeContextMenuItemsProps {
  workingFolder: string
  sshConnectionId: string | null
  t: TFunction
  handleNewFile: (parent: string) => void
  handleNewFolder: (parent: string) => void
  refreshTree: () => void
  handleAddToChat: (path: string) => void
  handleCopyPath: (path: string) => void
  handleOpenTerminal: (path: string, closeOnExit?: boolean) => void
  handleOpenDefault: (path: string) => void
  handleOpenWithCode: (path: string) => void
  handleReveal: (path: string) => void
}

/** Context menu items for the file tree root. */
export function FileTreeContextMenuItems({
  workingFolder, sshConnectionId, t,
  handleNewFile, handleNewFolder, refreshTree,
  handleAddToChat, handleCopyPath,
  handleOpenTerminal, handleOpenDefault, handleOpenWithCode, handleReveal
}: FileTreeContextMenuItemsProps): React.JSX.Element {
  return (
    <>
      <ContextMenuItem
        className="gap-2 rounded-lg px-2.5 py-2 text-xs"
        onSelect={() => handleNewFile(workingFolder)}
      >
        <FilePlus2 className="size-3.5" /> {t('fileTree.newFile')}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2 rounded-lg px-2.5 py-2 text-xs"
        onSelect={() => handleNewFolder(workingFolder)}
      >
        <FolderPlus className="size-3.5" /> {t('fileTree.newFolder')}
      </ContextMenuItem>
      <ContextMenuItem className="gap-2 text-xs" onSelect={() => refreshTree()}>
        <RefreshCw className="size-3.5" /> {t('action.refresh', { ns: 'common' })}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="gap-2 rounded-lg px-2.5 py-2 text-xs"
        onSelect={() => handleAddToChat(workingFolder)}
      >
        <MessageSquarePlus className="size-3.5" /> {t('fileTree.addToChat')}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2 rounded-lg px-2.5 py-2 text-xs"
        onSelect={() => handleCopyPath(workingFolder)}
      >
        <Copy className="size-3.5" /> {t('action.copyPath', { ns: 'common' })}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2 rounded-lg px-2.5 py-2 text-xs"
        onSelect={() => handleOpenTerminal(workingFolder, true)}
      >
        <SquareTerminal className="size-3.5" /> {t('fileTree.openTerminal')}
      </ContextMenuItem>
      {!sshConnectionId && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="gap-2 rounded-lg px-2.5 py-2 text-xs"
            onSelect={() => handleOpenDefault(workingFolder)}
          >
            <ExternalLink className="size-3.5" /> {t('fileTree.openDefault')}
          </ContextMenuItem>
          <ContextMenuItem
            className="gap-2 rounded-lg px-2.5 py-2 text-xs"
            onSelect={() => handleOpenWithCode(workingFolder)}
          >
            <Code2 className="size-3.5" /> {t('fileTree.openWithCode')}
          </ContextMenuItem>
          <ContextMenuItem
            className="gap-2 rounded-lg px-2.5 py-2 text-xs"
            onSelect={() => handleReveal(workingFolder)}
          >
            <FolderOpen className="size-3.5" /> {t('fileTree.revealInFinder')}
          </ContextMenuItem>
        </>
      )}
    </>
  )
}
