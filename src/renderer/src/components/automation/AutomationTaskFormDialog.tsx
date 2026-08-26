import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
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
import { OptimizationDialog } from '@renderer/components/chat/InputArea/optimization-dialog'
import { usePromptOptimizer } from '@renderer/components/chat/InputArea/use-prompt-optimizer'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChannelStore, type PluginInstance } from '@renderer/stores/channel-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { AutomationModelSelector } from './AutomationModelSelector'
import type { CronJobView } from './cron-job-view'

type AutomationScope = 'global' | 'project'
type AutomationOutputMode = 'none' | 'new_session' | 'reuse_session' | 'bot'
type AutomationRunMode = 'background' | 'session'
type FrequencyPreset = 'once' | 'interval' | 'daily' | 'weekdays' | 'custom'
type IntervalUnit = 'minutes' | 'hours'

interface AutomationFormValues {
  name: string
  scope: AutomationScope
  projectId: string
  prompt: string
  providerId: string
  modelId: string
  frequency: FrequencyPreset
  at: string
  intervalValue: number
  intervalUnit: IntervalUnit
  timeOfDay: string
  expr: string
  tz: string
  runMode: AutomationRunMode
  outputMode: AutomationOutputMode
  reuseSessionId: string
  channelId: string
}

interface CronJobResponse {
  error?: string
}

interface BotTarget {
  channel: PluginInstance
  chatId: string
}

const EMPTY_FORM: AutomationFormValues = {
  name: '',
  scope: 'global',
  projectId: '',
  prompt: '',
  providerId: '',
  modelId: '',
  frequency: 'interval',
  at: '',
  intervalValue: 30,
  intervalUnit: 'minutes',
  timeOfDay: '09:00',
  expr: '0 9 * * *',
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  runMode: 'background',
  outputMode: 'none',
  reuseSessionId: '',
  channelId: ''
}

function resolveBotChatId(channel: PluginInstance): string {
  const keys = ['chatId', 'chat_id', 'channelId', 'targetId', 'recipientId']
  for (const key of keys) {
    const value = channel.config[key]?.trim()
    if (value) return value
  }
  return ''
}

function parseCronPreset(expr?: string): { frequency: 'daily' | 'weekdays'; timeOfDay: string } | null {
  if (!expr) return null
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|1-5)$/.exec(expr.trim())
  if (!match) return null
  const minute = Number(match[1])
  const hour = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return {
    frequency: match[3] === '1-5' ? 'weekdays' : 'daily',
    timeOfDay: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
}

/** Format a timestamp in local time for <input type="datetime-local"> (no UTC shift). */
function formatLocalDateTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Split a legacy millisecond interval into the value + unit fields. */
function resolveInterval(every: number): { value: number; unit: IntervalUnit } {
  const minutes = Math.max(1, Math.round(every / 60_000))
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' }
  return { value: minutes, unit: 'minutes' }
}

function jobToForm(job: CronJobView, asTemplate = false): AutomationFormValues {
  const schedule = job.schedule ?? { kind: 'every' as const }
  const cronPreset = schedule.kind === 'cron' ? parseCronPreset(schedule.expr) : null
  const interval = resolveInterval(schedule.every ?? 1_800_000)
  return {
    ...EMPTY_FORM,
    name: job.name,
    scope: job.scope,
    projectId: job.projectId ?? '',
    prompt: job.prompt,
    providerId: job.agentId ?? '',
    modelId: job.model ?? '',
    frequency: schedule.kind === 'at'
      ? 'once'
      : schedule.kind === 'every'
        ? 'interval'
        : cronPreset?.frequency ?? 'custom',
    at: asTemplate && schedule.kind === 'at'
      ? ''
      : typeof schedule.at === 'number'
        ? formatLocalDateTime(schedule.at)
        : String(schedule.at ?? ''),
    intervalValue: interval.value,
    intervalUnit: interval.unit,
    timeOfDay: cronPreset?.timeOfDay ?? EMPTY_FORM.timeOfDay,
    expr: schedule.expr ?? '0 9 * * *',
    tz: schedule.tz ?? EMPTY_FORM.tz,
    runMode: job.runMode,
    outputMode: job.outputMode === 'none' || job.deliveryMode === 'none' ? 'none' : job.outputMode,
    reuseSessionId: job.reuseSessionId ?? job.deliveryTarget ?? '',
    channelId: job.pluginId ?? ''
  }
}

