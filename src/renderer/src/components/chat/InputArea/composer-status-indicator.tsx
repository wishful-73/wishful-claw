// Lightweight status indicator (icon + text) for placement inside the composer shell.
// Renders only the status portion of ComposerRuntimeStatus.

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, ImageIcon, CheckCircle2, RefreshCcw, ShieldAlert,
  Wrench, Users, Brain, Activity, Clock
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { RuntimeStatusView, ComposerRuntimeStatusProps } from './types'
import { collectRuntimeOutputSnapshot } from './utils'
import { resolveRunningElapsedLabel } from '@renderer/lib/format-duration'
import { resolveProxyStatusName } from '@renderer/lib/agent/use-capability-proxy'

export function ComposerStatusIndicator({
  sessionId,
  isStreaming,
  isOptimizing = false,
  pendingImageReads = 0,
  contextCompressionStatus,
  contextCompressionStatusLabel,
  className,
  messagesOverride,
  streamingMessageIdOverride,
}: ComposerRuntimeStatusProps): React.JSX.Element | null {
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
      const message = streamingMessageId
        ? messages?.find((item) => item.id === streamingMessageId)
        : undefined
      const snapshot = collectRuntimeOutputSnapshot(message)
      return {
        hasActiveThinking: snapshot.hasActiveThinking,
        hasTextOutput: snapshot.hasTextOutput,
        isGeneratingImage: streamingMessageId
          ? Boolean(s.generatingImageMessages[streamingMessageId])
          : false,
        thinkingEncrypted: streamingMessageId
          ? Boolean((message as { thinkingEncrypted?: boolean } | undefined)?.thinkingEncrypted)
          : false,
        sessionCacheHit: session?.sessionCacheHit,
        sessionCacheMiss: session?.sessionCacheMiss,
        // iter-39 S-197：本轮 run 的起点 = 当前流式消息的 createdAt（开跑时刻，不含排队）。
        // run 一结束，streamingMessages[sessionId] 被清 ⇒ 这里回到 null ⇒ 动态耗时立即收起。
        streamingStartedAt: message?.createdAt ?? null
      }
    })
  )
  const agentRuntime = useAgentStore(
    useShallow((s) => {
      const useLiveBuckets = sessionId === s.liveSessionId
      const cache = sessionId ? s.sessionToolCallsCache[sessionId] : undefined
      const subAgentCache = sessionId ? s.sessionSubAgentLiveCache[sessionId] : undefined
      const pending = useLiveBuckets ? s.pendingToolCalls : (cache?.pending ?? [])
      const executed = useLiveBuckets ? s.executedToolCalls : (cache?.executed ?? [])
      const activeSubAgents = useLiveBuckets ? s.activeSubAgents : (subAgentCache?.active ?? {})
      const allToolCalls = [...pending, ...executed]
      const activeTool = [...allToolCalls]
        .reverse()
        .find((toolCall) => toolCall.status === 'streaming' || toolCall.status === 'running')
      const pendingApprovalTool = pending.find((toolCall) => toolCall.status === 'pending_approval')
      const activeSubAgentCount = Object.values(activeSubAgents).filter(
        (subAgent) => subAgent.isRunning && subAgent.sessionId === sessionId
      ).length
      return {
        sessionStatus: sessionId ? (s.runningSessions[sessionId] ?? null) : null,
        retryAttempt: sessionId ? (s.sessionRequestRetryState[sessionId]?.attempt ?? null) : null,
        retryMaxAttempts: sessionId ? (s.sessionRequestRetryState[sessionId]?.maxAttempts ?? null) : null,
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
    hasActiveThinking: live.hasActiveThinking,
    hasTextOutput: live.hasTextOutput
  }
  const outputTokens = 0 // Not needed for status view; only used for metrics

  // iter-39 S-197：状态栏动态耗时。起点 = 当前流式消息的 createdAt（本轮 run 开跑时刻），
  // 每秒 tick 一次；run 一结束 streamingStartedAt 变 null ⇒ 立即收起，**不做保留**。
  // 计数与格式化走纯函数 resolveRunningElapsedLabel（口径四条不变量在 tests/composer-status-elapsed 钉死）。
  const elapsedStartedAt = live.streamingStartedAt
  const [nowTick, setNowTick] = React.useState(0)
  React.useEffect(() => {
    if (messagesOverride || elapsedStartedAt == null) return
    const tick = (): void => setNowTick(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer) // 卸载 / 切会话 / run 结束即清，不泄漏
  }, [elapsedStartedAt, messagesOverride])

  const runningElapsedLabel = resolveRunningElapsedLabel({
    startedAt: elapsedStartedAt,
    now: nowTick,
    disabled: messagesOverride != null
  })

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
    live.hasActiveThinking,
    live.hasTextOutput,
    live.thinkingEncrypted,
    outputTokens,
    t
  ])

  const StatusIcon = statusView.Icon

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-5 top-2 z-10 inline-flex min-w-0 items-center gap-1 text-[10px] leading-4',
        statusView.className,
        className
      )}
      aria-live={isStreaming ? 'polite' : 'off'}
    >
      <StatusIcon className={cn('size-3 shrink-0', statusView.spin && 'animate-spin')} />
      <span className="min-w-0 truncate">{statusView.text}</span>
      {runningElapsedLabel ? (
        // 形态 B：紧跟状态词后一小段（ml-1 = 额外 4px，连容器 gap-1 共 8px），**不贴右边缘**。
        // 与状态词靠「颜色 + 前缀」分组，而不是靠拉开的距离 —— 参照 Reasonix 的 run strip：
        // 读数色**不跟随状态色**（否则 thinking 的紫 + 紧邻的耗时读成「思考了 12s」），
        // 固定用 sky —— 与 runtime-metrics 的数值色同源，且深色主题 --primary 本就是蓝。
        // 前缀「耗时」二字把读数钉成名词短语，彻底断开与状态词的连读。
        // shrink-0 保证空间不够时先截状态词（截在词上），读数不被挤掉（截在数字里最糟）；
        // tabular-nums 让每秒跳字时宽度不抖；aria-hidden 避免 aria-live 每秒播报。
        <span className="ml-1 shrink-0 tabular-nums text-sky-500/85 dark:text-sky-300/85" aria-hidden="true">
          {t('input.runtimeStatus.elapsed', { duration: runningElapsedLabel, defaultValue: 'Elapsed {{duration}}' })}
        </span>
      ) : null}
    </div>
  )
}
