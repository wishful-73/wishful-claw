import { Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { clearPendingSessionMessages } from '@renderer/hooks/use-chat-actions'

interface ClearConversationDialogProps {
  show: boolean
  hasMessages: boolean
  isStreaming: boolean
  activeSessionId: string | null
  queuedMessagesCount: number
  onClearSession: (sessionId: string) => void
}

export function ClearConversationDialog({
  show,
  hasMessages,
  isStreaming,
  activeSessionId,
  queuedMessagesCount,
  onClearSession
}: ClearConversationDialogProps) {
  const { t } = useTranslation('chat')

  if (!show || !hasMessages || isStreaming) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="composer-control rounded-lg"
          data-tone="danger"
          aria-label={t('sidebar.clearSession', { ns: 'layout', defaultValue: 'Clear session' })}
          title={t('sidebar.clearSession', { ns: 'layout', defaultValue: 'Clear session' })}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('input.clearConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {queuedMessagesCount > 0
              ? t('input.clearConfirmDescWithQueue', {
                  defaultValue:
                    'This will delete all messages in this conversation and clear {{count}} pending messages in the current session. This action cannot be undone.',
                  count: queuedMessagesCount
                })
              : t('input.clearConfirmDesc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">
            {t('action.cancel', { ns: 'common' })}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            onClick={() => {
              if (!activeSessionId) return
              onClearSession(activeSessionId)
              clearPendingSessionMessages(activeSessionId)
            }}
          >
            {t('action.clear', { ns: 'common' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
