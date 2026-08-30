/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { InputArea } from '@renderer/components/chat/InputArea'
import { ProjectTerminalDock } from '@renderer/components/terminal/ProjectTerminalDock'
import { WorkingFolderSelectorDialog } from './WorkingFolderSelectorDialog'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore, type Project } from '@renderer/stores/chat-store'
import { useChatActions, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import {
  NewSessionProjectSelector,
  type NewSessionProjectOption
} from './NewSessionProjectSelector'

type HomeProjectSnapshot = NewSessionProjectOption

function toHomeProjectSnapshot(project: Project): HomeProjectSnapshot {
  return {
    id: project.id,
    name: project.name,
    pluginId: project.pluginId,
    workingFolder: project.workingFolder,
    sshConnectionId: project.sshConnectionId
  }
}

function sanitizeProjectName(rawName: string, fallbackName: string): string {
  const cleaned = rawName
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallbackName
}

function deriveProjectNameFromFolder(folderPath: string, fallbackName: string): string {
  const normalized = folderPath.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  const name = parts[parts.length - 1]
  return name ? sanitizeProjectName(name, fallbackName) : fallbackName
}

function applySuggestedPrompt(prompt: string): void {
  const textarea = document.querySelector('textarea')
  if (textarea instanceof window.HTMLTextAreaElement) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set
    nativeInputValueSetter?.call(textarea, prompt)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
    return
  }

  const editor = document.querySelector('[role="textbox"][contenteditable="true"]')
  if (editor instanceof HTMLDivElement) {
    editor.replaceChildren(document.createTextNode(prompt))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    editor.focus()
  }
}

