import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCompare, Maximize2, Minimize2, FolderOpen, MoreHorizontal, RotateCcw, Pencil, Eraser, SquareTerminal } from 'lucide-react'
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
// S-207：沙箱临时关闭的倒计时 chip —— 挂在消息区左上角，无豁免时不渲染。
import { SandboxElevationChip } from '@renderer/components/chat/InputArea/sandbox-elevation-chip'
import { RenderDensityToggle } from '@renderer/components/chat/MessageList/RenderDensityToggle'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChatActions, compressSessionContext, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { BottomTerminalDock } from '@renderer/components/terminal/BottomTerminalDock'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import type { EditableUserMessageDraft } from '@renderer/lib/image-attachments'

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
  const resetSessionUsageStats = useChatStore((s) => s.resetSessionUsageStats)
  const clearSessionMessages = useChatStore((s) => s.clearSessionMessages)
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
      void sendMessage({
        text,
        images: Array.isArray(_images) ? _images : undefined,
        sessionId: resolvedSessionId,
        opts: _options as SendMessageOptions | undefined
      })
    },
    [resolvedSessionId, sendMessage]
  )

  // S-193：浮窗「更多」里的「删除会话」换成了「重置用量统计」——删会话是破坏性操作，
  // 却挂在会话自身的浮窗上，误触代价太大；这里改成只把底部 token 统计归零。
  const handleResetUsageStats = useCallback(async () => {
    if (!resolvedSessionId) return
    const ok = await confirm({
      title: t('sidebar.resetUsageStatsConfirmTitle', {
        defaultValue: 'Reset token usage for this session?'
      }),
      description: t('sidebar.resetUsageStatsConfirmDesc', {
        defaultValue:
          'The counters under the composer go back to zero. Messages and their per-message token usage stay untouched.'
      }),
      variant: 'destructive'
    })
    if (!ok) return
    await resetSessionUsageStats(resolvedSessionId)
  }, [resolvedSessionId, resetSessionUsageStats, t])

  // S-204：浮窗「更多」补「清空会话」入口 —— 与左侧会话右键的「清空消息」同名同义，
  // 都走 store 的 clearSessionMessages（落库删消息，切走切回不再复活）。删消息不可逆，带二次确认。
  const handleClearSession = useCallback(async () => {
    if (!resolvedSessionId) return
    const ok = await confirm({
      title: t('sidebar.clearSessionConfirmTitle', {
        defaultValue: "Clear this session's messages?"
      }),
      description: t('sidebar.clearSessionConfirmDesc', {
        title: session?.title ?? '',
        defaultValue: 'Every message will be permanently deleted. This cannot be undone.'
      }),
      variant: 'destructive'
    })
    if (!ok) return
    clearSessionMessages(resolvedSessionId)
  }, [resolvedSessionId, session, clearSessionMessages, t])

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

  // Open the right panel on the Context & Progress tab. The existing summary
  // tab kind is retained so persisted panel state remains compatible.
  const handleOpenSummaryPanel = useCallback((): void => {
    if (!resolvedSessionId) return
    useUIStore.getState().ensureSummaryTab(resolvedSessionId)
  }, [resolvedSessionId])

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

  // S-139：编辑用户消息只把内容回填到底部输入框，不动历史消息。
  const handleEditUserMessage = useCallback(
    (_messageId: string, draft: EditableUserMessageDraft): void => {
      const ui = useUIStore.getState()
      ui.setPendingInsertText(draft.text)
      ui.setPendingInsertImages(draft.images.length > 0 ? draft.images : null)
    },
    []
  )

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
          <MessageList
            fullWidth={conversationFullWidth}
            onEditUserMessage={handleEditUserMessage}
          />

          {/* Sandbox elevation chip — top-left, mirroring the action block on the right.
              放在这里而不是输入框上方：输入框那一列已经排了 API Key 提醒 / 排队面板 /
              goal 条 / todo 条，再加一条就把 composer 顶上塞满了。 */}
          <SandboxElevationChip className="absolute left-3 top-3 z-30" />

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

            {/* View context and progress in the right panel */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleOpenSummaryPanel}
                  aria-label={t('layout.viewContextProgress', {
                    defaultValue: 'View context & progress'
                  })}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <GitCompare className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {t('layout.viewContextProgress', { defaultValue: 'View context & progress' })}
              </TooltipContent>
            </Tooltip>

            {/* Chat column width toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleChatWidth}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                >
                  {conversationFullWidth ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {conversationFullWidth
                  ? t('layout.standardChatWidth', { defaultValue: 'Restore standard width' })
                  : t('layout.widenChat', { defaultValue: 'Widen chat area' })}
              </TooltipContent>
            </Tooltip>

            {/* 渲染详细度快捷入口（S-225）—— 并进本块而不是另挂浮层：
                单独 absolute 定位会被本块的 z-30 盖住，见 RenderDensityToggle 文件头。 */}
            <RenderDensityToggle />

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
                <DropdownMenuItem onClick={handleResetUsageStats} className="text-destructive">
                  <RotateCcw className="mr-2 size-4" />
                  {t('sidebar.resetUsageStats', { defaultValue: 'Reset token usage' })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClearSession} className="text-destructive">
                  <Eraser className="mr-2 size-4" />
                  {t('sidebar.clearSession', { defaultValue: 'Clear messages' })}
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

        {/* Bottom terminal dock - keep mounted, hide via CSS to preserve state.
            Global conversations (no project) still get a dock: the terminal
            falls back to the user home directory as cwd. */}
        {resolvedSessionId && (
          <div className={bottomTerminalDockOpen ? "shrink-0 border-t" : "hidden"}>
            <BottomTerminalDock
              projectId={projectId ?? ''}
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
