/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { FolderOpen, Server } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useSshStore } from '@renderer/stores/ssh-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  DEFAULT_SSH_WORKDIR,
  LocalFolderSection,
  SshConnectionSection
} from './working-folder/directory-list'
import { deriveProjectNameFromFolder } from './working-folder/project-name'
import type {
  DesktopDirectoryOption,
  DesktopDirectoryResult,
  PendingSelection,
  WorkingFolderSelectorDialogProps
} from './working-folder/types'

const SOURCE_TAB_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const
const SOURCE_PANEL_TRANSITION = { duration: 0.16, ease: 'easeOut' } as const

export function WorkingFolderSelectorDialog({
  open,
  onOpenChange,
  workingFolder,
  sshConnectionId,
  projectName,
  createMode = false,
  preferredSection = 'local',
  onSelectLocalFolder,
  onSelectSshFolder
}: WorkingFolderSelectorDialogProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const sshConnections = useSshStore((state) => state.connections)
  const loadSshConnections = useSshStore((state) => state.loadAll)
  const projectDefaultDirectoryMode = useSettingsStore((state) => state.projectDefaultDirectoryMode)
  const projectDefaultDirectory = useSettingsStore((state) => state.projectDefaultDirectory)
  const lastProjectDirectory = useSettingsStore((state) => state.lastProjectDirectory)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [desktopDirectories, setDesktopDirectories] = React.useState<DesktopDirectoryOption[]>([])
  const [desktopDirectoriesLoading, setDesktopDirectoriesLoading] = React.useState(false)
  const [sshDirInputs, setSshDirInputs] = React.useState<Record<string, string>>({})
  const [activeSection, setActiveSection] = React.useState<'local' | 'ssh'>(preferredSection)
  const [pendingSelection, setPendingSelection] = React.useState<PendingSelection | null>(null)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [customProjectName, setCustomProjectName] = React.useState('')

  const loadDesktopDirectories = React.useCallback(async (): Promise<void> => {
    setDesktopDirectoriesLoading(true)
    try {
      const result = (await ipcClient.invoke(
        'fs:list-desktop-directories'
      )) as DesktopDirectoryResult
      if ('error' in result || !Array.isArray(result.directories)) {
        setDesktopDirectories([])
        return
      }
      const seen = new Set<string>()
      setDesktopDirectories(
        result.directories.filter((directory) => {
          const key = directory.path.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      )
    } catch {
      setDesktopDirectories([])
    } finally {
      setDesktopDirectoriesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    void loadDesktopDirectories()
    void loadSshConnections()
    setActiveSection(preferredSection)
  }, [loadDesktopDirectories, loadSshConnections, open, preferredSection])

  React.useEffect(() => {
    if (!open) return
    setCreatingProject(false)
    if (createMode) {
      setPendingSelection(null)
      return
    }
    if (workingFolder?.trim()) {
      if (sshConnectionId?.trim()) {
        setPendingSelection({
          kind: 'ssh',
          folderPath: workingFolder,
          connectionId: sshConnectionId
        })
        return
      }
      setPendingSelection({
        kind: 'local',
        folderPath: workingFolder
      })
      return
    }
    setPendingSelection(null)
  }, [createMode, open, sshConnectionId, workingFolder])

  const activeLocalWorkingFolder =
    createMode && pendingSelection?.kind === 'local'
      ? pendingSelection.folderPath
      : (workingFolder ?? '')
  const activeSshConnectionId =
    createMode && pendingSelection?.kind === 'ssh'
      ? pendingSelection.connectionId
      : (sshConnectionId ?? null)
  const normalizedWorkingFolder = activeLocalWorkingFolder.toLowerCase()
  const preferredDirectory =
    projectDefaultDirectoryMode === 'custom' && projectDefaultDirectory.trim()
      ? projectDefaultDirectory.trim()
      : lastProjectDirectory.trim()
  const suggestedProjectName = projectName?.trim() || 'New Project'
  const showLocalSection = activeSection === 'local'
  const showSshSection = activeSection === 'ssh'
  const autoProjectName = pendingSelection
    ? deriveProjectNameFromFolder(pendingSelection.folderPath, suggestedProjectName)
    : suggestedProjectName

  // Sync project name input when folder selection changes
  React.useEffect(() => {
    setCustomProjectName(autoProjectName)
  }, [autoProjectName])
  const preferredDirectoryLabel =
    preferredDirectory || t('input.systemDefaultLocation', { defaultValue: 'System default' })

  const deriveBaseDirectoryFromSelectedFolder = React.useCallback((folderPath: string): string => {
    const normalized = folderPath.trim().replace(/[\\/]+$/, '')
    if (!normalized) return ''

    const parent = normalized.replace(/[\\/][^\\/]+$/, '')
    if (!parent) {
      if (normalized.startsWith('/')) return '/'
      if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}\\`
      return normalized
    }
    if (/^[A-Za-z]:$/.test(parent)) {
      return `${parent}\\`
    }
    return parent
  }, [])

  const handleChangeSection = React.useCallback(
    (section: 'local' | 'ssh'): void => {
      setActiveSection(section)
      if (!createMode) return
      setPendingSelection((current) => (current?.kind === section ? current : null))
    },
    [createMode]
  )

  const handleSelectOtherFolder = React.useCallback(async (): Promise<void> => {
    const result = (await ipcClient.invoke('fs:select-folder', {
      defaultPath: preferredDirectory || undefined
    })) as {
      canceled?: boolean
      path?: string
    }
    if (result.canceled || !result.path) {
      return
    }
    if (createMode) {
      setPendingSelection({
        kind: 'local',
        folderPath: result.path
      })
      return
    }
    await onSelectLocalFolder(result.path)
    updateSettings({ lastProjectDirectory: deriveBaseDirectoryFromSelectedFolder(result.path) })
    onOpenChange(false)
  }, [
    createMode,
    deriveBaseDirectoryFromSelectedFolder,
    onOpenChange,
    onSelectLocalFolder,
    preferredDirectory,
    updateSettings
  ])

  const handleSelectDesktopFolder = React.useCallback(
    async (folderPath: string): Promise<void> => {
      if (createMode) {
        setPendingSelection({
          kind: 'local',
          folderPath
        })
        return
      }
      await onSelectLocalFolder(folderPath)
      updateSettings({ lastProjectDirectory: folderPath })
      onOpenChange(false)
    },
    [createMode, onOpenChange, onSelectLocalFolder, updateSettings]
  )

  const handleSelectSshFolder = React.useCallback(
    async (connectionId: string): Promise<void> => {
      const conn = sshConnections.find((item) => item.id === connectionId)
      if (!conn) return
      const folderPath =
        sshDirInputs[connectionId]?.trim() || conn.defaultDirectory || DEFAULT_SSH_WORKDIR
      if (createMode) {
        setPendingSelection({
          kind: 'ssh',
          folderPath,
          connectionId
        })
        return
      }
      await onSelectSshFolder(folderPath, connectionId)
      onOpenChange(false)
    },
    [createMode, onOpenChange, onSelectSshFolder, sshConnections, sshDirInputs]
  )

  const handleChangeSshDir = React.useCallback(
    (connectionId: string, value: string): void => {
      setSshDirInputs((prev) => ({
        ...prev,
        [connectionId]: value
      }))
    },
    []
  )

  const handleCreateProject = React.useCallback(async (): Promise<void> => {
    if (!createMode || !pendingSelection || creatingProject) return
    setCreatingProject(true)
    try {
      const finalProjectName = customProjectName.trim() || autoProjectName
      if (pendingSelection.kind === 'ssh') {
        await onSelectSshFolder(pendingSelection.folderPath, pendingSelection.connectionId, finalProjectName)
      } else {
        updateSettings({
          lastProjectDirectory: deriveBaseDirectoryFromSelectedFolder(pendingSelection.folderPath)
        })
        await onSelectLocalFolder(pendingSelection.folderPath, finalProjectName)
      }
    } finally {
      setCreatingProject(false)
      onOpenChange(false)
    }
  }, [
    autoProjectName,
    createMode,
    creatingProject,
    customProjectName,
    deriveBaseDirectoryFromSelectedFolder,
    onOpenChange,
    onSelectLocalFolder,
    onSelectSshFolder,
    pendingSelection,
    updateSettings
  ])

  const pendingSelectionConnection =
    pendingSelection?.kind === 'ssh'
      ? sshConnections.find((item) => item.id === pendingSelection.connectionId)
      : null
  const localFolderSection = (
    <LocalFolderSection
      createMode={createMode}
      preferredDirectoryLabel={preferredDirectoryLabel}
      desktopDirectoriesLoading={desktopDirectoriesLoading}
      desktopDirectories={desktopDirectories}
      normalizedWorkingFolder={normalizedWorkingFolder}
      onSelectOtherFolder={handleSelectOtherFolder}
      onRefresh={loadDesktopDirectories}
      onSelectDesktopFolder={handleSelectDesktopFolder}
    />
  )
  const sshConnectionSection = (
    <SshConnectionSection
      createMode={createMode}
      connections={sshConnections}
      activeSshConnectionId={activeSshConnectionId}
      sshDirInputs={sshDirInputs}
      onSelectSshFolder={handleSelectSshFolder}
      onChangeSshDir={handleChangeSshDir}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 overflow-x-hidden p-4 sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="text-sm">
            {createMode ? t('input.createProject') : t('input.selectFolder')}
          </DialogTitle>
        </DialogHeader>

        <div className="-mt-1 min-w-0 overflow-hidden rounded-xl border bg-background/60 p-3">
          {createMode ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] text-muted-foreground/60">
                  {t('input.createProjectSubtitle', {
                    defaultValue: 'Choose a local or SSH folder. Project name defaults to the folder name and can be edited.'
                  })}
                </p>
                <div className="shrink-0">
                  <div className="relative grid grid-cols-2 rounded-lg border border-border/70 bg-muted/20 p-0.5">
                    <motion.span
                      className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-sm"
                      animate={{ x: showSshSection ? '100%' : '0%' }}
                      transition={SOURCE_TAB_TRANSITION}
                    />
                    <button
                      className={cn(
                        'relative z-10 rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
                        showLocalSection
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      type="button"
                      aria-pressed={showLocalSection}
                      onClick={() => handleChangeSection('local')}
                    >
                      {t('input.sourceLocal', { defaultValue: 'Local' })}
                    </button>
                    <button
                      className={cn(
                        'relative z-10 rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
                        showSshSection
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      type="button"
                      aria-pressed={showSshSection}
                      onClick={() => handleChangeSection('ssh')}
                    >
                      {t('input.sourceSsh', { defaultValue: 'SSH' })}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="mb-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground/70">
                {t('input.currentWorkingFolder')}
              </p>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <FolderOpen className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {workingFolder ?? t('input.noWorkingFolderSelected')}
                </span>
              </div>
            </div>
          )}

          {createMode ? (
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: showLocalSection ? -8 : 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: showLocalSection ? 8 : -8 }}
                transition={SOURCE_PANEL_TRANSITION}
              >
                {showLocalSection ? localFolderSection : sshConnectionSection}
              </motion.div>
            </AnimatePresence>
          ) : (
            <>
              {localFolderSection}
              {sshConnectionSection}
            </>
          )}

          {createMode ? (
            <div className="mt-3 border-t pt-3">
              <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-2">
                <p className="text-[10px] font-medium text-muted-foreground/80">
                  {t('input.selectedWorkingFolder', {
                    defaultValue: 'Selected working folder'
                  })}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  {pendingSelection?.kind === 'ssh' ? (
                    <Server className="size-3 shrink-0" />
                  ) : (
                    <FolderOpen className="size-3 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {pendingSelection?.folderPath || t('input.noWorkingFolderSelected')}
                  </span>
                </div>
                {pendingSelectionConnection ? (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground/60">
                    {pendingSelectionConnection.name} · {pendingSelectionConnection.username}@
                    {pendingSelectionConnection.host}:{pendingSelectionConnection.port}
                  </p>
                ) : null}
              </div>

              <div className="mt-3">
                <p className="text-[10px] font-medium text-muted-foreground/80">
                  {t('input.projectName')}
                </p>
                <Input
                  value={customProjectName}
                  onChange={(e) => setCustomProjectName(e.target.value)}
                  placeholder={suggestedProjectName}
                  className="mt-1 h-8 text-[13px]"
                  disabled={!pendingSelection}
                />
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="rounded-md border border-border/70 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  {tCommon('action.cancel')}
                </button>
                <button
                  className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleCreateProject()}
                  disabled={!pendingSelection || creatingProject}
                >
                  {pendingSelection
                    ? t('input.createProject')
                    : t('input.selectFolderFirst', { defaultValue: 'Select a folder first' })}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
