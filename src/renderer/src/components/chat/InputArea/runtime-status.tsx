// Runtime status bar: token/cost/TPS/TTFT metrics + streaming status indicator

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, ImageIcon, CheckCircle2, RefreshCcw, ShieldAlert,
  Wrench, Users, Brain, Activity, Clock
} from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { resolveProxyStatusName } from '@renderer/lib/agent/use-capability-proxy'
import {
  calculateCost, calculateCostBreakdown, estimateTokens,
  formatCacheHitRate, formatCost,
  getCacheReadRatio
} from '@renderer/lib/format-tokens'
import type { TokenUsage, UnifiedMessage } from '@renderer/lib/api/types'
import type { ChatMessage } from '@renderer/stores/chat-store/types'
import type {
  ComposerRuntimeStatusProps,
  RuntimeStatusView,
} from './types'
import {
  RuntimeMetric,
  RuntimeTextMetric,
} from './runtime-metrics'
import {
  normalizeTokenCount,
  toFinitePositiveNumber,
  formatRuntimeThroughput,
  formatRuntimeTtft,
  sumNullableCost,
  createEmptyRuntimeUsageTotals,
  addUsageToTotals,
  collectRuntimeOutputSnapshot,
} from './utils'

export function ComposerRuntimeStatus({
  sessionId,
  isStreaming,
  draftInputTokens,
  isOptimizing = false,
  pendingImageReads = 0,
  contextCompressionStatus,
  contextCompressionStatusLabel,
  model,
  className,
  messagesOverride,
  streamingMessageIdOverride,
  usageOverride,
  showStatus = true
}: ComposerRuntimeStatusProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const live = useChatStore(
    useShallow((s) => {
      const targetSessionId = sessionId
      const idx = s.sessionsById[targetSessionId]
      const session = idx !== undefined ? s.sessions[idx] : undefined
      const sessionMessages = session?.messages
      const messages = messagesOverride ?? sessionMessages
      const streamingMessageId = messagesOverride
        ? (streamingMessageIdOverride ?? null)
        : (s.streamingMessages[targetSessionId] ?? null)
      const totals = createEmptyRuntimeUsageTotals()
      const message = streamingMessageId
        ? messages?.find((item) => item.id === streamingMessageId)
        : undefined
      if (messages) {
        const { providers } = useProviderStore.getState()
        for (const item of messages) {
          const reqModel = item.meta?.requestModel
          const providerId = reqModel?.providerId ?? item.debugInfo?.providerId ?? null
          const modelId = reqModel?.modelId ?? item.debugInfo?.model ?? model?.id ?? null
          const provider = providerId ? (providers.find((p: any) => p.id === providerId) ?? null) : null
          const msgModelCfg =
            (provider && modelId
              ? (provider.models.find((m: any) => m.id === modelId) ?? null)
              : null) ??
            (model && modelId === model.id ? model : null) ??
            model ??
            null
          addUsageToTotals(totals, item.usage, msgModelCfg)
        }
      }
      let effectiveTotals = totals
      if (messagesOverride && usageOverride) {
        const authoritativeTotals = createEmptyRuntimeUsageTotals()
        addUsageToTotals(authoritativeTotals, usageOverride, model)
        authoritativeTotals.latestRequestTiming =
          authoritativeTotals.latestRequestTiming ?? totals.latestRequestTiming
        effectiveTotals = authoritativeTotals
      }
      const messageIndex =
        messages && streamingMessageId
          ? messages.findIndex((item) => item.id === streamingMessageId)
          : -1
      let previousUserMessage: UnifiedMessage | ChatMessage | undefined
      if (messages && messageIndex > 0) {
        for (let index = messageIndex - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === 'user') {
            previousUserMessage = messages[index]
            break
          }
        }
      }

      const messageSnapshot = collectRuntimeOutputSnapshot(message)
      const previousUserSnapshot = collectRuntimeOutputSnapshot(previousUserMessage)

      return {
        targetSessionId,
        streamingMessageId,
        // Compute the snapshot inside the selector so streaming mutations
        // (text/thinking/segments) re-render via shallow-compare on primitives.
        snapshotText: messageSnapshot.text,
        snapshotHasActiveThinking: messageSnapshot.hasActiveThinking,
        snapshotHasTextOutput: messageSnapshot.hasTextOutput,
        previousUserText: previousUserSnapshot.text,
        revision: message?._revision ?? 0,
        currentInputTokens: normalizeTokenCount(message?.usage?.inputTokens),
        currentOutputTokens: normalizeTokenCount(message?.usage?.outputTokens),
        currentContextTokens: normalizeTokenCount(message?.usage?.contextTokens),
        cumulativeInputTokens: effectiveTotals.inputTokens,
        cumulativeOutputTokens: effectiveTotals.outputTokens,
        cumulativeBillableInputTokens: effectiveTotals.billableInputTokens,
        cumulativeCacheReadTokens: effectiveTotals.cacheReadTokens,
        cumulativeCacheCreationTokens: effectiveTotals.cacheCreationTokens,
        cumulativeCacheCreation5mTokens: effectiveTotals.cacheCreation5mTokens,
        cumulativeCacheCreation1hTokens: effectiveTotals.cacheCreation1hTokens,
        cumulativeInputCost: effectiveTotals.inputCost,
        cumulativeOutputCost: effectiveTotals.outputCost,
        cumulativeCacheReadCost: effectiveTotals.cacheReadCost,
        cumulativeCacheCreationCost: effectiveTotals.cacheCreationCost,
        cumulativeTotalCost: effectiveTotals.totalCost,
        latestRequestTiming: effectiveTotals.latestRequestTiming,
        isGeneratingImage: messagesOverride
          ? false
          : streamingMessageId
            ? Boolean(s.generatingImageMessages[streamingMessageId])
            : false,
        thinkingEncrypted: streamingMessageId
          ? Boolean((message as { thinkingEncrypted?: boolean } | undefined)?.thinkingEncrypted)
          : false,
        sessionCacheHit: session?.sessionCacheHit,
        sessionCacheMiss: session?.sessionCacheMiss
      }
    })
  )
  const targetSessionId = live.targetSessionId
  const agentRuntime = useAgentStore(
    useShallow((s) => {
      if (!showStatus) {
        return {
          sessionStatus: null,
          retryAttempt: null,
          retryMaxAttempts: null,
          activeToolName: null,
          pendingApprovalToolName: null,
          activeSubAgentCount: 0
        }
      }

      const useLiveBuckets = targetSessionId === s.liveSessionId
      const cache = targetSessionId ? s.sessionToolCallsCache[targetSessionId] : undefined
      const subAgentCache = targetSessionId
        ? s.sessionSubAgentLiveCache[targetSessionId]
        : undefined
      const pending = useLiveBuckets ? s.pendingToolCalls : (cache?.pending ?? [])
      const executed = useLiveBuckets ? s.executedToolCalls : (cache?.executed ?? [])
      const activeSubAgents = useLiveBuckets ? s.activeSubAgents : (subAgentCache?.active ?? {})
      const allToolCalls = [...pending, ...executed]
      const activeTool = [...allToolCalls]
        .reverse()
        .find((toolCall) => toolCall.status === 'streaming' || toolCall.status === 'running')
      const pendingApprovalTool = pending.find((toolCall) => toolCall.status === 'pending_approval')
      const activeSubAgentCount = Object.values(activeSubAgents).filter(
        (subAgent) => subAgent.isRunning && subAgent.sessionId === targetSessionId
      ).length

      return {
        sessionStatus: targetSessionId ? (s.runningSessions[targetSessionId] ?? null) : null,
        retryAttempt: targetSessionId
          ? (s.sessionRequestRetryState[targetSessionId]?.attempt ?? null)
          : null,
        retryMaxAttempts: targetSessionId
          ? (s.sessionRequestRetryState[targetSessionId]?.maxAttempts ?? null)
          : null,
        // A use_capability proxy is shown as the tool it stands in for. Resolved
        // here rather than trusting the stored name: tool_use_streaming_start
        // creates the entry before args arrive, so its name is still the raw
        // proxy name at that point.
        activeToolName: resolveProxyStatusName(activeTool?.name, activeTool?.input),
        pendingApprovalToolName: resolveProxyStatusName(
          pendingApprovalTool?.name,
          pendingApprovalTool?.input
        ),
        activeSubAgentCount
      }
    })
  )
  const outputSnapshot = {
    text: live.snapshotText,
    hasActiveThinking: live.snapshotHasActiveThinking,
    hasTextOutput: live.snapshotHasTextOutput
  }
  const estimatedOutputTokens = React.useMemo(
    () => estimateTokens(outputSnapshot.text),
    [outputSnapshot.text]
  )
  const previousUserInputTokens = React.useMemo(
    () => estimateTokens(live.previousUserText),
    [live.previousUserText]
  )
  const currentEstimatedInputTokens = Math.max(
    live.currentInputTokens,
    live.currentContextTokens,
    draftInputTokens,
    previousUserInputTokens
  )
  const outputTokens =
    live.cumulativeOutputTokens +
    (isStreaming ? Math.max(0, estimatedOutputTokens - live.currentOutputTokens) : 0)
  // Use cumulative API-returned values only. Draft input tokens (from typing)
  // are NOT included — they haven't been sent yet and would make metrics jump.
  // Per-request cache hit rate is shown in each message's token summary bar.
  const inputTokens = live.cumulativeInputTokens
  const cacheReadTokens = live.cumulativeCacheReadTokens
  // Session-level cache hit rate from backend (Reasonix-style: Σhit/Σ(hit+miss))
  // Falls back to per-message traversal when session counters are unavailable.
  // Token-level cache hit rate: cacheReadTokens / inputTokens
  // Matches the displayed numbers (缓存 / 总) for consistent UX
  const cacheHitRate = getCacheReadRatio(inputTokens, cacheReadTokens)
  const streamingExtraUsage = React.useMemo<TokenUsage | null>(() => {
    if (!isStreaming || !model) return null
    const estimatedBillableInputTokens =
      live.currentInputTokens === 0 ? currentEstimatedInputTokens : 0
    const estimatedOutputDelta = Math.max(0, estimatedOutputTokens - live.currentOutputTokens)
    if (estimatedBillableInputTokens <= 0 && estimatedOutputDelta <= 0) return null
    return {
      inputTokens: estimatedBillableInputTokens,
      billableInputTokens: estimatedBillableInputTokens,
      outputTokens: estimatedOutputDelta,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    }
  }, [
    currentEstimatedInputTokens,
    estimatedOutputTokens,
    isStreaming,
    live.currentInputTokens,
    live.currentOutputTokens,
    model
  ])
  const streamingExtraCostBreakdown = React.useMemo(
    () =>
      streamingExtraUsage && model ? calculateCostBreakdown(streamingExtraUsage, model) : null,
    [model, streamingExtraUsage]
  )
  const streamingExtraCost =
    streamingExtraUsage && model ? calculateCost(streamingExtraUsage, model) : null
  const totalInputCost = sumNullableCost(
    live.cumulativeInputCost ?? null,
    streamingExtraCostBreakdown?.inputCost ?? null
  )
  const totalOutputCost = sumNullableCost(
    live.cumulativeOutputCost ?? null,
    streamingExtraCostBreakdown?.outputCost ?? null
  )
  const totalCacheReadCost = sumNullableCost(
    live.cumulativeCacheReadCost ?? null,
    streamingExtraCostBreakdown?.cacheReadCost ?? null
  )
  const totalCacheCreationCost = sumNullableCost(
    live.cumulativeCacheCreationCost ?? null,
    streamingExtraCostBreakdown?.cacheCreationCost ?? null
  )
  const totalCost = sumNullableCost(live.cumulativeTotalCost ?? null, streamingExtraCost ?? null)
  const metricPricing = React.useMemo(() => {
    const inputPrice = model?.inputPrice ?? null
    const outputPrice = model?.outputPrice ?? null
    const cacheReadPrice = model?.cacheHitPrice ?? (inputPrice != null ? inputPrice * 0.1 : null)
    const cacheCreatePrice =
      model?.cacheCreationPrice ?? (inputPrice != null ? inputPrice * 1.25 : null)
    const cacheCreate1hPrice = inputPrice != null ? inputPrice * 2 : null
    return { inputPrice, outputPrice, cacheReadPrice, cacheCreatePrice, cacheCreate1hPrice }
  }, [model])
  const buildCostTitle = React.useCallback(
    (label: string, tokens: number, pricePerMillion: number | null): string | undefined => {
      if (pricePerMillion == null || !Number.isFinite(pricePerMillion) || tokens <= 0)
        return undefined
      return t('input.runtimeMetrics.cost', {
        defaultValue: '{{label}}: {{cost}}',
        label,
        cost: formatCost((tokens * pricePerMillion) / 1_000_000)
      })
    },
    [t]
  )
  // Cache-write tokens are billed at two different TTL rates (5m vs 1h). Split the hover
  // tooltip so each bucket's tokens and cost are shown separately instead of one lumped total.
  const latestTps = toFinitePositiveNumber(live.latestRequestTiming?.tps)
  const latestTtftMs = toFinitePositiveNumber(live.latestRequestTiming?.ttftMs)
  const statusView = React.useMemo<RuntimeStatusView>(() => {
    if (isOptimizing) {
      return {
        text: t('input.runtimeStatus.optimizing', { defaultValue: 'Optimizing' }),
        Icon: Sparkles,
        className: 'text-violet-500/80 dark:text-violet-300/80'
      }
    }
    if (pendingImageReads > 0) {
      return {
        text: t('input.runtimeStatus.loadingMedia', { defaultValue: 'Loading media' }),
        Icon: ImageIcon,
        className: 'text-amber-500/85 dark:text-amber-300/85'
      }
    }
    if (contextCompressionStatus !== 'idle' && contextCompressionStatusLabel) {
      return {
        text: contextCompressionStatusLabel,
        Icon: contextCompressionStatus === 'compressed' ? CheckCircle2 : RefreshCcw,
        className:
          contextCompressionStatus === 'compressed'
            ? 'text-emerald-500/80 dark:text-emerald-300/80'
            : contextCompressionStatus === 'failed'
              ? 'text-red-500/80 dark:text-red-300/80'
              : 'text-amber-500/85 dark:text-amber-300/85',
        spin: contextCompressionStatus === 'compressing'
      }
    }
    if (agentRuntime.pendingApprovalToolName) {
      return {
        text: t('input.runtimeStatus.awaitingApproval', {
          defaultValue: 'Awaiting approval: {{tool}}',
          tool: agentRuntime.pendingApprovalToolName
        }),
        Icon: ShieldAlert,
        className: 'text-amber-500/90 dark:text-amber-300/90'
      }
    }
    if (agentRuntime.sessionStatus === 'retrying') {
      const attempt =
        agentRuntime.retryAttempt
          ? agentRuntime.retryMaxAttempts
            ? `${agentRuntime.retryAttempt}/${agentRuntime.retryMaxAttempts}`
            : `${agentRuntime.retryAttempt}/∞`
          : ''
      return {
        text: t('input.runtimeStatus.retrying', {
          defaultValue: 'Retrying {{attempt}}',
          attempt
        }).trim(),
        Icon: RefreshCcw,
        className: 'text-amber-500/90 dark:text-amber-300/90',
        spin: true
      }
    }
    if (live.isGeneratingImage) {
      return {
        text: t('input.runtimeStatus.generatingImage', { defaultValue: 'Generating image' }),
        Icon: ImageIcon,
        className: 'text-violet-500/80 dark:text-violet-300/80'
      }
    }
    if (agentRuntime.activeToolName) {
      return {
        text: t('input.runtimeStatus.runningTool', {
          defaultValue: 'Running {{tool}}',
          tool: agentRuntime.activeToolName
        }),
        Icon: Wrench,
        className: 'text-sky-500/85 dark:text-sky-300/85'
      }
    }
    if (agentRuntime.activeSubAgentCount > 0) {
      return {
        text: t('input.runtimeStatus.runningSubAgents', {
          defaultValue: '{{count}} sub-agents running',
          count: agentRuntime.activeSubAgentCount
        }),
        Icon: Users,
        className: 'text-cyan-500/85 dark:text-cyan-300/85'
      }
    }
    const isThinkingPhase =
      (outputSnapshot.hasActiveThinking || live.thinkingEncrypted) && !outputSnapshot.hasTextOutput
    if (isStreaming && isThinkingPhase) {
      return {
        text: t('input.runtimeStatus.thinking', { defaultValue: 'Thinking' }),
        Icon: Brain,
        className: 'text-violet-500/85 dark:text-violet-300/85'
      }
    }
    if (isStreaming && (outputTokens > 0 || outputSnapshot.hasTextOutput)) {
      return {
        text: t('input.runtimeStatus.receiving', { defaultValue: 'Generating' }),
        Icon: Activity,
        className: 'text-emerald-500/85 dark:text-emerald-300/85'
      }
    }
    if (isStreaming) {
      return {
        text: t('input.runtimeStatus.waiting', { defaultValue: 'Waiting' }),
        Icon: Clock,
        className: 'text-sky-500/80 dark:text-sky-300/80'
      }
    }
    return {
      text: t('input.runtimeStatus.ready', { defaultValue: 'Ready' }),
      Icon: CheckCircle2,
      className: 'text-muted-foreground/55'
    }
  }, [
    agentRuntime.activeSubAgentCount,
    agentRuntime.activeToolName,
    agentRuntime.pendingApprovalToolName,
    agentRuntime.retryAttempt,
    agentRuntime.retryMaxAttempts,
    agentRuntime.sessionStatus,
    contextCompressionStatus,
    contextCompressionStatusLabel,
    isOptimizing,
    isStreaming,
    live.isGeneratingImage,
    live.thinkingEncrypted,
    outputSnapshot.hasActiveThinking,
    outputSnapshot.hasTextOutput,
    outputTokens,
    pendingImageReads,
    t
  ])
  const StatusIcon = statusView.Icon
  const totalCostRows = React.useMemo(
    () =>
      [
        {
          key: 'input',
          label: t('input.runtimeMetrics.total', { defaultValue: '总' }),
          color: '#38bdf8',
          value: totalInputCost
        },
        {
          key: 'cacheHit',
          label: t('input.runtimeMetrics.cacheHit', { defaultValue: '缓存' }),
          color: '#84cc16',
          value: totalCacheReadCost
        },
        {
          key: 'cacheCreate',
          label: t('input.runtimeMetrics.cacheCreate', { defaultValue: 'Cache write' }),
          color: '#f59e0b',
          value: totalCacheCreationCost
        },
        {
          key: 'output',
          label: t('input.runtimeMetrics.output', { defaultValue: 'Output' }),
          color: '#a855f7',
          value: totalOutputCost
        }
      ].filter(
        (row): row is { key: string; label: string; color: string; value: number } =>
          typeof row.value === 'number' && row.value > 0
      ),
    [t, totalCacheCreationCost, totalCacheReadCost, totalInputCost, totalOutputCost]
  )

  return (
    <div
      className={cn(
        'flex min-h-4 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] leading-4 text-muted-foreground/65',
        className
      )}
      aria-live={isStreaming ? 'polite' : 'off'}
    >
      <RuntimeMetric
        label={t('input.runtimeMetrics.cacheHit', { defaultValue: '缓存' })}
        value={cacheReadTokens}
        tone="cacheHit"
        animate={isStreaming}
        duration={520}
        suffix={formatCacheHitRate(cacheHitRate)}
        title={buildCostTitle(
          t('input.runtimeMetrics.cacheHit', { defaultValue: '缓存' }),
          cacheReadTokens,
          metricPricing.cacheReadPrice
        )}
      />
      <span className="shrink-0 text-muted-foreground/35">/</span>
      <RuntimeMetric
        label={t('input.runtimeMetrics.total', { defaultValue: '总' })}
        value={inputTokens}
        tone="input"
        animate={isStreaming}
        duration={620}
        title={buildCostTitle(
          t('input.runtimeMetrics.total', { defaultValue: '总' }),
          live.cumulativeBillableInputTokens,
          metricPricing.inputPrice
        )}
      />

      <span className="shrink-0 text-muted-foreground/35">/</span>
      <RuntimeMetric
        label={t('input.runtimeMetrics.output', { defaultValue: 'Output' })}
        value={outputTokens}
        tone="output"
        animate
        duration={760}
        title={buildCostTitle(
          t('input.runtimeMetrics.output', { defaultValue: 'Output' }),
          outputTokens,
          metricPricing.outputPrice
        )}
      />
      {latestTps !== null && (
        <>
          <span className="shrink-0 text-muted-foreground/35">/</span>
          <RuntimeTextMetric
            label={t('input.runtimeMetrics.tps', { defaultValue: 'TPS' })}
            value={formatRuntimeThroughput(latestTps)}
            tone="speed"
            hint={t('input.runtimeMetrics.tpsHint', {
              defaultValue: 'Output tokens generated per second'
            })}
          />
        </>
      )}
      {latestTtftMs !== null && (
        <>
          <span className="shrink-0 text-muted-foreground/35">/</span>
          <RuntimeTextMetric
            label={t('input.runtimeMetrics.ttft', { defaultValue: 'TTFT' })}
            value={formatRuntimeTtft(latestTtftMs)}
            tone="latency"
            hint={t('input.runtimeMetrics.ttftHint', {
              defaultValue: 'Time to first token'
            })}
          />
        </>
      )}
      {showStatus ? (
        <>
          <span className="shrink-0 text-muted-foreground/35">/</span>
          <span
            className={cn('inline-flex min-w-0 items-center gap-1 truncate', statusView.className)}
          >
            <StatusIcon className={cn('size-3 shrink-0', statusView.spin && 'animate-spin')} />
            <span className="min-w-0 truncate">{statusView.text}</span>
          </span>
        </>
      ) : null}
      {totalCost !== null && totalCost > 0 && (
        <>
          <span className="shrink-0 text-muted-foreground/35">/</span>
          <HoverCard openDelay={180} closeDelay={100}>
            <HoverCardTrigger asChild>
              <span className="shrink-0 cursor-help tabular-nums text-muted-foreground/60">
                <span className="text-muted-foreground/60">
                  {t('input.runtimeMetrics.totalCost', { defaultValue: 'Cost' })}
                </span>{' '}
                <span className="font-medium text-emerald-500/85 dark:text-emerald-300/85">
                  {formatCost(totalCost)}
                </span>
              </span>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              align="end"
              sideOffset={6}
              className="w-[280px] rounded-lg border-[#262626] bg-[#101010] p-3 text-zinc-100 shadow-2xl"
            >
              <div className="space-y-1">
                {totalCostRows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-4 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-zinc-400">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-zinc-100">
                      {formatCost(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-white/9 pt-2">
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="truncate text-zinc-400">
                    {t('input.runtimeMetrics.totalCost', { defaultValue: 'Cost' })}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-zinc-100">
                    {formatCost(totalCost)}
                  </span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </>
      )}
    </div>
  )
}


export { RuntimeTokenStatistics } from './runtime-token-statistics'
export { ComposerStatusIndicator } from './composer-status-indicator'
