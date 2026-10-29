// S-248：纯文本档的过程行 —— 没有卡片壳、没有边框、点不动。
//
// 老大 2026-10-28 09:34 / 09:37 的口径：纯文本档要「不呈现组件了，也不能点开组件查看，
// 具体情况类似子 agent 卡片里面的显示方式」。所以这里是**照抄子 agent 卡片那一行的渲染**：
// 状态字符 + 短句描述，别的什么都不给 —— 没有折叠箭头、没有 hover 展开、没有右侧详情入口。
//
// 错误不特殊化（09:40「错误丢了就丢了，文字行显示红色就行」）：失败就是 ✗ + 红字，
// 错误详情留在卡片档里看。

import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { formatDurationMs } from '@renderer/lib/format-duration'
import type { AgentRunFileChange } from '@renderer/stores/agent-store'
import { getStepStatusColor, getStepStatusIcon } from '@renderer/lib/agent/sub-agents/step-descriptions'
import { resolveEditPayload, resolveEditSummaryDiff } from '../FileChangeCard/utils'

export interface ProcessTextLineProps {
  name: string
  /** `ToolExecutionItem.summary`，由 `inputSummary()` 生成，与卡片摘要同一份 */
  summary: string
  status: string
  hasError: boolean
  startedAt?: number | null
  completedAt?: number | null
  /** 文件变更行尾的 `+3 -1`（S-248 §9.1 拍的「保留」） */
  input?: Record<string, unknown>
  trackedChange?: AgentRunFileChange
}

/** 状态字符只认 running / completed / error，把流式态折进 running。 */
function normalizeGlyphStatus(status: string, hasError: boolean): string {
  if (hasError || status === 'error') return 'error'
  if (status === 'completed') return 'completed'
  if (status === 'running' || status === 'streaming' || status === 'pending') return 'running'
  return status
}

export function ProcessTextLine({
  name,
  summary,
  status,
  hasError,
  startedAt,
  completedAt,
  input,
  trackedChange
}: ProcessTextLineProps): React.JSX.Element {
  const glyphStatus = normalizeGlyphStatus(status, hasError)
  const failed = glyphStatus === 'error'
  const running = glyphStatus === 'running'

  const durationMs =
    startedAt != null && completedAt != null && completedAt > startedAt
      ? completedAt - startedAt
      : null

  // diff 行数只在文件变更行上算，且只在有落盘快照时算 —— 其余工具不付这份代价。
  const diffStat = React.useMemo(() => {
    if (!trackedChange || !input) return null
    const diff = resolveEditSummaryDiff(resolveEditPayload(input), trackedChange)
    return diff ? { added: diff.added, deleted: diff.deleted } : null
  }, [trackedChange, input])

  return (
    <div className="flex min-w-0 items-baseline gap-2 py-[3px] pl-[2px] text-[12.5px] leading-[1.5]">
      <span
        className={cn(
          'shrink-0 text-[11px]',
          failed ? getStepStatusColor('error') : getStepStatusColor(glyphStatus),
          running && 'animate-pulse'
        )}
        aria-hidden
      >
        {getStepStatusIcon(glyphStatus)}
      </span>
      <span className={cn('shrink-0 text-muted-foreground', failed && 'text-destructive/70')}>
        {name}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          failed ? 'text-destructive' : 'text-foreground/70'
        )}
        title={summary || name}
      >
        {summary || name}
      </span>
      {durationMs != null && !running ? (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {formatDurationMs(durationMs)}
        </span>
      ) : null}
      {diffStat ? (
        <span className="shrink-0 text-[11px] tabular-nums">
          <span className="text-emerald-600">+{diffStat.added}</span>{' '}
          <span className="text-rose-600">-{diffStat.deleted}</span>
        </span>
      ) : null}
    </div>
  )
}
