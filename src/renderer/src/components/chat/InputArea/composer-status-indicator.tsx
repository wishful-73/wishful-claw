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
        sessionCacheMiss: session?.sessionCacheMiss
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
        'pointer-events-none absolute left-5 top-2 z-10 inline-flex min-w-0 items-center gap-1 truncate text-[10px] leading-4',
        statusView.className,
        className
      )}
      aria-live={isStreaming ? 'polite' : 'off'}
    >
      <StatusIcon className={cn('size-3 shrink-0', statusView.spin && 'animate-spin')} />
      <span className="min-w-0 truncate">{statusView.text}</span>
    </div>
  )
}
