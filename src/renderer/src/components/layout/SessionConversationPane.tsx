import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronsLeftRight, ChevronsRightLeft, FolderOpen, Loader2, MoreHorizontal, Trash2, Pencil, SquareTerminal } from 'lucide-react'
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
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChatActions, compressSessionContext, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import { useContextCompression } from '@renderer/components/chat/InputArea/use-context-compression'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { BottomTerminalDock } from '@renderer/components/terminal/BottomTerminalDock'
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
  const ensureFilesTab = useUIStore((s) => s.ensureFilesTab)
  const initTerminal = useTerminalStore((s) => s.init)

  // Chat column width preference — persisted in the settings store so it
  // survives refresh/restart; MessageList and InputArea share the same flag
  // so the composer never outgrows the message column.
  const conversationFullWidth = useSettingsStore((s) => s.conversationPanelFullWidth)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

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

  // Open the right panel on the Files tab for the current workspace.
  // Sessions without a working folder (global conversations) hide the
  // button entirely instead of pretending the panel has anything to show.
  const handleOpenFilesPanel = useCallback((): void => {
    if (!resolvedSessionId) return
    ensureFilesTab(resolvedSessionId)
  }, [resolvedSessionId, ensureFilesTab])

  // Toggle between the standard 820px message column and full panel width.
  // The chat column is a flex lane, so opening/closing the right panel just
  // re-clamps the available space automatically.
  const handleToggleChatWidth = useCallback((): void => {
    updateSettings({ conversationPanelFullWidth: !conversationFullWidth })
  }, [conversationFullWidth, updateSettings])

  // Manual context compression entry (ContextRing in the composer toolbar).
  // The action returns an explicit compressed/skipped/blocked/failed status.
  const handleCompressContext = useCallback(() => {
    if (!resolvedSessionId) return 'blocked' as const
    return compressSessionContext(resolvedSessionId)
  }, [resolvedSessionId])

  // Floating-block compression button state — reuses the unified manual
  // compression feedback hook (compressing/compressed/skipped/blocked/failed).
  const {
    isContextCompressing,
    handleCompressContext: runCompressContext,
    contextCompressionStatusLabel
  } = useContextCompression({ onCompressContext: handleCompressContext, t })

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('layout.noSessionSelected', { defaultValue: 'No session selected' })}</p>
      </div>
    )
  }

  const hasWorkingFolder = Boolean(session.workingFolder ?? projectWorkingFolder)

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Left: Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages — the session action block floats over the top-right corner */}
        <div className="relative flex flex-1 min-h-0">
          <MessageList fullWidth={conversationFullWidth} />

          {/* Floating vertical session action block */}
          <div className="absolute right-3 top-3 z-30 flex flex-col items-center gap-0.5 rounded-lg border border-border/60 bg-background/70 p-0.5 shadow-sm backdrop-blur-sm">
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
              <TooltipContent side="left">
                {bottomTerminalDockOpen ? 'Hide terminal' : 'Show terminal'}
              </TooltipContent>
            </Tooltip>

            {/* Compress session context */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={runCompressContext}
                  disabled={isContextCompressing}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                >
                  {isContextCompressing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Archive className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {contextCompressionStatusLabel ||
                  t('layout.compressContext', { defaultValue: 'Compress session' })}
              </TooltipContent>
            </Tooltip>

            {/* Open right panel on the Files tab — hidden for sessions
                without a working folder (global conversations) */}
            {hasWorkingFolder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleOpenFilesPanel}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <FolderOpen className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t('layout.openFolderPanel', { defaultValue: 'Open files panel' })}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Chat column width toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleChatWidth}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                >
                  {conversationFullWidth ? (
                    <ChevronsRightLeft className="size-4" />
                  ) : (
                    <ChevronsLeftRight className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {conversationFullWidth
                  ? t('layout.standardChatWidth', { defaultValue: 'Restore standard width' })
                  : t('layout.widenChat', { defaultValue: 'Widen chat area' })}
              </TooltipContent>
            </Tooltip>

            <div className="my-0.5 h-px w-4 bg-border/60" />

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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                  <Trash2 className="mr-2 size-4" />
                  {t('sidebar.deleteSession', { defaultValue: 'Delete session' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Input */}
        <InputArea
          onSend={handleSend}
          isStreaming={isStreaming}
          onStop={stopStreaming}
          sessionId={resolvedSessionId ?? undefined}
          workingFolder={session?.workingFolder ?? projectWorkingFolder}
          onCompressContext={handleCompressContext}
          hideWorkingFolderIndicator
          fullWidth={conversationFullWidth}
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
