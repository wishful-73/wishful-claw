/**
 * 其余工具分支的入参陈列：技能、子代理、定时任务、可视化件、记忆工具与兜底键值表。
 *
 * S-250 从 `structured-input.tsx` 搬出，各分支 JSX 与类名逐字平移。
 * 记忆类三个分支里重复的 `<pre>` 片段在原文件就是各写一遍，这里同样保持原样。
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { MONO_FONT } from '@renderer/lib/constants'
import { Bot, Clock } from 'lucide-react'
import { InputField } from '../shared'
import { formatStructuredInputValue } from '../search-utils'
import { getSkillNameFromInput, normalizeWidgetPayload } from '../utils'

export function SkillPane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const skillName = getSkillNameFromInput(input)
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-xs">
      <span className="shrink-0 text-muted-foreground/65">{t('toolCall.skillName')}</span>
      <span className="min-w-0 truncate font-mono text-foreground/85">{skillName || '-'}</span>
    </div>
  )
}

export function TaskPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      <InputField label="subagent_type" value={String(input.subagent_type ?? '')} />
      <InputField label="description" value={String(input.description ?? '')} />
      {input.prompt != null && (
        <InputField
          label="prompt"
          value={
            String(input.prompt).length > 200
              ? String(input.prompt).slice(0, 200) + '…'
              : String(input.prompt)
          }
        />
      )}
    </div>
  )
}

export function CronAddPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const jobName = input.name ? String(input.name) : null
  const schedule = input.schedule as
    | { kind?: string; at?: string; every?: number; expr?: string; tz?: string }
    | undefined
  const prompt = input.prompt ? String(input.prompt) : null
  const deleteAfterRun = Boolean(input.deleteAfterRun)
  const agentId = input.agentId ? String(input.agentId) : null
  const kindLabels: Record<string, string> = { at: 'Once', every: 'Interval', cron: 'Cron' }
  const kindColors: Record<string, string> = {
    at: 'bg-amber-500/10 text-amber-400',
    every: 'bg-cyan-500/10 text-cyan-400',
    cron: 'bg-violet-500/10 text-violet-400'
  }
  const kind = schedule?.kind ?? 'cron'
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <Clock className="size-3 text-blue-400" />
        {schedule?.expr && (
          <span
            className="font-mono text-[11px] text-blue-400/80"
            style={{ fontFamily: MONO_FONT }}
          >
            {schedule.expr}
          </span>
        )}
        {schedule?.every && (
          <span
            className="font-mono text-[11px] text-cyan-400/80"
            style={{ fontFamily: MONO_FONT }}
          >
            every{' '}
            {schedule.every >= 3600000
              ? `${(schedule.every / 3600000).toFixed(1)}h`
              : `${Math.round(schedule.every / 60000)}m`}
          </span>
        )}
        {schedule?.at && (
          <span
            className="font-mono text-[11px] text-amber-400/80"
            style={{ fontFamily: MONO_FONT }}
          >
            {String(schedule.at).slice(0, 19)}
          </span>
        )}
        <span
          className={cn(
            'text-[9px] px-1 rounded',
            kindColors[kind] ?? 'bg-zinc-700/60 text-zinc-400'
          )}
        >
          {kindLabels[kind] ?? kind}
        </span>
        {deleteAfterRun && (
          <span className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-400/80">
            auto-delete
          </span>
        )}
        {schedule?.tz && schedule.tz !== 'UTC' && (
          <span className="text-[9px] text-muted-foreground/55">{schedule.tz}</span>
        )}
      </div>
      {jobName && <p className="text-xs text-muted-foreground/60 italic pl-[18px]">{jobName}</p>}
      {prompt && (
        <div className="pl-[18px] flex items-center gap-1.5">
          <Bot className="size-2.5 text-violet-400" />
          <span className="text-[10px] text-violet-400/70 truncate max-w-[260px]">
            {prompt.slice(0, 100)}
          </span>
        </div>
      )}
      {agentId && agentId !== 'CronAgent' && (
        <div className="pl-[18px]">
          <span className="text-[9px] px-1 rounded bg-violet-500/10 text-violet-400">
            agent: {agentId}
          </span>
        </div>
      )}
    </div>
  )
}

export function CronUpdatePane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const jobId = String(input.jobId ?? '')
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Clock className="size-3 text-blue-400/70" />
      <span className="font-mono text-[11px] text-blue-400/70" style={{ fontFamily: MONO_FONT }}>
        {jobId}
      </span>
      <span className="text-[9px] text-muted-foreground/50">patch</span>
    </div>
  )
}

export function CronRemovePane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const jobId = String(input.jobId ?? '')
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Clock className="size-3 text-muted-foreground/50" />
      <span
        className="font-mono text-[11px] text-muted-foreground/70"
        style={{ fontFamily: MONO_FONT }}
      >
        {jobId}
      </span>
    </div>
  )
}

export function CronListPane(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Clock className="size-3 text-muted-foreground/50" />
      <span className="text-muted-foreground/60">list all scheduled cron jobs</span>
    </div>
  )
}

export function WidgetPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const payload = normalizeWidgetPayload(input)
  const messages = Array.isArray(input.loading_messages)
    ? input.loading_messages.filter((item): item is string => typeof item === 'string')
    : []
  return (
    <div className="space-y-0.5">
      <InputField label="title" value={payload?.title ?? String(input.title ?? '')} />
      <InputField label="kind" value={payload?.kind ?? 'html'} />
      {messages.length > 0 && <InputField label="loading" value={messages.join(' / ')} />}
    </div>
  )
}

export function MemoryHotReadPane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const scope = input.scope ? String(input.scope) : null
  return (
    <div className="space-y-0.5">
      {scope && <InputField label="scope" value={scope} />}
    </div>
  )
}

export function MemoryHotWritePane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const section = String(input.section ?? '')
  const contentVal = typeof input.content === 'string' ? input.content : ''
  return (
    <div className="space-y-1">
      <InputField label="section" value={section} mono />
      {contentVal && (
        <pre
          className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] text-foreground/80 dark:bg-zinc-950 dark:text-zinc-300/80"
          style={{ fontFamily: MONO_FONT }}
        >
          {contentVal.length > 300 ? contentVal.slice(0, 300) + '…' : contentVal}
        </pre>
      )}
    </div>
  )
}

export function MemorySearchPane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const query = String(input.query ?? '')
  const scope = input.scope ? String(input.scope) : null
  const includeDeprecated = input.include_deprecated === true
  return (
    <div className="space-y-0.5">
      <InputField label="query" value={query} mono />
      {includeDeprecated && <InputField label="include_deprecated" value="true" />}
      {scope && <InputField label="scope" value={scope} />}
    </div>
  )
}

export function MemoryAppendPane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const priority = String(input.priority ?? 'standard')
  const title = input.title ? String(input.title) : null
  const contentVal = typeof input.content === 'string' ? input.content : ''
  return (
    <div className="space-y-1">
      <InputField label="priority" value={priority} />
      {title && <InputField label="title" value={title} />}
      {contentVal && (
        <pre
          className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] text-foreground/80 dark:bg-zinc-950 dark:text-zinc-300/80"
          style={{ fontFamily: MONO_FONT }}
        >
          {contentVal.length > 300 ? contentVal.slice(0, 300) + '…' : contentVal}
        </pre>
      )}
    </div>
  )
}

export function MemoryUpdatePane({
  input
}: {
  input: Record<string, unknown>
}): React.JSX.Element {
  const id = String(input.id ?? '')
  const status = input.status ? String(input.status) : null
  const priority = input.priority ? String(input.priority) : null
  const contentVal = typeof input.content === 'string' ? input.content : ''
  return (
    <div className="space-y-1">
      <InputField label="id" value={id} />
      {status && <InputField label="status" value={status} />}
      {priority && <InputField label="priority" value={priority} />}
      {contentVal && (
        <pre
          className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] text-foreground/80 dark:bg-zinc-950 dark:text-zinc-300/80"
          style={{ fontFamily: MONO_FONT }}
        >
          {contentVal.length > 300 ? contentVal.slice(0, 300) + '…' : contentVal}
        </pre>
      )}
    </div>
  )
}

/** 兜底：任何未识别的工具都把入参平铺成键值行。 */
export function FallbackPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const entries = Object.entries(input).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return <></>
  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => {
        const formatted = formatStructuredInputValue(value)
        return <InputField key={key} label={key} value={formatted.text} mono={formatted.mono} />
      })}
    </div>
  )
}
