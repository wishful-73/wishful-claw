/**
 * Global task create/edit dialog. Fields: title, description, priority, tags
 * (comma separated) and due date. Saving goes through db/global-tasks-create
 * or db/global-tasks-update via the Task Board store.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
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
import {
  GLOBAL_TASK_PRIORITIES,
  parseTags,
  type GlobalTaskPriority,
  type GlobalTaskRow
} from './task-board-types'
import { useTaskBoardStore } from '@renderer/stores/task-board-store'

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set the dialog edits this task; otherwise it creates a new one. */
  editingTask: GlobalTaskRow | null
  onSaved: () => void
}

/** Format a timestamp in local time for <input type="datetime-local"> (no UTC shift). */
function formatLocalDateTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TaskFormDialog({
  open,
  onOpenChange,
  editingTask,
  onSaved
}: TaskFormDialogProps): React.JSX.Element {
  const { t } = useTranslation('taskboard')
  const createTask = useTaskBoardStore((s) => s.createTask)
  const updateTask = useTaskBoardStore((s) => s.updateTask)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<GlobalTaskPriority>('normal')
  const [tagsText, setTagsText] = useState('')
  const [dueAtText, setDueAtText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(editingTask?.title ?? '')
    setDescription(editingTask?.description ?? '')
    setPriority(editingTask?.priority ?? 'normal')
    setTagsText(editingTask ? parseTags(editingTask.tags).join(', ') : '')
    setDueAtText(editingTask?.due_at ? formatLocalDateTime(editingTask.due_at) : '')
    setSaving(false)
  }, [open, editingTask])

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error(t('dialog.titleRequired'))
      return
    }
    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
    const dueAt = dueAtText ? new Date(dueAtText).getTime() : null

    setSaving(true)
    try {
      if (editingTask) {
        const ok = await updateTask(editingTask.id, {
          title: trimmedTitle,
          description: description.trim(),
          priority,
          tags,
          dueAt
        })
        if (ok) {
          toast.success(t('dialog.saved'))
          onOpenChange(false)
          onSaved()
        } else {
          toast.error(t('dialog.saveFailed'))
        }
      } else {
        const taskId = await createTask({
          title: trimmedTitle,
          description: description.trim(),
          priority,
          tags,
          dueAt
        })
        if (taskId) {
          toast.success(t('dialog.created'))
          onOpenChange(false)
          onSaved()
        } else {
          toast.error(t('dialog.saveFailed'))
        }
      }
    } finally {
      setSaving(false)
    }
  }, [title, description, priority, tagsText, dueAtText, editingTask, createTask, updateTask, t, onOpenChange, onSaved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingTask ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('field.title')}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('field.titlePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('field.description')}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('field.descriptionPlaceholder')}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">{t('field.priority')}</label>
              <Select value={priority} onValueChange={(value) => setPriority(value as GlobalTaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GLOBAL_TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">{t('field.dueAt')}</label>
              <Input
                type="datetime-local"
                value={dueAtText}
                onChange={(e) => setDueAtText(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">{t('field.tags')}</label>
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder={t('field.tagsPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
