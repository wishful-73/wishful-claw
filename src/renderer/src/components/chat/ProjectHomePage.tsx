import * as React from 'react'
import { BookOpen, GitBranch, MessageSquare, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { InputArea } from '@renderer/components/chat/InputArea'
import { ProjectTerminalDock } from '@renderer/components/terminal/ProjectTerminalDock'
import { WorkingFolderSelectorDialog } from '@renderer/components/chat/WorkingFolderSelectorDialog'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useChatActions, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import { ensureDefaultChatWorkingFolder } from '@renderer/lib/chat-working-folder'

export function ProjectHomePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const activeProjectId = useChatStore((state) => state.activeProjectId)
  const projects = useChatStore((state) => state.projects)
  const mode = useUIStore((state) => state.mode)
  const terminalDockOpen = false  // Project home has no session; dock state is session-level now
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const workingFolder = activeProject?.workingFolder
  const sshConnectionId = activeProject?.sshConnectionId
  const { sendMessage } = useChatActions()
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)

  const handleSend = React.useCallback(
    (text: string, images?: ImageAttachment[], options?: SendMessageOptions): void => {
      void (async () => {
        if (!activeProjectId && mode !== 'chat') return
        const chatStore = useChatStore.getState()
        const uiStore = useUIStore.getState()
        const chatWorkingFolder =
          !activeProjectId ? await ensureDefaultChatWorkingFolder() : undefined
        const sessionId = activeProjectId
          ? chatStore.createSession(mode, activeProjectId, {
              scope: 'project',
              collaborationMode: options?.collaborationMode,
              permissionMode: options?.permissionMode
            })
          : chatStore.createSession(mode, null, {
              scope: 'global',
              preserveProjectless: true,
              workingFolder: chatWorkingFolder
            })
        uiStore.navigateToSession(sessionId)
        void sendMessage({ text, images, sessionId, opts: { ...options, clearCompletedTasksOnTurnStart: true } })
      })()
    },
    [activeProjectId, mode, sendMessage]
  )

  const updateProjectDirectory = React.useCallback(
    async (patch: { workingFolder: string; sshConnectionId: string | null }): Promise<void> => {
      if (!activeProjectId) return
      useChatStore.getState().updateProjectDirectory(activeProjectId, patch)
    },
    [activeProjectId]
  )

  if (!activeProject) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-[520px] text-center">
          <p className="text-[28px] font-semibold tracking-tight text-foreground">
            {t('projectHome.noProjectSelected')}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('projectHome.noProjectSelectedDesc')}
          </p>
          <Button
            className="mt-6 h-9 rounded-md px-4"
            onClick={() => useUIStore.getState().navigateToHome()}
          >
            {t('projectHome.backHome')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-auto px-6 pb-14 pt-8 sm:pt-10">
        <div className="flex flex-1 items-start justify-center pt-8 lg:items-center lg:pt-0">
          <div className="w-full max-w-[760px]">
            <div className="mb-6 flex flex-col items-center gap-3 text-center sm:mb-7">
              <p className="max-w-[760px] text-[30px] font-semibold tracking-tight text-foreground/92 sm:text-[42px]">
                {activeProject.name}
              </p>
              <p className="max-w-[560px] text-sm leading-6 text-muted-foreground/72">
                {workingFolder
                  ? `${workingFolder}`
                  : t('projectHome.noWorkingFolder')}
              </p>

              {sshConnectionId ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] text-muted-foreground">
                    SSH
                  </span>
                </div>
              ) : null}
            </div>

            <InputArea
              sessionId={null}
              onSend={handleSend}
              onSelectFolder={() => setFolderDialogOpen(true)}
              workingFolder={workingFolder}
              hideWorkingFolderIndicator
              hideWorkingFolderPicker
              isStreaming={false}
            />

            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-md border border-border/60 bg-background/50 px-3 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => useUIStore.getState().navigateToArchive(activeProject.id)}
              >
                <BookOpen className="size-3.5" />
                {t('projectHome.openArchive')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-md border border-border/60 bg-background/50 px-3 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => useUIStore.getState().navigateToChannels(activeProject.id)}
              >
                <MessageSquare className="size-3.5" />
                {t('projectHome.openChannels')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-md border border-border/60 bg-background/50 px-3 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => useUIStore.getState().navigateToGit(activeProject.id)}
              >
                <GitBranch className="size-3.5" />
                {t('projectHome.openGit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-md border border-border/60 bg-background/50 px-3 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => useUIStore.getState().navigateToPersona(activeProject.id)}
              >
                <User className="size-3.5" />
                {t('projectHome.openPersona', { defaultValue: '人格管理' })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {terminalDockOpen && (workingFolder || sshConnectionId) && (
        <ProjectTerminalDock
          projectId={activeProject.id}
          projectName={activeProject.name}
          workingFolder={workingFolder ?? null}
          sshConnectionId={sshConnectionId}
        />
      )}

      <WorkingFolderSelectorDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        workingFolder={workingFolder}
        sshConnectionId={sshConnectionId}
        onSelectLocalFolder={(folderPath) =>
          updateProjectDirectory({
            workingFolder: folderPath,
            sshConnectionId: null
          })
        }
        onSelectSshFolder={(folderPath, connectionId) =>
          updateProjectDirectory({
            workingFolder: folderPath,
            sshConnectionId: connectionId
          })
        }
      />
    </div>
  )
}
