import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, MoreHorizontal, Trash2, Pencil, SquareTerminal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { MessageList } from '@renderer/components/chat/MessageList'
import { InputArea } from '@renderer/components/chat/InputArea'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatActions, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { BottomTerminalDock } from '@renderer/components/terminal/BottomTerminalDock'
import { toast } from 'sonner'
import { confirm } from '@renderer/components/ui/confirm-dialog'

interface SessionConversationPaneProps {
  sessionId?: string | null
}

export function SessionConversationPane({
  sessionId
}: SessionConversationPaneProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const resolvedSessionId = sessionId ?? activeSessionId
  const session = useChatStore((s) =>
    s.sessions.find((sess) => sess.id === resolvedSessionId)
  )
  const clearSessionMessages = useChatStore((s) => s.clearSessionMessages)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const { sendMessage, stopStreaming } = useChatActions()
  const isStreaming = useChatStore((s) =>
    resolvedSessionId ? Boolean(s.streamingMessages[resolvedSessionId]) : false
  )

  // Project info for terminal dock
  const project = useChatStore((s) => {
    if (!session?.projectId) return undefined
    return s.projects.find((p) => p.id === session.projectId)
  })
  const projectWorkingFolder = project?.workingFolder
  const projectId = session?.projectId ?? null
  const projectName = project?.name
  const sshConnectionId = project?.sshConnectionId ?? null

  // Bottom terminal dock state
  const bottomTerminalDockOpen = useUIStore((s) =>
    resolvedSessionId ? Boolean(s.bottomTerminalDockOpenBySessionId[resolvedSessionId]) : false
  )
  const toggleBottomTerminalDock = useUIStore((s) => s.toggleBottomTerminalDock)
  const initTerminal = useTerminalStore((s) => s.init)

  // Ensure terminal store is initialized (also done in App.tsx, but safe to double-init)
  useState(() => {
    initTerminal()
  })

  const handleSend = useCallback(
    (text: string, _images?: unknown, _options?: unknown) => {
      if (!resolvedSessionId) return
      void sendMessage({ text, sessionId: resolvedSessionId, opts: _options as SendMessageOptions | undefined })
    },
    [resolvedSessionId, sendMessage]
  )

  const handleClear = useCallback(() => {
    if (!resolvedSessionId) return
    if (session && session.messageCount > 0) {
      clearSessionMessages(resolvedSessionId)
      toast.success(t('layout.conversationCleared', { defaultValue: 'Conversation cleared' }))
    }
  }, [resolvedSessionId, session, clearSessionMessages, t])

  const handleDelete = useCallback(async () => {
    if (!resolvedSessionId) return
    const ok = await confirm({
      title: t('sidebar.deleteSessionConfirmTitle', {
        defaultValue: 'Delete this session?'
      }),
      description: t('sidebar.deleteSessionConfirmDesc', {
        defaultValue:
          '"{{title}}" and its message history will be permanently deleted. This cannot be undone.',
        title: session?.title ?? ''
      }),
      variant: 'destructive'
    })
    if (!ok) return
    deleteSession(resolvedSessionId)
    useUIStore.getState().navigateToHome()
  }, [resolvedSessionId, session, deleteSession, t])

  const handleRename = useCallback(() => {
    if (!resolvedSessionId || !session) return
    const newName = window.prompt(t('sidebar.rename', { defaultValue: 'Rename' }), session.title)
    if (newName && newName.trim() && newName.trim() !== session.title) {
      renameSession(resolvedSessionId, newName.trim())
    }
  }, [resolvedSessionId, session, renameSession, t])

  const handleToggleTerminal = useCallback((): void => {
    if (resolvedSessionId) {
      toggleBottomTerminalDock(resolvedSessionId)
    }
  }, [resolvedSessionId, toggleBottomTerminalDock])

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('layout.noSessionSelected', { defaultValue: 'No session selected' })}</p>
      </div>
    )
  }

  const hasMessages = (session.messageCount ?? 0) > 0

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Left: Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Session action bar (no title — TitleBar already shows it) */}
        <div className="flex shrink-0 items-center justify-end gap-1 px-3 py-1.5">
          <div className="flex items-center rounded-lg border border-border/60 bg-background/70 p-0.5 shadow-sm backdrop-blur-sm">
            {/* Terminal toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleTerminal}
                  className={`
                    flex size-7 items-center justify-center rounded-md transition-colors
                    ${bottomTerminalDockOpen
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground/80 hover:bg-accent hover:text-foreground'}
                  `}
                >
                  <SquareTerminal className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {bottomTerminalDockOpen ? 'Hide terminal' : 'Show terminal'}
              </TooltipContent>
            </Tooltip>

            <div className="mx-0.5 h-4 w-px bg-border/60" />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClear}
                  disabled={!hasMessages || isStreaming}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Eraser className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('sidebar.clearMessages', { defaultValue: 'Clear messages' })}</TooltipContent>
            </Tooltip>

            <div className="mx-0.5 h-4 w-px bg-border/60" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground">
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleRename}>
                  <Pencil className="mr-2 size-4" />
                  {t('sidebar.rename', { defaultValue: 'Rename' })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClear} disabled={!hasMessages}>
                  <Eraser className="mr-2 size-4" />
                  {t('sidebar.clearMessages', { defaultValue: 'Clear messages' })}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                  <Trash2 className="mr-2 size-4" />
                  {t('sidebar.deleteSession', { defaultValue: 'Delete session' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Messages */}
        <div className="flex flex-1 min-h-0">
          <MessageList />
        </div>

        {/* Input */}
        <InputArea
          onSend={handleSend}
          isStreaming={isStreaming}
          onStop={stopStreaming}
          sessionId={resolvedSessionId ?? undefined}
          workingFolder={session?.workingFolder ?? projectWorkingFolder}
          hideWorkingFolderIndicator
        />

        {/* Bottom terminal dock - keep mounted, hide via CSS to preserve state */}
        {resolvedSessionId && projectId && (
          <div className={bottomTerminalDockOpen ? "shrink-0 border-t" : "hidden"}>
            <BottomTerminalDock
              projectId={projectId}
              sessionId={resolvedSessionId}
              projectName={projectName}
              workingFolder={projectWorkingFolder ?? null}
              sshConnectionId={sshConnectionId}
              dockOpen={bottomTerminalDockOpen}
            />
          </div>
        )}
      </div>
    </div>
  )
}
