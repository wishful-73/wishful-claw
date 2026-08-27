import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Switch } from '@renderer/components/ui/switch'
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
import { useProviderStore } from '@renderer/stores/provider-store'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import type { CronJobView } from './cron-job-view'

export interface CronJobFormValues {
  name: string
  kind: 'at' | 'every' | 'cron'
  at: string
  everyMinutes: number
  expr: string
  tz: string
  prompt: string
  agentId: string
  model: string
  workingFolder: string
  maxIterations: number
  deleteAfterRun: boolean
  deliveryMode: 'desktop' | 'session' | 'plugin' | 'none'
  deliveryTarget: string
  pluginId: string
  pluginType: string
  pluginChatId: string
}

interface CronJobResponse {
  error?: string
}

const EMPTY_FORM: CronJobFormValues = {
  name: '',
  kind: 'every',
  at: '',
  everyMinutes: 30,
  expr: '0 9 * * *',
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  prompt: '',
  agentId: '',
  model: '',
  workingFolder: '',
  maxIterations: 15,
  deleteAfterRun: false,
  deliveryMode: 'desktop',
  deliveryTarget: '',
  pluginId: '',
  pluginType: '',
  pluginChatId: ''
}

function jobToForm(job: CronJobView): CronJobFormValues {
  const schedule = job.schedule ?? {}
  return {
    name: job.name,
    kind: schedule.kind ?? 'every',
    at:
      typeof schedule.at === 'number'
        ? new Date(schedule.at - Date.now() + Date.now()).toISOString()
        : String(schedule.at ?? ''),
    everyMinutes: Math.max(1, Math.round((schedule.every ?? 1_800_000) / 60_000)),
    expr: schedule.expr ?? '0 9 * * *',
    tz: schedule.tz ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    prompt: job.prompt,
    agentId: job.agentId ?? '',
    model: job.model ?? '',
    workingFolder: job.workingFolder ?? '',
    maxIterations: job.maxIterations || 15,
    deleteAfterRun: Boolean(job.deleteAfterRun),
    deliveryMode:
      job.pluginId ? 'plugin' : ((job.deliveryMode as CronJobFormValues['deliveryMode']) ?? 'desktop'),
    deliveryTarget: job.deliveryTarget ?? '',
    pluginId: job.pluginId ?? '',
    pluginType: job.pluginType ?? '',
    pluginChatId: job.pluginChatId ?? ''
  }
}

function buildSchedule(
  values: CronJobFormValues
): { error?: string; schedule?: Record<string, unknown> } {
  if (values.kind === 'at') {
    if (!values.at.trim()) return { error: 'at' }
    return { schedule: { kind: 'at', at: values.at.trim() } }
  }
  if (values.kind === 'every') {
    const every = Math.round(values.everyMinutes * 60_000)
    if (!Number.isFinite(every) || every < 60_000) return { error: 'every' }
    return { schedule: { kind: 'every', every } }
  }
  if (!values.expr.trim()) return { error: 'expr' }
  return { schedule: { kind: 'cron', expr: values.expr.trim(), tz: values.tz || undefined } }
}

interface CronJobFormDialogProps {
  open: boolean
  editingJob: CronJobView | null
  onClose: () => void
  onSaved: () => void
}