export function ChatHomePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const mode = useUIStore((s) => s.mode)
  const {
    activeProjectId,
    projects,
    activeProjectHomeId,
    activeProjectName,
    workingFolder,
    sshConnectionId
  } = useChatStore(
    useShallow((s) => {
      const project = s.activeProjectId
        ? (s.projects.find((item) => item.id === s.activeProjectId) ?? null)
        : null
      return {
        activeProjectId: s.activeProjectId,
        projects: s.projects,
        activeProjectHomeId: project?.id ?? null,
        activeProjectName: project?.name ?? null,
        workingFolder: project?.workingFolder,
        sshConnectionId: project?.sshConnectionId ?? null
      }
    })
  )
  const selectableProjects = React.useMemo(
    () =>
      projects
        .filter((project) => !project.pluginId)
        .map((project) => toHomeProjectSnapshot(project)),
    [projects]
  )
  const activeProject = React.useMemo<HomeProjectSnapshot | null>(
    () =>
      activeProjectHomeId
        ? {
            id: activeProjectHomeId,
            name: activeProjectName ?? '',
            workingFolder,
            sshConnectionId: sshConnectionId ?? undefined
          }
        : null,
    [activeProjectHomeId, activeProjectName, sshConnectionId, workingFolder]
  )
  const defaultSelectedProjectId =
    activeProjectId && selectableProjects.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : null
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null)
  const selectedProject =
    selectableProjects.find((project) => project.id === selectedProjectId) ?? null
  const homeProject = selectedProject ?? activeProject
  const homeWorkingFolder =
    selectedProject?.workingFolder ?? (mode === 'chat' ? undefined : workingFolder)
  const homeSshConnectionId =
    selectedProject?.sshConnectionId ?? (mode === 'chat' ? null : sshConnectionId)
  const terminalDockOpen = false  // Home page has no session; dock state is session-level now
  const { sendMessage } = useChatActions()
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = React.useState(false)

  React.useEffect(() => {
    setSelectedProjectId(defaultSelectedProjectId)
  }, [defaultSelectedProjectId])

  React.useEffect(() => {
    if (!selectedProjectId) return
    if (selectableProjects.some((project) => project.id === selectedProjectId)) return
    setSelectedProjectId(null)
  }, [selectableProjects, selectedProjectId])

  React.useEffect(() => {
    if (mode === 'chat' || selectedProjectId || selectableProjects.length === 0) return
    // Don't force-select a project if user explicitly clicked "New Chat"
    // (activeProjectId is null) - respect the global session intent
    if (!activeProjectId) return
    const nextProjectId = activeProjectId ?? selectableProjects[0].id
    setSelectedProjectId(nextProjectId)
    useChatStore.getState().setActiveProjectHome(nextProjectId)
  }, [activeProjectId, mode, selectableProjects, selectedProjectId])

  const handleSelectHomeProject = React.useCallback((projectId: string | null): void => {
    setSelectedProjectId(projectId)
    useChatStore.getState().setActiveProjectHome(projectId)
    const uiStore = useUIStore.getState()
    if (projectId && uiStore.mode === 'chat') {
      uiStore.setMode('cowork')
    } else if (!projectId) {
      uiStore.setMode('chat')
    }
  }, [])

  const handleCreateProjectWithDirectory = React.useCallback(
    async (folderPath: string, connectionId: string | null, projectName?: string): Promise<void> => {
      const chatStore = useChatStore.getState()
      const projectId = await chatStore.createProject({
        name: projectName?.trim() || deriveProjectNameFromFolder(
          folderPath,
          t('input.newProject', { defaultValue: 'New project' })
        ),
        workingFolder: folderPath,
        sshConnectionId: connectionId ?? undefined
      })
      setSelectedProjectId(projectId)
      chatStore.setActiveProjectHome(projectId)
      if (useUIStore.getState().mode === 'chat') {
        useUIStore.getState().setMode('cowork')
      }
      setCreateProjectDialogOpen(false)
    },
    [t]
  )

  const handleSend = React.useCallback(
    (text: string, images?: ImageAttachment[], options?: SendMessageOptions): void => {
      void (async () => {
        const chatStore = useChatStore.getState()
        // Global sessions (chat mode, no project) don't need a working folder.
        // Only project-scoped sessions get one from the project.
        const projectIdForSession =
          selectedProjectId &&
          chatStore.projects.some((project) => project.id === selectedProjectId)
            ? selectedProjectId
            : null
        const sessionId =
          mode === 'chat' && !projectIdForSession
            ? chatStore.createSession(mode, null, {
                scope: 'global',
                preserveProjectless: true
              })
            : chatStore.createSession(mode, projectIdForSession ?? activeProject?.id ?? undefined, {
                scope: 'project',
                collaborationMode: options?.collaborationMode,
                permissionMode: options?.permissionMode
              })
        useUIStore.getState().navigateToSession(sessionId)
        void sendMessage({ text, images, sessionId, opts: { ...options, clearCompletedTasksOnTurnStart: true } })
      })()
    },
    [activeProject?.id, mode, selectedProjectId, sendMessage]
  )

  const updateHomeProjectDirectory = React.useCallback(
    async (patch: { workingFolder: string; sshConnectionId: string | null }): Promise<void> => {
      const chatStore = useChatStore.getState()
      let projectId: string | null =
        selectedProject?.id ?? activeProject?.id ?? activeProjectId ?? null
      if (!projectId) {
        const ensured = await chatStore.ensureDefaultProject()
        projectId = ensured?.id ?? null
      }
      if (!projectId) return
      chatStore.setActiveProjectHome(projectId)
      setSelectedProjectId(projectId)
      chatStore.updateProjectDirectory(projectId, patch)
    },
    [activeProject?.id, activeProjectId, selectedProject?.id]
  )

  const quickPrompts =
    mode === 'chat'
      ? [t('messageList.explainAsync'), t('messageList.compareRest'), t('messageList.writeRegex')]
      : homeWorkingFolder
        ? [
            t('messageList.summarizeProject'),
            t('messageList.findBugs'),
            t('messageList.addErrorHandling')
          ]
        : [
            t('messageList.reviewCodebase'),
            t('messageList.addTests'),
            t('messageList.refactorError')
          ]

  const title =
    mode === 'chat'
      ? t('messageList.homeTitleChatQuestion')
      : homeWorkingFolder
        ? t('messageList.homeTitleBuildQuestion', {
            name: homeProject?.name ?? t('messageList.thisWorkspace')
          })
        : t('messageList.startCoding')

  const description =
    mode === 'chat'
      ? t('messageList.startConversationDesc')
      : homeWorkingFolder
        ? t('messageList.startCodingDesc')
        : t('input.noWorkingFolder', { mode })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-auto px-6 pb-14 pt-8 sm:pt-10">
        <div className="flex flex-1 items-start justify-center pt-8 lg:items-center lg:pt-0">
          <div className="w-full max-w-[760px]">
            <div className="mb-6 flex flex-col items-center gap-3 text-center sm:mb-7">
              <p className="max-w-[760px] text-[30px] font-semibold tracking-tight text-foreground/92 sm:text-[42px]">
                {title}
              </p>
              <p className="max-w-[560px] text-sm leading-6 text-muted-foreground/72">
                {description}
              </p>

              {mode !== 'chat' && homeProject ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="truncate text-foreground/88">{homeProject.name}</span>
                  {homeWorkingFolder ? (
                    <span className="max-w-[320px] truncate text-[11px] text-muted-foreground">
                      {homeWorkingFolder}
                    </span>
                  ) : null}
                  {homeSshConnectionId ? (
                    <span className="rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                      SSH
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <InputArea
              sessionId={null}
              onSend={handleSend}
              onSelectFolder={mode !== 'chat' ? () => setFolderDialogOpen(true) : undefined}
              workingFolder={homeWorkingFolder}
              hideWorkingFolderIndicator
              hideWorkingFolderPicker
              isStreaming={false}
              attachedFooter
            />

            <NewSessionProjectSelector
              projects={selectableProjects}
              selectedProjectId={selectedProjectId}
              allowNoProject={mode === 'chat'}
              locked={mode !== 'chat' && !!activeProjectId}
              onSelectProject={handleSelectHomeProject}
              onCreateProject={() => setCreateProjectDialogOpen(true)}
            />

            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-[11px] text-muted-foreground/72 transition-colors hover:bg-muted/40 hover:text-foreground"
                  onClick={() => applySuggestedPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {homeProject?.id && terminalDockOpen && (homeWorkingFolder || homeSshConnectionId) && (
        <ProjectTerminalDock
          projectId={homeProject.id}
          projectName={homeProject.name}
          workingFolder={homeWorkingFolder ?? null}
          sshConnectionId={homeSshConnectionId}
        />
      )}

      {mode !== 'chat' && (
        <WorkingFolderSelectorDialog
          open={folderDialogOpen}
          onOpenChange={setFolderDialogOpen}
          workingFolder={homeWorkingFolder}
          sshConnectionId={homeSshConnectionId}
          onSelectLocalFolder={(folderPath) =>
            updateHomeProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: null
            })
          }
          onSelectSshFolder={(folderPath, connectionId) =>
            updateHomeProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: connectionId
            })
          }
        />
      )}

      <WorkingFolderSelectorDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
        createMode
        projectName={t('input.newProject', { defaultValue: 'New project' })}
        onSelectLocalFolder={(folderPath, projectName) => handleCreateProjectWithDirectory(folderPath, null, projectName)}
        onSelectSshFolder={(folderPath, connectionId, projectName) =>
          handleCreateProjectWithDirectory(folderPath, connectionId, projectName)
        }
      />
    </div>
  )
}