function buildSchedule(values: AutomationFormValues): Record<string, unknown> | null {
  if (values.frequency === 'once') {
    return values.at.trim() ? { kind: 'at', at: values.at.trim() } : null
  }
  if (values.frequency === 'interval') {
    const value = Math.round(values.intervalValue)
    if (!Number.isFinite(value) || value < 1) return null
    const every = value * (values.intervalUnit === 'hours' ? 3_600_000 : 60_000)
    // Scheduler requires >= 60s; keep the minimum meaningful step.
    return every >= 60_000 ? { kind: 'every', every } : null
  }
  if (values.frequency === 'daily' || values.frequency === 'weekdays') {
    const [hour, minute] = values.timeOfDay.split(':').map(Number)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    const days = values.frequency === 'weekdays' ? '1-5' : '*'
    return { kind: 'cron', expr: `${minute} ${hour} * * ${days}`, tz: values.tz.trim() || undefined }
  }
  return values.expr.trim()
    ? { kind: 'cron', expr: values.expr.trim(), tz: values.tz.trim() || undefined }
    : null
}

interface AutomationTaskFormDialogProps {
  open: boolean
  editingJob: CronJobView | null
  templateJob: CronJobView | null
  onClose: () => void
  onSaved: () => void
}

export function AutomationTaskFormDialog({
  open,
  editingJob,
  templateJob,
  onClose,
  onSaved
}: AutomationTaskFormDialogProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const language = useSettingsStore((state) => state.language)
  const projects = useChatStore((state) => state.projects)
  const sessions = useChatStore((state) => state.sessions)
  const channels = useChannelStore((state) => state.channels)
  const loadChannels = useChannelStore((state) => state.loadChannels)
  const [values, setValues] = useState<AutomationFormValues>(EMPTY_FORM)
  const [errors, setErrors] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const patch = useCallback((partial: Partial<AutomationFormValues>): void => {
    setValues((previous) => ({ ...previous, ...partial }))
  }, [])

  const setPrompt = useCallback((value: string | ((previous: string) => string)): void => {
    setValues((previous) => ({
      ...previous,
      prompt: typeof value === 'function' ? value(previous.prompt) : value
    }))
  }, [])

  const modelChange = useCallback((providerId: string, modelId: string): void => {
    patch({ providerId, modelId })
  }, [patch])

  const optimizer = usePromptOptimizer({
    text: values.prompt,
    currentLanguage: language,
    setText: setPrompt,
    focusInputAtEnd: () => undefined
  })

  useEffect(() => {
    if (!open) return
    setValues(editingJob
      ? jobToForm(editingJob)
      : templateJob
        ? jobToForm(templateJob, true)
        : { ...EMPTY_FORM })
    setErrors(new Set())
    void loadChannels()
  }, [editingJob, loadChannels, open, templateJob])

  const selectedProject = projects.find((project) => project.id === values.projectId)
  const reusableSessions = useMemo(
    () => sessions
      .filter((session) => values.scope === 'project'
        ? Boolean(values.projectId && session.projectId === values.projectId)
        : !session.projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [sessions, values.projectId, values.scope]
  )
  const botTargets = useMemo<BotTarget[]>(
    () => channels
      .filter((channel) => channel.enabled)
      .map((channel) => ({ channel, chatId: resolveBotChatId(channel) }))
      .filter((target) => Boolean(target.chatId)),
    [channels]
  )
  const selectedBotTarget = botTargets.find((target) => target.channel.id === values.channelId)

  const validate = (): boolean => {
    const next = new Set<string>()
    if (!values.name.trim()) next.add('name')
    if (!values.prompt.trim()) next.add('prompt')
    if (!values.providerId || !values.modelId) next.add('model')
    if (values.scope === 'project' && !values.projectId) next.add('projectId')
    if (!buildSchedule(values)) next.add('schedule')
    if (values.runMode === 'session' && values.outputMode === 'none') next.add('outputMode')
    if (values.outputMode === 'reuse_session' && !values.reuseSessionId) next.add('reuseSessionId')
    if (values.outputMode === 'bot' && !selectedBotTarget) next.add('channelId')
    setErrors(next)
    return next.size === 0
  }

  const save = async (): Promise<void> => {
    if (!validate()) return
    const schedule = buildSchedule(values)
    if (!schedule) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        scope: values.scope,
        projectId: values.scope === 'project' ? values.projectId : null,
        prompt: values.prompt.trim(),
        agentId: values.providerId,
        model: values.modelId,
        schedule,
        runMode: values.outputMode === 'bot' ? 'background' : values.runMode,
        outputMode: values.outputMode === 'none' ? null : values.outputMode,
        reuseSessionId: values.outputMode === 'reuse_session' ? values.reuseSessionId : null,
        workingFolder: values.scope === 'project' ? selectedProject?.workingFolder ?? null : null,
        deliveryMode: values.outputMode === 'bot'
          ? 'plugin'
          : values.outputMode === 'none' ? 'none' : 'session',
        deliveryTarget: values.outputMode === 'reuse_session' ? values.reuseSessionId : null,
        pluginId: values.outputMode === 'bot' ? selectedBotTarget?.channel.id ?? null : null,
        pluginType: values.outputMode === 'bot' ? selectedBotTarget?.channel.type ?? null : null,
        pluginChatId: values.outputMode === 'bot' ? selectedBotTarget?.chatId ?? null : null,
        deleteAfterRun: values.frequency === 'once',
        maxIterations: editingJob?.maxIterations ?? templateJob?.maxIterations ?? 15
      }
      const method = editingJob ? 'cron:update' : 'cron:add'
      const params = editingJob ? { jobId: editingJob.id, patch: payload } : payload
      const result = await ipcClient.invoke(method, params) as CronJobResponse
      if (result?.error) throw new Error(result.error)
      toast.success(t(editingJob ? 'automation.updated' : 'automation.created'))
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const errorText = (key: string): React.JSX.Element | null => errors.has(key)
    ? <span className="text-xs text-destructive">{key === 'outputMode' ? t('automation.form.sessionOutputRequired') : t('automation.form.required')}</span>
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{t(editingJob
              ? 'automation.form.editTitle'
              : templateJob
                ? 'automation.form.createFromArchivedTitle'
                : 'automation.form.createTitle')}</DialogTitle>
            <DialogDescription>{t('automation.form.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <section className="space-y-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('automation.form.name')}</span>
                <Input value={values.name} onChange={(event) => patch({ name: event.target.value })} placeholder={t('automation.form.namePlaceholder')} />
                {errorText('name')}
              </label>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <span className="text-sm font-medium">{t('automation.form.scope')}</span>
                  <SegmentedControl
                    value={values.scope}
                    ariaLabel={t('automation.form.scope')}
                    options={[
                      { value: 'global', label: t('automation.form.scopeGlobal') },
                      { value: 'project', label: t('automation.form.scopeProject') }
                    ]}
                    onValueChange={(scope) => patch({ scope, projectId: '', reuseSessionId: '' })}
                  />
                </div>
                {values.scope === 'project' ? (
                  <label className="min-w-0 space-y-1.5">
                    <span className="text-sm font-medium">{t('automation.form.project')}</span>
                    <Select value={values.projectId} onValueChange={(projectId) => patch({ projectId, reuseSessionId: '' })}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t('automation.form.projectPlaceholder')} /></SelectTrigger>
                      <SelectContent>{projects.filter((project) => !project.pluginId).map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {errorText('projectId')}
                  </label>
                ) : <div aria-hidden="true" />}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('automation.form.prompt')}</span>
                <Button variant="ghost" size="sm" disabled={!values.prompt.trim() || optimizer.isOptimizing} onClick={() => void optimizer.handleOptimizePrompt()}>
                  {optimizer.isOptimizing ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Wand2 className="mr-1 size-3.5" />}
                  {t('automation.form.optimizePrompt')}
                </Button>
              </div>
              <Textarea rows={5} value={values.prompt} onChange={(event) => patch({ prompt: event.target.value })} placeholder={t('automation.form.promptPlaceholder')} />
              {errorText('prompt')}
            </section>

            <section className="space-y-2">
              <AutomationModelSelector providerId={values.providerId} modelId={values.modelId} onChange={modelChange} />
              {errorText('model')}
            </section>

            <section className="space-y-2">
              <span className="text-sm font-medium">{t('automation.form.permission')}</span>
              <div className="flex h-9 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-medium text-amber-700 dark:text-amber-300">
                {t('automation.form.permissionYolo')}
              </div>
              <p className="text-xs text-muted-foreground">{t('automation.form.permissionYoloHint')}</p>
            </section>

            <section className="space-y-2">
              <span className="text-sm font-medium">{t('automation.form.schedule')}</span>
              <SegmentedControl
                value={values.frequency}
                ariaLabel={t('automation.form.schedule')}
                options={(['once', 'interval', 'daily', 'weekdays', 'custom'] as const).map((frequency) => ({
                  value: frequency,
                  label: t(`automation.form.frequency.${frequency}`)
                }))}
                onValueChange={(frequency) => patch({ frequency })}
              />
              {values.frequency === 'once' && <Input type="datetime-local" value={values.at} onChange={(event) => patch({ at: event.target.value })} />}
              {values.frequency === 'interval' && (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <Input
                    type="number"
                    min={1}
                    value={values.intervalValue}
                    onChange={(event) => patch({ intervalValue: Number(event.target.value) })}
                    aria-label={t('automation.form.intervalValue')}
                  />
                  <SegmentedControl
                    value={values.intervalUnit}
                    ariaLabel={t('automation.form.intervalUnit')}
                    options={[
                      { value: 'minutes', label: t('automation.form.intervalMinutes') },
                      { value: 'hours', label: t('automation.form.intervalHours') }
                    ]}
                    onValueChange={(intervalUnit) => patch({ intervalUnit })}
                  />
                </div>
              )}
              {(values.frequency === 'daily' || values.frequency === 'weekdays') && (
                <Input type="time" value={values.timeOfDay} onChange={(event) => patch({ timeOfDay: event.target.value })} />
              )}
              {values.frequency === 'custom' && (
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input value={values.expr} onChange={(event) => patch({ expr: event.target.value })} placeholder="0 9 * * *" />
                  <Input value={values.tz} onChange={(event) => patch({ tz: event.target.value })} placeholder="Asia/Shanghai" />
                </div>
              )}
              {errorText('schedule')}
            </section>

            <section className="space-y-2">
              <span className="text-sm font-medium">{t('automation.form.runMode')}</span>
              <SegmentedControl
                value={values.outputMode === 'bot' ? 'background' : values.runMode}
                ariaLabel={t('automation.form.runMode')}
                options={[
                  { value: 'background', label: t('automation.form.runModeBackground') },
                  { value: 'session', label: t('automation.form.runModeSession') }
                ]}
                onValueChange={(runMode) => patch({
                  runMode,
                  outputMode: runMode === 'session' && values.outputMode === 'none' ? 'new_session' : values.outputMode
                })}
              />
              <p className="text-xs text-muted-foreground">
                {values.outputMode === 'bot'
                  ? t('automation.form.runModeBotHint')
                  : values.runMode === 'session'
                    ? t('automation.form.runModeSessionHint')
                    : t('automation.form.runModeBackgroundHint')}
              </p>
            </section>

            <section className="space-y-2">
              <span className="text-sm font-medium">{t('automation.form.outputTarget')}</span>
              <SegmentedControl<AutomationOutputMode>
                value={values.outputMode}
                ariaLabel={t('automation.form.outputTarget')}
                options={[
                  ...(values.runMode === 'background' ? [{ value: 'none' as const, label: t('automation.form.outputNone') }] : []),
                  { value: 'new_session' as const, label: t('automation.form.outputNewSession') },
                  { value: 'reuse_session' as const, label: t('automation.form.outputReuseSession') },
                  { value: 'bot' as const, label: t('automation.form.outputBot') }
                ]}
                onValueChange={(outputMode) => patch({ outputMode })}
              />
              {values.outputMode === 'reuse_session' && (
                <div className="space-y-1.5">
                  <Select value={values.reuseSessionId} onValueChange={(reuseSessionId) => patch({ reuseSessionId })} disabled={values.scope === 'project' && !values.projectId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t('automation.form.sessionPlaceholder')} /></SelectTrigger>
                    <SelectContent>{reusableSessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.title || t('automation.form.untitledSession')} · {new Date(session.updatedAt).toLocaleString()}</SelectItem>)}</SelectContent>
                  </Select>
                  {reusableSessions.length === 0 && <p className="text-xs text-muted-foreground">{t('automation.form.noSessions')}</p>}
                  {errorText('reuseSessionId')}
                </div>
              )}
              {values.outputMode === 'bot' && (
                <div className="space-y-1.5">
                  <Select value={values.channelId} onValueChange={(channelId) => patch({ channelId })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t('automation.form.botPlaceholder')} /></SelectTrigger>
                    <SelectContent>{botTargets.map((target) => <SelectItem key={target.channel.id} value={target.channel.id}>{target.channel.name} · {target.channel.type}</SelectItem>)}</SelectContent>
                  </Select>
                  {botTargets.length === 0 && <p className="text-xs text-muted-foreground">{t('automation.form.noBots')}</p>}
                  {errorText('channelId')}
                </div>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={saving}>{t('automation.form.cancel')}</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {t('automation.form.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OptimizationDialog
        open={optimizer.showOptimizationDialog}
        onOpenChange={optimizer.setShowOptimizationDialog}
        options={optimizer.optimizationOptions}
        selectedOptionIndex={optimizer.selectedOptionIndex}
        onSelectOption={optimizer.setSelectedOptionIndex}
        onUseOption={optimizer.handleSelectOption}
        onCancel={optimizer.handleCancelOptimization}
        isOptimizing={optimizer.isOptimizing}
      />
    </>
  )
}