export function CronJobFormDialog({
  open,
  editingJob,
  onClose,
  onSaved
}: CronJobFormDialogProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const providers = useProviderStore((s) => s.providers)
  const [values, setValues] = useState<CronJobFormValues>(EMPTY_FORM)
  const [errors, setErrors] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(editingJob ? jobToForm(editingJob) : EMPTY_FORM)
      setErrors(new Set())
    }
  }, [open, editingJob])

  const modelOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    for (const provider of providers.filter((p) => p.enabled)) {
      for (const model of provider.models.filter((m) => m.enabled)) {
        options.push({ value: model.id, label: `${provider.name} · ${model.id}` })
      }
    }
    return options
  }, [providers])

  const patch = (partial: Partial<CronJobFormValues>): void => {
    setValues((prev) => ({ ...prev, ...partial }))
  }

  const validate = (): boolean => {
    const next = new Set<string>()
    if (!values.name.trim()) next.add('name')
    if (!values.prompt.trim()) next.add('prompt')
    const schedErr = buildSchedule(values).error
    if (schedErr) next.add(schedErr)
    if (values.deliveryMode === 'session' && !values.deliveryTarget.trim()) next.add('deliveryTarget')
    if (values.deliveryMode === 'plugin') {
      if (!values.pluginId.trim()) next.add('pluginId')
      if (!values.pluginChatId.trim()) next.add('pluginChatId')
    }
    setErrors(next)
    return next.size === 0
  }

  const save = async (): Promise<void> => {
    if (!validate()) return
    const scheduleResult = buildSchedule(values)
    if (!scheduleResult.schedule) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        schedule: scheduleResult.schedule,
        prompt: values.prompt.trim(),
        deliveryMode: values.deliveryMode,
        deleteAfterRun: values.deleteAfterRun,
        maxIterations: values.maxIterations > 0 ? values.maxIterations : 15
      }
      if (values.agentId.trim()) payload.agentId = values.agentId.trim()
      if (values.model.trim()) payload.model = values.model.trim()
      if (values.workingFolder.trim()) payload.workingFolder = values.workingFolder.trim()
      if (values.deliveryMode === 'session') payload.deliveryTarget = values.deliveryTarget.trim()
      if (values.deliveryMode === 'plugin') {
        payload.pluginId = values.pluginId.trim()
        payload.pluginType = values.pluginType.trim() || values.pluginId.trim()
        payload.pluginChatId = values.pluginChatId.trim()
      }

      const method = editingJob ? 'cron:update' : 'cron:add'
      const params = editingJob ? { jobId: editingJob.id, patch: payload } : payload
      const result = (await ipcClient.invoke(method, params)) as CronJobResponse
      if (result && typeof result === 'object' && result.error) {
        throw new Error(result.error)
      }
      toast.success(t(editingJob ? 'automation.updated' : 'automation.created'))
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (key: string): string | undefined =>
    errors.has(key) ? t('automation.form.required') : undefined

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(editingJob ? 'automation.form.editTitle' : 'automation.form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('automation.form.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('automation.form.name')}</span>
            <Input
              value={values.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('automation.form.namePlaceholder')}
            />
            {fieldError('name') && (
              <span className="text-xs text-destructive">{fieldError('name')}</span>
            )}
          </label>

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('automation.form.schedule')}</span>
            <Select
              value={values.kind}
              onValueChange={(kind) => {
                const nextKind = kind as CronJobFormValues['kind']
                patch({
                  kind: nextKind,
                  deleteAfterRun: nextKind === 'at' ? true : values.deleteAfterRun
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="at">{t('automation.form.kindAt')}</SelectItem>
                <SelectItem value="every">{t('automation.form.kindEvery')}</SelectItem>
                <SelectItem value="cron">{t('automation.form.kindCron')}</SelectItem>
              </SelectContent>
            </Select>

            {values.kind === 'at' && (
              <div className="flex flex-col gap-1.5">
                <Input
                  type="datetime-local"
                  value={values.at.startsWith('+') ? '' : values.at.slice(0, 16)}
                  onChange={(e) => patch({ at: e.target.value })}
                />
                {fieldError('at') && (
                  <span className="text-xs text-destructive">{fieldError('at')}</span>
                )}
              </div>
            )}

            {values.kind === 'every' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-28"
                  value={values.everyMinutes}
                  onChange={(e) => patch({ everyMinutes: Number(e.target.value) })}
                />
                <span className="text-sm text-muted-foreground">
                  {t('automation.form.minutes')}
                </span>
                {fieldError('every') && (
                  <span className="text-xs text-destructive">{fieldError('every')}</span>
                )}
              </div>
            )}

            {values.kind === 'cron' && (
              <>
                <Input
                  value={values.expr}
                  onChange={(e) => patch({ expr: e.target.value })}
                  placeholder="0 9 * * *"
                />
                {fieldError('expr') && (
                  <span className="text-xs text-destructive">{fieldError('expr')}</span>
                )}
                <Input
                  value={values.tz}
                  onChange={(e) => patch({ tz: e.target.value })}
                  placeholder="Asia/Shanghai"
                />
              </>
            )}
          </div>

          {/* Prompt */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('automation.form.prompt')}</span>
            <Textarea
              rows={4}
              value={values.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={t('automation.form.promptPlaceholder')}
            />
            {fieldError('prompt') && (
              <span className="text-xs text-destructive">{fieldError('prompt')}</span>
            )}
          </label>

          {/* Agent */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('automation.form.agentId')}</span>
            <Input
              value={values.agentId}
              onChange={(e) => patch({ agentId: e.target.value })}
              placeholder={t('automation.form.agentIdPlaceholder')}
            />
          </label>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('automation.form.model')}</span>
            <Select
              value={values.model || '__default__'}
              onValueChange={(model) => patch({ model: model === '__default__' ? '' : model })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{t('automation.form.defaultModel')}</SelectItem>
                {modelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Working folder */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('automation.form.workingFolder')}</span>
            <Input
              value={values.workingFolder}
              onChange={(e) => patch({ workingFolder: e.target.value })}
              placeholder={t('automation.form.workingFolderPlaceholder')}
            />
          </label>

          {/* Max iterations + delete after run */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2">
              <span className="text-sm font-medium">{t('automation.maxIterations')}</span>
              <Input
                type="number"
                min={1}
                className="w-20"
                value={values.maxIterations}
                onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={values.deleteAfterRun}
                onCheckedChange={(deleteAfterRun) => patch({ deleteAfterRun })}
              />
              <span className="text-sm">{t('automation.form.deleteAfterRun')}</span>
            </label>
          </div>

          {/* Delivery */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('automation.delivery')}</span>
            <Select
              value={values.deliveryMode}
              onValueChange={(mode) =>
                patch({ deliveryMode: mode as CronJobFormValues['deliveryMode'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desktop">{t('automation.form.deliveryDesktop')}</SelectItem>
                <SelectItem value="session">{t('automation.form.deliverySession')}</SelectItem>
                <SelectItem value="plugin">{t('automation.form.deliveryPlugin')}</SelectItem>
                <SelectItem value="none">{t('automation.form.deliveryNone')}</SelectItem>
              </SelectContent>
            </Select>

            {values.deliveryMode === 'session' && (
              <div className="flex flex-col gap-1.5">
                <Input
                  value={values.deliveryTarget}
                  onChange={(e) => patch({ deliveryTarget: e.target.value })}
                  placeholder={t('automation.form.sessionIdPlaceholder')}
                />
                {fieldError('deliveryTarget') && (
                  <span className="text-xs text-destructive">{fieldError('deliveryTarget')}</span>
                )}
              </div>
            )}

            {values.deliveryMode === 'plugin' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Input
                    value={values.pluginId}
                    onChange={(e) => patch({ pluginId: e.target.value })}
                    placeholder={t('automation.form.pluginIdPlaceholder')}
                  />
                  {fieldError('pluginId') && (
                    <span className="text-xs text-destructive">{fieldError('pluginId')}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Input
                    value={values.pluginChatId}
                    onChange={(e) => patch({ pluginChatId: e.target.value })}
                    placeholder={t('automation.form.chatIdPlaceholder')}
                  />
                  {fieldError('pluginChatId') && (
                    <span className="text-xs text-destructive">{fieldError('pluginChatId')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('automation.form.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            {t('automation.form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
