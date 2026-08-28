import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import type { PendingSessionMessageItem } from '@renderer/hooks/use-chat-actions'

interface QueuedMessagesPanelProps {
  queuedMessages: PendingSessionMessageItem[]
  composerWidthClass: string
  animationsEnabled: boolean

  // Editing state
  editingQueueItemId: string | null
  editingQueueText: string
  editingQueueImages: ImageAttachment[]
  setEditingQueueText: (v: string) => void
  setEditingQueueImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPreviewImage: (img: ImageAttachment | null) => void

  // Actions
  saveQueuedMessage: (id: string) => void
  cancelEditQueuedMessage: () => void
  removeQueuedImage: (id: string) => void
  handleQueueEditPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  editQueuedMessage: (msg: PendingSessionMessageItem) => void
  removePendingSessionMessage: (id: string) => void
  isQueueDispatchPaused: boolean
  resumeQueuedMessages: () => void
  handleClearQueuedMessages: () => void

  // Clear confirm dialog
  queueClearConfirmOpen: boolean
  setQueueClearConfirmOpen: (open: boolean) => void
  clearQueuedMessagesForActiveSession: () => void

  // Helpers
  summarizeQueuedMessage: (text: string) => string
}

export function QueuedMessagesPanel({
  queuedMessages,
  composerWidthClass,
  animationsEnabled,
  editingQueueItemId,
  editingQueueText,
  editingQueueImages,
  setEditingQueueText,
  setEditingQueueImages,
  setPreviewImage,
  saveQueuedMessage,
  cancelEditQueuedMessage,
  removeQueuedImage,
  handleQueueEditPaste,
  editQueuedMessage,
  removePendingSessionMessage,
  isQueueDispatchPaused,
  resumeQueuedMessages,
  handleClearQueuedMessages,
  queueClearConfirmOpen,
  setQueueClearConfirmOpen,
  clearQueuedMessagesForActiveSession,
  summarizeQueuedMessage
}: QueuedMessagesPanelProps) {
  const { t } = useTranslation('chat')

  if (queuedMessages.length === 0) return null

  return (
    <>
      <div
        className={cn(
          composerWidthClass,
          'mb-2 overflow-hidden rounded-lg border border-border/50 bg-muted/20 shadow-sm backdrop-blur'
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/35 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground/85">
              {t('input.queueTitle', { defaultValue: 'Queued messages' })} ({queuedMessages.length})
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {isQueueDispatchPaused
                ? t('input.queuePausedHint', { defaultValue: 'Paused — click to resume' })
                : t('input.queueRunningHint', { defaultValue: 'Sent in order after the current turn completes' })}
            </p>
          </div>
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
        <div className="max-h-40 overflow-y-auto py-1">
          <AnimatePresence initial={false}>
            {queuedMessages.map((msg, index) => {
              const isEditing = editingQueueItemId === msg.id
              const summaryText = summarizeQueuedMessage(msg.text)
              const commandLabel = msg.command ? `/${msg.command.name}` : ''
              const fallbackText =
                summaryText ||
                commandLabel ||
                t('input.queueImageOnly', { defaultValue: '[Images only]' })

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
                  className={cn(
                    'overflow-hidden border-b border-border/35 last:border-b-0',
                    isEditing ? 'px-3 py-2' : 'group flex min-h-8 items-center gap-2 px-3 py-1'
                  )}
                >
                  {isEditing ? (
                    <div className="w-full space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {t('input.queueEditing', { defaultValue: 'Edit queued message' })}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            onClick={() => saveQueuedMessage(msg.id)}
                          >
                            {t('action.save', { ns: 'common' })}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            onClick={cancelEditQueuedMessage}
                          >
                            {t('action.cancel', { ns: 'common' })}
                          </Button>
                        </div>
                      </div>
                      {msg.command && (
                        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                          /{msg.command.name}
                        </div>
                      )}
                      <Textarea
                        value={editingQueueText}
                        onChange={(e) => setEditingQueueText(e.target.value)}
                        onPaste={handleQueueEditPaste}
                        className="composer-aux-textarea min-h-[56px] max-h-36 resize-none text-xs"
                        rows={2}
                      />
                      {editingQueueImages.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {editingQueueImages.map((img) => (
                            <div key={img.id} className="relative group/img shrink-0">
                              <button
                                type="button"
                                className="block cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={t('userMessage.imagePreview')}
                                title={t('userMessage.imagePreview')}
                                onClick={() => setPreviewImage(img)}
                              >
                                <img
                                  src={img.dataUrl}
                                  alt=""
                                  className="composer-image-thumb size-12 rounded-lg object-cover transition-transform group-hover/img:scale-[1.03]"
                                />
                              </button>
                              <button
                                type="button"
                                className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm opacity-0 transition-opacity group-hover/img:opacity-100"
                                aria-label={t('userMessage.removeImage')}
                                title={t('userMessage.removeImage')}
                                onClick={() => removeQueuedImage(img.id)}
                              >
                                <X className="size-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        {editingQueueImages.length > 0 ? (
                          <p className="text-[10px] text-muted-foreground">
                            {t('input.queueImageCount', {
                              defaultValue: '{{count}} images',
                              count: editingQueueImages.length
                            })}
                          </p>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
                          onClick={() => setEditingQueueImages([])}
                        >
                          {t('input.queueRemoveImages', { defaultValue: 'Remove images' })}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="min-w-4 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                        {fallbackText}
                      </span>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={() => editQueuedMessage(msg)}
                        >
                          {t('action.edit', { ns: 'common' })}
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
                    </>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
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
