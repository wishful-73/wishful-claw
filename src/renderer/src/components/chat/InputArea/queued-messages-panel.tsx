import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { queuedMessageFullText } from './utils'
import type { PendingSessionMessageItem } from '@renderer/hooks/use-chat-actions'

interface QueuedMessagesPanelProps {
  queuedMessages: PendingSessionMessageItem[]
  composerWidthClass: string
  animationsEnabled: boolean

  // Actions
  takeBackQueuedMessage: (messageId: string) => void
  removePendingSessionMessage: (id: string) => void
  isQueueDispatchPaused: boolean
  resumeQueuedMessages: () => void
  handleClearQueuedMessages: () => void

  // Clear confirm dialog
  queueClearConfirmOpen: boolean
  setQueueClearConfirmOpen: (open: boolean) => void
  clearQueuedMessagesForActiveSession: () => void

  // S-33/S-57: 把指定那条直接塞进当前正在跑的那一轮（不打断正在执行的工具，
  // AgentLoop 下一次 iteration 起点读到它）。插入动作挂在每条自己身上。
  canInsertNow: boolean
  handleInsertNow: (messageId: string) => void

  // Helpers
  summarizeQueuedMessage: (text: string) => string
}

export function QueuedMessagesPanel({
  queuedMessages,
  composerWidthClass,
  animationsEnabled,
  takeBackQueuedMessage,
  removePendingSessionMessage,
  isQueueDispatchPaused,
  resumeQueuedMessages,
  handleClearQueuedMessages,
  queueClearConfirmOpen,
  setQueueClearConfirmOpen,
  clearQueuedMessagesForActiveSession,
  canInsertNow,
  handleInsertNow,
  summarizeQueuedMessage
}: QueuedMessagesPanelProps) {
  const { t } = useTranslation('chat')
  // S-57：默认展开（看到内容才是这块面板的意义），收起状态不跨会话/不持久化。
  const [collapsed, setCollapsed] = React.useState(false)

  if (queuedMessages.length === 0) return null

  return (
    <>
      <div
        className={cn(
          composerWidthClass,
          'mb-2 overflow-hidden rounded-lg border border-border/50 bg-muted/20 shadow-sm backdrop-blur'
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/35 px-3 py-2">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground/85">
                {t('input.queueTitle', { defaultValue: 'Queued messages' })} ({queuedMessages.length})
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {isQueueDispatchPaused
                  ? t('input.queuePausedHint', { defaultValue: 'Paused — click to resume' })
                  : t('input.queueRunningHint', { defaultValue: 'Sent in order after the current turn completes' })}
              </p>
            </div>
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                collapsed && '-rotate-90'
              )}
            />
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {isQueueDispatchPaused && (
              <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-[10px]" onClick={resumeQueuedMessages}>
                {t('input.queueResume', { defaultValue: 'Resume' })}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-muted-foreground" onClick={handleClearQueuedMessages}>
              {t('action.clear', { ns: 'common' })}
            </Button>
          </div>
        </div>
        {!collapsed && (
        <div className="max-h-40 overflow-y-auto py-1">
          <AnimatePresence initial={false}>
            {queuedMessages.map((msg, index) => {
              const summaryText = summarizeQueuedMessage(msg.text)
              const commandLabel = msg.command ? `/${msg.command.name}` : ''
              const fallbackText =
                summaryText ||
                commandLabel ||
                t('input.queueImageOnly', { defaultValue: '[Images only]' })
              // S-57：行内是折叠摘要，全文只在悬停提示里给，保证长消息也看得到原文。
              const fullText = queuedMessageFullText(msg.text)

              return (
                <motion.div
                  key={msg.id}
                  layout={animationsEnabled}
                  initial={animationsEnabled ? { opacity: 0, y: 4 } : false}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={
                    animationsEnabled
                      ? { opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0 }
                      : undefined
                  }
                  transition={
                    animationsEnabled ? { duration: 0.18, ease: 'easeOut' } : { duration: 0 }
                  }
                  className="flex min-h-8 items-center gap-2 border-b border-border/35 px-3 py-1 last:border-b-0"
                >
                  <span className="min-w-4 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span
                    className="min-w-0 flex-1 line-clamp-2 break-words text-xs text-foreground/80"
                    title={fullText || fallbackText}
                  >
                    {fallbackText}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {canInsertNow && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        onClick={() => handleInsertNow(msg.id)}
                        title={t('input.queueInsertNowHint', {
                          defaultValue: '让 Agent 下一轮就读到这条，不等当前轮跑完'
                        })}
                      >
                        {t('input.queueInsertNow', { defaultValue: '立即插入' })}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      onClick={() => takeBackQueuedMessage(msg.id)}
                      title={t('input.queueTakeBackHint', {
                        defaultValue: '从队列移除并把内容放回输入框，改完再发'
                      })}
                    >
                      {t('input.queueTakeBack', { defaultValue: '取回' })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removePendingSessionMessage(msg.id)}
                    >
                      {t('action.delete', { ns: 'common' })}
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
        )}
      </div>

      <AlertDialog open={queueClearConfirmOpen} onOpenChange={setQueueClearConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('input.queueClearConfirmTitle', {
                defaultValue: 'Clear queued messages?'
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('input.queueClearConfirmDesc', {
                defaultValue:
                  'This will delete {{count}} pending messages in the current session.',
                count: queuedMessages.length
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">
              {t('action.cancel', { ns: 'common' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={clearQueuedMessagesForActiveSession}
            >
              {t('action.clear', { ns: 'common' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
