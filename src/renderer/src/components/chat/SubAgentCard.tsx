// 500 行豁免（2026-10-26 实测 524 行）：整张卡由同一份 `tracked` 子 Agent 状态驱动 ——
// 排队/运行/结束三态换文案、耗时、token、工具清单、报告展开全读同一批字段，
// 拆开要跨文件传六个字段并各自兜一次 undefined，得不偿失。
// 依据 AGENTS.md §大文件拆分 第 5 条第 1 类（单一呈现单元）。
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Brain, ChevronDown, ChevronRight, FileText, ScrollText, icons } from 'lucide-react'

import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { formatTokens, getBillableTotalTokens } from '@renderer/lib/format-tokens'
import { formatDurationMs } from '@renderer/lib/format-duration'
import { parseSubAgentMeta } from '@renderer/lib/agent/sub-agents/create-tool'
import { subAgentRegistry } from '@renderer/lib/agent/sub-agents/registry'
import {
  generateStepDescription,
  getStepStatusColor,
  getStepStatusIcon
} from '@renderer/lib/agent/sub-agents/step-descriptions'
import {
  isEarlyResolved,
  resolveSubAgentApproval
} from '@renderer/lib/tools/sub-agent-approval'
import { useAgentStore } from '@renderer/stores/agent-store'
import { deriveSubAgentExpanded } from './render-density'
import { useDensityOverride, useDensityPolicy } from './use-density-override'
import { useUIStore } from '@renderer/stores/ui-store'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import { cn } from '@renderer/lib/utils'
import type { ToolResultContent } from '@renderer/lib/api/types'
import type { ToolCallState } from '@renderer/lib/agent/types'
import { motion, AnimatePresence } from 'motion/react'
import {
  findSubAgentInSelection,
  selectSessionScopedAgentState
} from '@renderer/lib/agent/session-scoped-agent-state'

interface SubAgentCardProps {
  name: string
  toolUseId: string
  input: Record<string, unknown>
  output?: ToolResultContent
  isLive?: boolean
  sessionId?: string | null
  isBackground?: boolean
}

function getSubAgentIcon(agentName: string): React.ReactNode {
  const def = subAgentRegistry.get(agentName)
  if (def?.icon && def.icon in icons) {
    const IconComp = icons[def.icon as keyof typeof icons]
    return <IconComp className="size-3.5" />
  }
  return <Brain className="size-3.5" />
}

function formatElapsed(ms: number): string {
  // S-245：与工具卡 / 操作栏同一口径，别在这里另写一套（原来秒档带 1 位小数）。
  return formatDurationMs(ms)
}

