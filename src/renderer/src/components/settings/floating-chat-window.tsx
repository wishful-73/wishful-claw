import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, MessageSquare, Sparkles } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { MessageList } from '@renderer/components/chat/MessageList'
import { InputArea } from '@renderer/components/chat/InputArea'
import { useChatStore } from '@renderer/stores/chat-store'
import { useChatActions } from '@renderer/hooks/use-chat-actions'
import { useUIStore } from '@renderer/stores/ui-store'
import type { EditableUserMessageDraft } from '@renderer/lib/image-attachments'

interface FloatingChatWindowProps {
  sessionId: string | null
  ensureSession: () => string
  onClose: () => void
  onInstalled?: () => void
}

/**
 * Floating chat panel that docks to the right side of the Skill settings page.
 * Height matches the panel area; width is fixed but resizable via drag handle.
 * Session is created lazily on first message send.
 */
export function FloatingChatWindow({
  sessionId,
  ensureSession,
  onClose,
  onInstalled
}: FloatingChatWindowProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { sendMessage } = useChatActions()

  const [width, setWidth] = useState(420)
  const resizeRef = useState<{ startX: number; origW: number } | null>(null)

  const isStreaming = useChatStore((s) =>
    sessionId ? Boolean(s.streamingMessages[sessionId]) : false
  )

  // Resize via left-edge drag
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    resizeRef[1]({ startX: e.clientX, origW: width })
  }, [width, resizeRef])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (resizeRef[0]) {
        const dw = resizeRef[0].startX - e.clientX
        setWidth(Math.max(320, Math.min(640, resizeRef[0].origW + dw)))
      }
    }
    const onMouseUp = () => resizeRef[1](null)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [resizeRef])

  const handleSend = useCallback(
    async (text: string, images?: unknown[], options?: unknown) => {
      // Lazily create the session on first message
      const sid = sessionId ?? ensureSession()
      void sendMessage({ text, images, sessionId: sid, opts: { ...(options as any) } })
      onInstalled?.()
    },
    [sendMessage, sessionId, ensureSession, onInstalled]
  )

  const handleStop = useCallback(() => {
    useChatStore.getState().cancelStream()
  }, [])

  // S-139：编辑用户消息只把内容回填到底部输入框，不动历史消息。
  const handleEditUserMessage = useCallback(
    (_messageId: string, draft: EditableUserMessageDraft): void => {
      const ui = useUIStore.getState()
      ui.setPendingInsertText(draft.text)
      ui.setPendingInsertImages(draft.images.length > 0 ? draft.images : null)
    },
    []
  )

  useEffect(() => {
    if (sessionId) {
      void useChatStore.getState().loadRecentSessionMessages(sessionId)
    }
  }, [sessionId])

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-xl"
      style={{ width }}
    >
      {/* Resize handle on left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/20 transition-colors"
        onMouseDown={onResizeStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2 shrink-0">
        <MessageSquare className="size-3.5 text-primary" />
        <span className="text-xs font-medium flex-1 truncate">{t('skills.installer.title')}</span>
        {isStreaming && (
          <span className="size-2 rounded-full bg-green-500 animate-pulse" />
        )}
        <Button variant="ghost" size="icon-sm" className="size-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Message list or empty state */}
      <div className="flex-1 min-h-0">
        {sessionId ? (
          <MessageList
            sessionId={sessionId}
            fullWidth
            onEditUserMessage={handleEditUserMessage}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Sparkles className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground max-w-[280px]">
              {t('skills.installer.emptyHint2')}
            </p>
          </div>
        )}
      </div>

      {/* Input area — always available, creates session on first send */}
      <div className="shrink-0 border-t">
        <InputArea
          sessionId={sessionId ?? 'floating-pending'}
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          hideWorkingFolderPicker
          hideWorkingFolderIndicator
          hideGoalSessionBar
          hideModeSwitch
          draftKeyOverride="floating-pending"
          fullWidth
        />
      </div>
    </div>
  )
}
