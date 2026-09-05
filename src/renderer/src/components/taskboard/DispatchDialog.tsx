/**
 * Dispatch dialog — send a message or a tracked work request from a global
 * task to an existing project session. The target session list comes from the
 * chat store (project sessions only); delivery reuses the normal sendMessage
 * pipeline through the Task Board store.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
import { useChatStore } from '@renderer/stores/chat-store'
import { useTaskBoardStore } from '@renderer/stores/task-board-store'
import type { GlobalDispatchKind } from './task-board-types'

interface DispatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  /** Preselects the target session (follow-up from an existing dispatch). */
  initialSessionId?: string | null
  initialKind?: GlobalDispatchKind
  onSent: () => void
}

export function DispatchDialog({
  open,
  onOpenChange,
  taskId,
  initialSessionId,
  initialKind,
  onSent
}: DispatchDialogProps): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  const projects = useChatStore((s) => s.projects)
  const sessions = useChatStore((s) => s.sessions)
  const dispatchToSession = useTaskBoardStore((s) => s.dispatchToSession)

  const [sessionId, setSessionId] = useState('')
  const [kind, setKind] = useState<GlobalDispatchKind>('work_request')
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)

  // Project sessions only — the global agent coordinates project work.
  const projectSessions = useMemo(
    () => sessions.filter((s) => s.projectId),
    [sessions]
  )

  useEffect(() => {
    if (!open) return
    setSessionId(initialSessionId ?? '')
    setKind(initialKind ?? 'work_request')
    setInstruction('')
    setSending(false)
  }, [open, initialSessionId, initialKind])

  const handleSend = useCallback(async () => {
    const trimmed = instruction.trim()
    if (!sessionId) {
      toast.error(t('dispatch.sessionRequired'))
      return
    }
    if (!trimmed) {
      toast.error(t('dispatch.instructionRequired'))
      return
    }
    const target = projectSessions.find((s) => s.id === sessionId)
    if (!target) {
      toast.error(t('dispatch.sessionNotFound'))
      return
    }

    setSending(true)
    try {
      const result = await dispatchToSession({
        taskId,
        sessionId,
        projectId: target.projectId ?? null,
        workingFolder: target.workingFolder ?? null,
        kind,
        instruction: trimmed
      })
      if (result.ok) {
        toast.success(t('dispatch.sent'))
        onOpenChange(false)
        onSent()
      } else {
        toast.error(result.error ?? t('dispatch.sendFailed'))
        onSent()
      }
    } finally {
      setSending(false)
    }
  }, [instruction, sessionId, kind, taskId, projectSessions, dispatchToSession, t, onOpenChange, onSent])

  const projectName = useCallback(
    (projectId?: string): string => {
      const project = projects.find((p) => p.id === projectId)
      return project?.name ?? t('dispatch.unknownProject')
    },
    [projects, t]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dispatch.title')}</DialogTitle>
          <DialogDescription>{t('dispatch.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('dispatch.targetSession')}</label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger>
                <SelectValue placeholder={t('dispatch.selectSession')} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {projectSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {projectName(session.projectId)} / {session.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projectSessions.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('dispatch.noSessions')}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('dispatch.kindLabel')}</label>
            <SegmentedControl<GlobalDispatchKind>
              ariaLabel={t('dispatch.kindLabel')}
              options={[
                { value: 'work_request', label: t('kind.work_request') },
                { value: 'message', label: t('kind.message') }
              ]}
              value={kind}
              onValueChange={setKind}
            />
            <p className="text-xs text-muted-foreground">
              {kind === 'work_request' ? t('dispatch.kindWorkRequestHint') : t('dispatch.kindMessageHint')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('dispatch.instruction')}</label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t('dispatch.instructionPlaceholder')}
              rows={5}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void handleSend()} disabled={sending}>
            {sending && <Loader2 className="size-4 animate-spin" />}
            {t('dispatch.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