function extractToolResultText(content?: ToolResultContent): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter(
      (block): block is Extract<ToolResultContent[number], { type: 'text' }> =>
        block.type === 'text'
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

// ── Step List Component ──

function SubAgentStepList({
  toolCalls,
  isRunning
}: {
  toolCalls: ToolCallState[]
  isRunning: boolean
}): React.JSX.Element {
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  // S-179: the step list only ever grows downwards, so the 240px viewport has to follow it.
  // The effect keys on the length alone: that is the only signal for "one more step", and it also
  // catches in-place mutations of the array. Keying on the array itself would fire on every frame
  // along the fallback path, where `toolCalls` is rebuilt by a `.map()` on each render.
  // The scroll runs inside a rAF because the appended row is not laid out yet when the effect fires.
  // These hooks must stay ABOVE the early return below: splitting them across the two render paths
  // breaks the rules of hooks.
  React.useEffect(() => {
    const node = listRef.current
    if (!node) return
    const frame = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [toolCalls.length])

  if (toolCalls.length === 0) {
    return (
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground/50">
        {isRunning ? '准备中...' : '无工具调用'}
      </div>
    )
  }

  return (
    <div ref={listRef} className="max-h-[240px] overflow-y-auto px-3 py-1">
      {toolCalls.map((tc, idx) => {
        const desc = generateStepDescription(tc)
        const statusIcon = getStepStatusIcon(tc.status)
        const statusColor = getStepStatusColor(tc.status)
        const needsApproval = tc.status === 'pending_approval'
        const alreadyResolved = needsApproval && isEarlyResolved(tc.id)
        return (
          <div
            key={tc.id ?? idx}
            className="flex items-center gap-2 py-0.5 text-[11px] leading-5"
          >
            <span className={cn('shrink-0 text-[10px]', statusColor)} aria-hidden="true">
              {statusIcon}
            </span>
            <span className="min-w-0 truncate text-foreground/70">{desc}</span>
            {needsApproval && !alreadyResolved ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                  onClick={(e) => {
                    e.stopPropagation()
                    resolveSubAgentApproval(tc.id, true)
                    forceUpdate()
                  }}
                >
                  同意
                </button>
                <button
                  type="button"
                  className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
                  onClick={(e) => {
                    e.stopPropagation()
                    resolveSubAgentApproval(tc.id, false)
                    forceUpdate()
                  }}
                >
                  拒绝
                </button>
              </span>
            ) : alreadyResolved ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/50">处理中...</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ── Hover Content ──

function SubAgentHoverContent({
  displayName,
  descriptionText,
  promptText,
  icon
}: {
  displayName: string
  descriptionText: string
  promptText: string
  icon: React.ReactNode
}): React.JSX.Element {
  return (
    <HoverCardContent
      side="top"
      align="start"
      className="w-[min(32rem,calc(100vw-3rem))] overflow-hidden border-border/70 bg-popover/98 p-0 text-popover-foreground shadow-xl backdrop-blur"
    >
      <div>
        <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2.5">
          <div className="flex size-7 items-center justify-center rounded-full border border-border/70 text-foreground/75">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground/90">{displayName}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">SubAgent</div>
          </div>
        </div>

        {descriptionText ? (
          <section className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
              <FileText className="size-3" />
              <span>Description</span>
            </div>
            <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/75">
              {descriptionText}
            </div>
          </section>
        ) : null}

        {promptText ? (
          <section className="space-y-1.5 border-t border-border/50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
              <ScrollText className="size-3" />
              <span>Prompt</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/75">
              {promptText}
            </div>
          </section>
        ) : null}
      </div>
    </HoverCardContent>
  )
}

// ── Main Card Component ──

function SubAgentCardInner({
  name,
  toolUseId,
  input,
  output,
  isLive = false,
  sessionId,
  isBackground = false
}: SubAgentCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  void isLive

  const displayName = String(input.subagent_type ?? name)
  const tracked = useAgentStore(
    useShallow((s) => {
      const scoped = sessionId
        ? findSubAgentInSelection(
            selectSessionScopedAgentState(s, sessionId, { mode: 'coarse' }),
            toolUseId
          )
        : null
      const item =
        scoped ??
        s.activeSubAgents[toolUseId] ??
        s.completedSubAgents[toolUseId] ??
        s.subAgentHistory.find((entry) => entry.toolUseId === toolUseId) ??
        null

      if (!item) return null

      return {
        isRunning: item.isRunning,
        isQueued: item.isQueued ?? false,
        reportStatus: item.reportStatus,
        success: item.success,
        endReason: item.endReason,
        errorMessage: item.errorMessage,
        iteration: item.iteration,
        toolCallCount: item.toolCalls.length,
        toolCalls: item.toolCalls,
        usage: item.usage ?? null,
        startedAt: item.startedAt,
        completedAt: item.completedAt
      }
    })
  )

  const outputStr = extractToolResultText(output)
  const parsed = React.useMemo(() => {
    if (!outputStr) return { meta: null, text: '' }
    return parseSubAgentMeta(outputStr)
  }, [outputStr])

  const histMeta = parsed.meta
  const histText = parsed.text || outputStr || ''
  const usage = tracked?.usage ?? histMeta?.usage ?? null
  const isQueued = tracked?.isQueued ?? false
  const reportStatus = tracked?.reportStatus
  const endReason = tracked?.endReason
  const isRunning = (tracked?.isRunning ?? false) && !isQueued
  const historicalError = outputStr
    ? (() => {
        const parsedOutput = decodeStructuredToolResult(outputStr)
        if (
          parsedOutput &&
          !Array.isArray(parsedOutput) &&
          typeof parsedOutput.error === 'string'
        ) {
          return true
        }

        const parsedHistText = decodeStructuredToolResult(histText)
        return !!(
          parsedHistText &&
          !Array.isArray(parsedHistText) &&
          typeof parsedHistText.error === 'string'
        )
      })()
    : false
  const isError = tracked?.success === false || !!tracked?.errorMessage || historicalError

  const [now, setNow] = React.useState(tracked?.startedAt ?? 0)
  React.useEffect(() => {
    if (!tracked?.isRunning) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tracked?.isRunning, tracked?.startedAt])



  // S-225：展开态由全局档位派生 —— 前台子 Agent 紧凑/详情档进行中展开、结束后收起，
  // 纯文本档全程收起；后台子 Agent 三档一律收起（它不是过程细节，是不该占视线）。
  const { density } = useDensityPolicy()
  const [isExpanded, setIsExpanded, resetExpanded] = useDensityOverride<boolean>(() =>
    deriveSubAgentExpanded(density, isRunning, isBackground)
  )

  // 开跑 / 收尾这两个迁移点撤掉本档内的手动覆盖，回落到该档默认值
  const wasRunningRef = React.useRef(false)
  React.useEffect(() => {
    if (isBackground) return
    if (isRunning) {
      wasRunningRef.current = true
      resetExpanded()
    } else if (wasRunningRef.current) {
      wasRunningRef.current = false
      resetExpanded()
    }
  }, [isBackground, isRunning, resetExpanded])

  const elapsed = tracked
    ? (tracked.completedAt ?? (tracked.isRunning ? now : tracked.startedAt)) - tracked.startedAt
    : histMeta?.elapsed

  const descriptionText = input.description ? String(input.description) : ''
  const promptText = [input.prompt, input.query, input.task, input.target]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n\n')

  const iterationCount = tracked?.iteration ?? histMeta?.iterations ?? 0
  const callCount = tracked?.toolCallCount ?? histMeta?.toolCalls.length ?? 0
  const totalTokens = usage ? formatTokens(getBillableTotalTokens(usage)) : null
  const statusText = isQueued
    ? t('subAgent.queued', { defaultValue: 'Queued' })
    : isRunning
      ? reportStatus === 'retrying'
        ? t('subAgent.synthesizing', { defaultValue: 'Synthesizing report…' })
        : t('subAgent.working')
      : isError
        ? endReason === 'max_iterations'
          ? t('subAgent.maxIterations', { defaultValue: 'iteration limit reached' })
          : endReason === 'aborted'
            ? t('subAgent.aborted', { defaultValue: 'aborted' })
            : t('subAgent.failed')
        : reportStatus === 'fallback'
          ? t('subAgent.doneSynthesized', { defaultValue: 'Done (synthesized)' })
          : t('subAgent.done')

  const summaryText = !isRunning && callCount > 0
    ? `完成 ${callCount} 次工具调用`
    : isRunning && callCount > 0
      ? `已执行 ${callCount} 次工具调用`
      : descriptionText || promptText.replace(/\s+/g, ' ').trim() || statusText

  const icon = getSubAgentIcon(displayName)
  const metaText = [
    statusText,
    elapsed != null ? formatElapsed(elapsed) : '',
    iterationCount > 0 ? t('subAgent.iter', { count: iterationCount }) : '',
    callCount > 0 ? t('subAgent.calls', { count: callCount }) : '',
    totalTokens ? `${totalTokens} tok` : ''
  ]
    .filter(Boolean)
    .join(' · ')

  const handleOpenPanel = (): void => {
    // Use task description as panel title (same as the card shows)
    const panelTitle = descriptionText || promptText.replace(/\s+/g, ' ').trim().slice(0, 50) || displayName
    useUIStore
      .getState()
      .openSubAgentExecutionDetail(toolUseId, histText ?? undefined, panelTitle, sessionId ?? undefined)
  }

  const hasSteps = (tracked?.toolCalls?.length ?? 0) > 0 || (histMeta?.toolCalls?.length ?? 0) > 0

  // Build tool calls list: prefer live tracked data, fall back to historical meta
  const effectiveToolCalls = tracked?.toolCalls?.length
    ? tracked.toolCalls
    : (histMeta?.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
        status: (['streaming','pending_approval','running','completed','error','canceled'].includes(tc.status) ? tc.status : 'completed') as ToolCallState['status'],
        output: tc.output,
        error: tc.error,
        requiresApproval: false,
        startedAt: tc.startedAt,
        completedAt: tc.completedAt
      }))

  const card = (
    <div
      className={cn(
        'group my-1 w-full min-w-0 overflow-hidden rounded-md border border-border/30 transition-colors duration-200',
        'hover:border-border/50',
        isError && 'border-destructive/20 hover:border-destructive/35'
      )}
    >
      {/* Header row — click toggles expand/collapse */}
      <button
        type="button"
        onClick={() => {
          if (hasSteps) setIsExpanded((v) => !v)
          handleOpenPanel()
        }}
        title={metaText}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-1.5 py-1.5 text-left text-[12px] transition-colors duration-200',
          'hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 dark:hover:bg-white/[0.035]',
          isError && 'hover:bg-destructive/[0.035]',
        )}
      >
        {/* Expand/collapse chevron */}
        {hasSteps ? (
          <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">
            {isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors',
            isQueued && 'border-amber-500/30 text-amber-600 dark:text-amber-300',
            isRunning && 'border-sky-500/25 text-sky-600 dark:text-sky-300',
            isError && 'border-destructive/25 text-destructive',
            !isQueued &&
              !isRunning &&
              !isError &&
              'border-lime-500/25 text-lime-600 dark:text-lime-400'
          )}
          aria-hidden="true"
        >
          {icon}
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[12px] font-medium text-foreground/82">
            {displayName}
          </span>
          {isBackground ? (
            <span className="hidden shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/[0.07] px-1.5 py-0.5 text-[9px] font-medium leading-none text-cyan-700 sm:inline-flex dark:text-cyan-300">
              {t('subAgent.background', { defaultValue: 'Background' })}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-[12px] text-muted-foreground/55">
            ({summaryText})
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/65">
          <span
            className={cn(
              'size-1.5 rounded-full',
              isQueued && 'bg-amber-500',
              isRunning && 'animate-pulse bg-sky-500 motion-reduce:animate-none',
              isError && 'bg-destructive',
              !isQueued && !isRunning && !isError && 'bg-emerald-500'
            )}
            aria-hidden="true"
          />
          <span className="max-w-28 truncate">{statusText}</span>
          {elapsed != null ? (
            <span className="tabular-nums text-muted-foreground/55">{formatElapsed(elapsed)}</span>
          ) : null}
        </span>
      </button>

      {/* Expanded step list */}
      <AnimatePresence initial={false}>
        {isExpanded && hasSteps && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border/20"
          >
            <SubAgentStepList
              toolCalls={effectiveToolCalls}
              isRunning={isRunning}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return descriptionText || promptText ? (
    <HoverCard>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <SubAgentHoverContent
        displayName={displayName}
        descriptionText={descriptionText}
        promptText={promptText}
        icon={icon}
      />
    </HoverCard>
  ) : (
    card
  )
}

export const SubAgentCard = React.memo(SubAgentCardInner)
