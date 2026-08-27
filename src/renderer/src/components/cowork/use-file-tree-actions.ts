import { useCallback, useMemo, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useUIStore } from '@renderer/stores/ui-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import type { TreeNode, TreeEditState, TreeActions } from './file-tree-types'
import {
  getErrorMessage, getIpcError, validateEntryName, parentPath, joinPath,
  countTreeStats, collapseTree, type EntryNameValidationError
} from './file-tree-utils'
import type { FileTreeState } from './use-file-tree'

export interface UseFileTreeActionsOptions {
  agentCommand?: import('./file-tree-types').AgentFileTreeCommand | null
}

export function useFileTreeActions(state: FileTreeState, options: UseFileTreeActionsOptions = {}) {
  const {
    t, sessionView, workingFolder, sshConnectionId, agentSurface,
    previewPanelState,
    tree, setTree, treeRef,
    renamingPath, setRenamingPath,
    newItemParent, setNewItemParent,
    newItemType, setNewItemType,
    loadDir, loadRoot, refreshTree, refreshDir,
    handleAddToChat, handleCopyPath
  } = state

  const { agentCommand = null } = options

  const sep = sshConnectionId ? '/' : workingFolder?.includes('/') ? '/' : '\\'

  const getNameValidationErrorMessage = useCallback(
    (error: EntryNameValidationError): string => {
      if (error === 'empty') {
        return t('fileTree.nameEmpty', { defaultValue: 'Name cannot be empty' })
      }
      if (error === 'dot') {
        return t('fileTree.nameDotReserved', {
          defaultValue: 'Name cannot be "." or ".."'
        })
      }
      return t('fileTree.nameSeparator', {
        defaultValue: 'Name cannot contain path separators'
      })
    },
    [t]
  )

  const showActionError = useCallback((title: string, err: unknown) => {
    toast.error(title, {
      description: getErrorMessage(err)
    })
  }, [])

  const pathExists = useCallback(
    async (targetPath: string): Promise<boolean> => {
      const result = await ipcClient.invoke(
        sshConnectionId ? IPC.SSH_FS_STAT_PATH : IPC.FS_STAT_PATH,
        sshConnectionId ? { connectionId: sshConnectionId, path: targetPath } : { path: targetPath }
      )
      const error = getIpcError(result)
      if (error) throw new Error(error)
      return Boolean((result as { exists?: boolean } | undefined)?.exists)
    },
    [sshConnectionId]
  )

  const handleDelete = useCallback(
    async (nodePath: string, nodeName: string, isDir: boolean) => {
      const type = isDir ? t('fileTree.folder') : t('fileTree.file')
      const confirmed = await confirm({
        title: t('fileTree.deleteConfirmTitle', {
          type,
          defaultValue: 'Delete {{type}}?'
        }),
        description: t('fileTree.deleteConfirmDescription', {
          name: nodeName,
          defaultValue: 'Delete "{{name}}"?'
        }),
        confirmLabel: t('action.delete', { ns: 'common' }),
        variant: 'destructive'
      })
      if (!confirmed) return
      try {
        const result = await ipcClient.invoke(
          sshConnectionId ? IPC.SSH_FS_DELETE : IPC.SHELL_TRASH_PATH,
          sshConnectionId ? { connectionId: sshConnectionId, path: nodePath } : nodePath
        )
        const error = getIpcError(result)
        if (error) throw new Error(error)
        const parentDir = parentPath(nodePath, sep)
        if (parentDir === workingFolder) {
          await loadRoot(true)
        } else {
          await refreshDir(parentDir)
        }
      } catch (err) {
        showActionError(t('fileTree.deleteFailed', { defaultValue: 'Delete failed' }), err)
      }
    },
    [sep, sshConnectionId, t, workingFolder, loadRoot, refreshDir, showActionError]
  )

  const handleRenameStart = useCallback((nodePath: string) => {
    setRenamingPath(nodePath)
    setNewItemParent(null)
  }, [])

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renamingPath) return
      const validationError = validateEntryName(newName)
      if (validationError) {
        toast.error(t('fileTree.invalidName', { defaultValue: 'Invalid name' }), {
          description: getNameValidationErrorMessage(validationError)
        })
        return
      }

      const parentDir = parentPath(renamingPath, sep)
      const newPath = joinPath(parentDir, newName, sep)
      try {
        if (newPath !== renamingPath && (await pathExists(newPath))) {
          throw new Error(t('fileTree.targetExists', { defaultValue: 'Target already exists' }))
        }

        const result = await ipcClient.invoke(
          sshConnectionId ? IPC.SSH_FS_MOVE : IPC.FS_MOVE,
          sshConnectionId
            ? { connectionId: sshConnectionId, from: renamingPath, to: newPath }
            : { from: renamingPath, to: newPath }
        )
        const error = getIpcError(result)
        if (error) throw new Error(error)
        setRenamingPath(null)
        if (parentDir === workingFolder) {
          await loadRoot(true)
        } else {
          await refreshDir(parentDir)
        }
      } catch (err) {
        showActionError(t('fileTree.renameFailed', { defaultValue: 'Rename failed' }), err)
      }
    },
    [
      renamingPath,
      sep,
      sshConnectionId,
      workingFolder,
      loadRoot,
      refreshDir,
      pathExists,
      showActionError,
      getNameValidationErrorMessage,
      t,
      setRenamingPath
    ]
  )

  const handleRenameCancel = useCallback(() => setRenamingPath(null), [])

  const expandDirectoryForNewItem = useCallback(
    async (dirPath: string) => {
      if (dirPath === workingFolder) return

      const expandNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (n) => {
            if (n.path === dirPath && n.type === 'directory' && !n.expanded) {
              if (!n.loaded) {
                const children = await loadDir(dirPath)
                return { ...n, expanded: true, loaded: true, children }
              }
              return { ...n, expanded: true }
            }
            if (n.children) return { ...n, children: await expandNode(n.children) }
            return n
          })
        )
      }
      setTree(await expandNode(treeRef.current))
    },
    [loadDir, workingFolder, setTree, treeRef]
  )

  const handleNewFile = useCallback(
    async (dirPath: string) => {
      setNewItemParent(dirPath)
      setNewItemType('file')
      setRenamingPath(null)
      await expandDirectoryForNewItem(dirPath)
    },
    [expandDirectoryForNewItem, setNewItemParent, setNewItemType, setRenamingPath]
  )

  const handleNewFolder = useCallback(
    async (dirPath: string) => {
      setNewItemParent(dirPath)
      setNewItemType('directory')
      setRenamingPath(null)
      await expandDirectoryForNewItem(dirPath)
    },
    [expandDirectoryForNewItem, setNewItemParent, setNewItemType, setRenamingPath]
  )

  const handleNewItemConfirm = useCallback(
    async (name: string) => {
      if (!newItemParent) return
      const validationError = validateEntryName(name)
      if (validationError) {
        toast.error(t('fileTree.invalidName', { defaultValue: 'Invalid name' }), {
          description: getNameValidationErrorMessage(validationError)
        })
        return
      }

      const newPath = joinPath(newItemParent, name, sep)
      try {
        if (await pathExists(newPath)) {
          throw new Error(t('fileTree.targetExists', { defaultValue: 'Target already exists' }))
        }

        let result: unknown
        if (newItemType === 'directory') {
          result = await ipcClient.invoke(
            sshConnectionId ? IPC.SSH_FS_MKDIR : IPC.FS_MKDIR,
            sshConnectionId ? { connectionId: sshConnectionId, path: newPath } : { path: newPath }
          )
        } else {
          result = await ipcClient.invoke(
            sshConnectionId ? IPC.SSH_FS_WRITE_FILE : IPC.FS_WRITE_FILE,
            sshConnectionId
              ? { connectionId: sshConnectionId, path: newPath, content: '' }
              : { path: newPath, content: '' }
          )
        }
        const error = getIpcError(result)
        if (error) throw new Error(error)
        setNewItemParent(null)
        await refreshDir(newItemParent)
      } catch (err) {
        showActionError(t('fileTree.createFailed', { defaultValue: 'Create failed' }), err)
      }
    },
    [
      newItemParent,
      newItemType,
      sep,
      sshConnectionId,
      refreshDir,
      pathExists,
      showActionError,
      getNameValidationErrorMessage,
      t,
      setNewItemParent
    ]
  )

  const handleNewItemCancel = useCallback(() => setNewItemParent(null), [])

  const handleRefresh = useCallback(
    async (dirPath: string) => {
      await refreshDir(dirPath)
    },
    [refreshDir]
  )

  const handleOpenDefault = useCallback(
    async (nodePath: string) => {
      if (sshConnectionId) {
        toast.info(t('fileTree.localOnlyAction', { defaultValue: 'This action is local only' }))
        return
      }

      const result = await ipcClient.invoke(IPC.SHELL_OPEN_PATH, { path: nodePath })
      if (typeof result === 'string' && result.length > 0) {
        toast.error(t('fileTree.openFailed', { defaultValue: 'Open failed' }), {
          description: result
        })
      }
    },
    [sshConnectionId, t]
  )

  const handleReveal = useCallback(
    async (nodePath: string) => {
      if (sshConnectionId) {
        toast.info(t('fileTree.localOnlyAction', { defaultValue: 'This action is local only' }))
        return
      }

      const result = await ipcClient.invoke(IPC.SHELL_SHOW_ITEM_IN_FOLDER, { path: nodePath })
      const error = getIpcError(result)
      if (error) {
        toast.error(t('fileTree.revealFailed', { defaultValue: 'Reveal failed' }), {
          description: error
        })
      }
    },
    [sshConnectionId, t]
  )

  const handleOpenWithCode = useCallback(
    async (nodePath: string) => {
      if (sshConnectionId) {
        toast.info(t('fileTree.localOnlyAction', { defaultValue: 'This action is local only' }))
        return
      }

      const result = await ipcClient.invoke(IPC.SHELL_OPEN_WITH_APP, {
        path: nodePath,
        appId: 'vscode'
      })
      const error = getIpcError(result)
      if (error) {
        toast.error(t('fileTree.openWithCodeFailed', { defaultValue: 'Open in VS Code failed' }), {
          description: error
        })
      }
    },
    [sshConnectionId, t]
  )

  const handleOpenTerminal = useCallback(
    async (nodePath: string, isDir?: boolean) => {
      const sessionId = sessionView.sessionId
      if (!sessionId) return
      // Resolve cwd: if the target is a directory, use it directly;
      // if it's a file, use its parent directory
      const cwd = isDir ? nodePath : parentPath(nodePath, sep)
      // Create a new terminal tab with the specific folder as cwd
      await useTerminalStore.getState().createTab(
        cwd,
        sessionView.projectId,
        undefined,
        sessionId
      )
      useUIStore.getState().setBottomTerminalDockOpen(sessionId, true)
    },
    [sep, sessionView]
  )

  const activePath = previewPanelState?.source === 'file' ? previewPanelState.filePath : null
  const treeStats = useMemo(() => countTreeStats(tree), [tree])

  const handlePreview = useCallback(
    (filePath: string) => {
      if (!filePath) return
      useUIStore.getState().openFilePreview(filePath, undefined, undefined, sessionView.sessionId)
    },
    [sessionView.sessionId]
  )

  const editState: TreeEditState = { renamingPath, newItemParent, newItemType }
  const treeActions: TreeActions = {
    localActionsAvailable: !sshConnectionId,
    onDelete: handleDelete,
    onRenameStart: handleRenameStart,
    onRenameConfirm: handleRenameConfirm,
    onRenameCancel: handleRenameCancel,
    onAddToChat: handleAddToChat,
    onCopyPath: handleCopyPath,
    onPreview: handlePreview,
    onOpenDefault: handleOpenDefault,
    onOpenTerminal: handleOpenTerminal,
    onOpenWithCode: handleOpenWithCode,
    onReveal: handleReveal,
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    onNewItemConfirm: handleNewItemConfirm,
    onNewItemCancel: handleNewItemCancel,
    onRefresh: handleRefresh
  }

  const handleCollapseAll = useCallback(() => {
    setTree((current) => collapseTree(current))
  }, [setTree])

  // --- Agent command effect ---
  const lastAgentCommandIdRef = useRef(0)
  useEffect(() => {
    if (!agentSurface || !workingFolder || !agentCommand) return
    if (lastAgentCommandIdRef.current === agentCommand.id) return
    lastAgentCommandIdRef.current = agentCommand.id

    if (agentCommand.type === 'new-file') {
      void handleNewFile(workingFolder)
      return
    }
    if (agentCommand.type === 'new-folder') {
      void handleNewFolder(workingFolder)
      return
    }
    if (agentCommand.type === 'refresh') {
      void refreshTree()
      return
    }
    if (agentCommand.type === 'collapse-all') {
      handleCollapseAll()
    }
  }, [
    agentCommand,
    agentSurface,
    handleCollapseAll,
    handleNewFile,
    handleNewFolder,
    refreshTree,
    workingFolder
  ])

  return {
    handleDelete, handleRenameStart, handleRenameConfirm, handleRenameCancel,
    handleNewFile, handleNewFolder, handleNewItemConfirm, handleNewItemCancel,
    handleRefresh, handleOpenDefault, handleReveal, handleOpenWithCode,
    handleOpenTerminal, handlePreview, handleCollapseAll,
    activePath, treeStats, editState, treeActions
  }
}

export type FileTreeActions = ReturnType<typeof useFileTreeActions>
