/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Bot, Loader2 } from 'lucide-react'
import { RuntimeTokenStatistics } from '@renderer/components/chat/InputArea'
import { TranscriptMessageList } from '@renderer/components/chat/TranscriptMessageList'
import { buildRenderableMessageMeta } from '@renderer/components/chat/transcript-utils'
import { useAgentStore, type SubAgentState } from '@renderer/stores/agent-store'
import { useChatStore } from '@renderer/stores/chat-store'
import type {
  ContentBlock,
  MessageRequestModelMeta,
  ToolResultContent,
  UnifiedMessage
} from '@renderer/lib/api/types'
import { cn } from '@renderer/lib/utils'
import { parseSubAgentMeta } from '@renderer/lib/agent/sub-agents/create-tool'
import { readSubAgentByToolUseId } from '@renderer/lib/ipc/agent-history-storage'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import type { ToolCallState } from '@renderer/lib/agent/types'

const EMPTY_SESSION_MESSAGES: UnifiedMessage[] = []

function buildSubAgentDetailSignature(agent: SubAgentState | null): string {
  if (!agent) return 'empty'
  const currentAssistant = agent.currentAssistantMessageId
    ? agent.transcript.find((message) => message.id === agent.currentAssistantMessageId)
    : null
  const lastMessage = agent.transcript[agent.transcript.length - 1]
  return [
    agent.toolUseId,
    agent.sessionId ?? '',
    agent.isRunning ? '1' : '0',
    agent.endReason ?? '',
    String(agent.iteration),
    String(agent.toolCalls.length),
    String(agent.transcript.length),
    agent.currentAssistantMessageId ?? '',
    agent.requestModel?.providerId ?? '',
    agent.requestModel?.providerBuiltinId ?? '',
    agent.requestModel?.modelId ?? '',
    agent.requestModel?.modelName ?? '',
    agent.requestModel?.modelIcon ?? '',
    agent.mcpServerIds?.join(',') ?? '',
    agent.permissionMode ?? '',
    String(currentAssistant?._revision ?? ''),
    lastMessage?.id ?? '',
    String(lastMessage?._revision ?? ''),
    agent.toolCalls
      .map(
        (toolCall) =>
          `${toolCall.id}:${toolCall.name}:${toolCall.status}:${toolCall.completedAt ?? ''}:${
            toolCall.error ?? ''
          }:${getToolResultLength(toolCall.output)}`
      )
      .join('|'),
    String(agent.completedAt ?? ''),
    agent.reportStatus ?? '',
    agent.report
  ].join('::')
}

function getToolResultLength(content?: ToolResultContent): number {
  if (!content) return 0
  if (typeof content === 'string') return content.length
  return content.reduce((total, block) => {
    if (block.type === 'text') return total + block.text.length
    return total + (block.source.data?.length ?? block.source.url?.length ?? 0)
  }, 0)
}

function buildLiveToolCallMap(
  toolCalls: ToolCallState[],
  agentIsRunning: boolean
): Map<string, ToolCallState> | null {
  if (toolCalls.length === 0) return null
  const map = new Map<string, ToolCallState>()
  for (const toolCall of toolCalls) {
    // 子 agent 已经不在执行了（用户点停止 / 父 run 结束），它不可能还有工具在跑。
    // 但 live 快照是事件推上来的，停止时不一定会给最后一条补终态 —— 于是详情里
    // 会永远停在「正在执行 某个命令」，看着像没停下来。这里按事实呈现：降级为已取消。
    // 只在 !agentIsRunning 时降级，agent 仍在跑时原样透传，不影响实时显示。
    const stale =
      !agentIsRunning &&
      (toolCall.status === 'running' ||
        toolCall.status === 'streaming' ||
        toolCall.status === 'pending_approval')
    map.set(toolCall.id, stale ? { ...toolCall, status: 'canceled' } : toolCall)
  }
  return map
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

function getFallbackReportFromToolOutput(content?: ToolResultContent): string {
  const rawOutput = extractToolResultText(content)
  if (!rawOutput.trim()) return ''

  const { text } = parseSubAgentMeta(rawOutput)
  const payloadText = text.trim() || rawOutput.trim()
  const decoded = decodeStructuredToolResult(payloadText)

  if (decoded && !Array.isArray(decoded)) {
    if (typeof decoded.result === 'string' && decoded.result.trim()) {
      return decoded.result.trim()
    }
    if (typeof decoded.error === 'string' && decoded.error.trim()) {
      return decoded.error.trim()
    }
  }

  return payloadText
}

function getFallbackReportFromMessages(
  toolUseId: string | null | undefined,
  messages: UnifiedMessage[]
): string {
  if (!toolUseId) return ''

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!Array.isArray(message.content)) continue

    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex]
      if (block.type !== 'tool_result' || block.toolUseId !== toolUseId) continue

      const report = getFallbackReportFromToolOutput(block.content)
      if (report.trim()) return report.trim()
    }
  }

  return ''
}

function findToolUseInput(
  toolUseId: string | null | undefined,
  messages: UnifiedMessage[]
): Record<string, unknown> | null {
  if (!toolUseId) return null

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue

    const block = message.content.find(
      (item): item is Extract<ContentBlock, { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.id === toolUseId
    )
    if (block) return block.input
  }

  return null
}

function getPromptText(input: Record<string, unknown> | null): string {
  if (!input) return ''
  return [input.prompt, input.query, input.task, input.target]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function buildFallbackTranscript({
  toolUseId,
  description,
  prompt,
  report
}: {
  toolUseId: string | null | undefined
  description: string
  prompt: string
  report: string
}): UnifiedMessage[] {
  const idBase = toolUseId || 'subagent-fallback'
  const now = Date.now()
  const messages: UnifiedMessage[] = []
  const taskText = [description.trim(), prompt.trim()].filter(Boolean).join('\n\n')

  if (taskText) {
    messages.push({
      id: `${idBase}:fallback-user`,
      role: 'user',
      content: taskText,
      createdAt: now - 1
    })
  }

  if (report.trim()) {
    messages.push({
      id: `${idBase}:fallback-assistant`,
      role: 'assistant',
      content: report.trim(),
      createdAt: now
    })
  }

  return messages
}

function getLatestTranscriptRequestModel(
  transcript: UnifiedMessage[]
): MessageRequestModelMeta | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const requestModel = transcript[index]?.meta?.requestModel
    if (requestModel) return requestModel
  }
  return null
}

export function SubAgentExecutionDetail({
  toolUseId,
  inlineText,
  sessionId,
  embedded = false
}: {
  toolUseId?: string | null
  inlineText?: string
  sessionId?: string | null
  embedded?: boolean
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const resolvedSessionId = sessionId ?? activeSessionId

  // 按需直读 store 字段，不走 selectSessionScopedAgentState：这里靠 toolUseId 全局
  // 唯一直接取单条，那个选择器返回的是整份按会话分组的派生结果，用它得先造一遍
  // 再从中挑一条，白费。S-342 已把它实装，这不是桩。
  const agentDetail = useAgentStore(
    useShallow((s) => {
      const agent =
        (toolUseId ? s.activeSubAgents[toolUseId] : null) ??
        (toolUseId ? s.completedSubAgents[toolUseId] : null) ??
        (toolUseId ? s.subAgentHistory.find((entry) => entry.toolUseId === toolUseId) : null) ??
        null
      return {
        agent,
        signature: buildSubAgentDetailSignature(agent)
      }
    })
  )

  const hasLiveAgent = Boolean(agentDetail.agent)
  const sessionMessages = useChatStore((s) =>
    !hasLiveAgent && resolvedSessionId
      ? s.getSessionMessages(resolvedSessionId)
      : EMPTY_SESSION_MESSAGES
  )
  const executedToolCalls = useAgentStore((s) => s.executedToolCalls)
  const agent = agentDetail.agent

  // On-demand load: if agent exists but has no transcript (built from message summary),
  // fetch the full persisted state by toolUseId from SQLite
  const [loadedAgent, setLoadedAgent] = React.useState<SubAgentState | null>(null)
  const [loadingFromDb, setLoadingFromDb] = React.useState(false)

  // Use loaded agent if available, otherwise fall back to store agent
  const effectiveAgent = loadedAgent ?? agent

  const hasRenderableAgentTranscript = effectiveAgent?.transcript.length
    ? buildRenderableMessageMeta(effectiveAgent.transcript, effectiveAgent.currentAssistantMessageId).length > 0
    : false

  React.useEffect(() => {
    if (!toolUseId) return
    // Skip if we already have a live agent with transcript
    if (effectiveAgent && effectiveAgent.transcript.length > 0) return
    // Skip if already loaded
    if (loadedAgent) return

    let cancelled = false
    setLoadingFromDb(true)
    readSubAgentByToolUseId(toolUseId)
      .then((result) => {
        if (cancelled) return
        if (result.found && result.data) {
          setLoadedAgent(result.data as SubAgentState)
        }
      })
      .catch(() => {
        // Not found in DB — agent may have been created before persistence was implemented
      })
      .finally(() => {
        if (!cancelled) setLoadingFromDb(false)
      })

    return () => { cancelled = true }
  }, [toolUseId, effectiveAgent, loadedAgent])

  const fallbackReportText = React.useMemo(() => {
    const fromAgent = effectiveAgent?.errorMessage?.trim() || effectiveAgent?.report.trim() || ''
    if (fromAgent) return fromAgent

    const fromMessages = getFallbackReportFromMessages(toolUseId, sessionMessages as UnifiedMessage[])
    if (fromMessages) return fromMessages

    return toolUseId
      ? getFallbackReportFromToolOutput(
          executedToolCalls.find((item) => item.id === toolUseId)?.output
        )
      : ''
  }, [effectiveAgent?.errorMessage, effectiveAgent?.report, toolUseId, sessionMessages, executedToolCalls])

  const fallbackDetailText = (fallbackReportText.trim() || inlineText?.trim() || '').trim()
  const fallbackInput = React.useMemo(
    () => findToolUseInput(toolUseId, sessionMessages as UnifiedMessage[]),
    [toolUseId, sessionMessages]
  )
  const fallbackDescription =
    effectiveAgent?.description.trim() ||
    (fallbackInput?.description ? String(fallbackInput.description) : '')
  const fallbackPrompt = effectiveAgent?.prompt.trim() || getPromptText(fallbackInput)
  const fallbackTranscript = React.useMemo(
    () =>
      buildFallbackTranscript({
        toolUseId,
        description: fallbackDescription,
        prompt: fallbackPrompt,
        report: fallbackDetailText
      }),
    [toolUseId, fallbackDescription, fallbackPrompt, fallbackDetailText]
  )

  const usesAgentTranscript = Boolean(effectiveAgent && hasRenderableAgentTranscript)
  const transcript = usesAgentTranscript && effectiveAgent ? effectiveAgent.transcript : fallbackTranscript
  const subAgentRequestModel = effectiveAgent?.requestModel ?? getLatestTranscriptRequestModel(transcript)
  const streamingMessageId = usesAgentTranscript ? (effectiveAgent?.currentAssistantMessageId ?? null) : null
  const transcriptRevisionKey = usesAgentTranscript
    ? agentDetail.signature
    : [
        'fallback',
        agentDetail.signature,
        ...fallbackTranscript.map((message) => `${message.id}:${message._revision ?? 0}`)
      ].join('|')
  const toolCalls = effectiveAgent?.toolCalls
  const agentIsRunning = Boolean(effectiveAgent?.isRunning)
  const liveToolCallMap = React.useMemo(
    () => (toolCalls ? buildLiveToolCallMap(toolCalls, agentIsRunning) : null),
    [toolCalls, agentIsRunning]
  )

  if (transcript.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-col items-center justify-center px-6 text-center',
          embedded ? 'bg-transparent' : 'bg-background'
        )}
      >
        {loadingFromDb ? (
          <Loader2 className="mb-3 size-8 animate-spin text-muted-foreground/40" />
        ) : (
          <Bot className="mb-3 size-8 text-muted-foreground/40" />
        )}
        <p className="text-sm text-muted-foreground">
          {loadingFromDb
            ? t('detailPanel.loadingSubAgent', { defaultValue: 'Loading sub-agent details...' })
            : t('detailPanel.noSubAgentRecords', { defaultValue: 'No sub-agent records' })}
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', embedded ? 'bg-transparent' : 'bg-background')}
    >
      <TranscriptMessageList
        messages={transcript}
        streamingMessageId={streamingMessageId}
        className="h-full min-h-0 flex-1"
        revisionKey={transcriptRevisionKey}
        sessionId={resolvedSessionId}
        liveToolCallMap={liveToolCallMap}
        autoScrollToBottom={Boolean(effectiveAgent?.isRunning)}
      />
      {resolvedSessionId ? (
        <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 py-2 backdrop-blur-sm">
          <RuntimeTokenStatistics
            sessionId={resolvedSessionId}
            messages={transcript}
            streamingMessageId={streamingMessageId}
            usage={effectiveAgent?.usage}
            requestModel={subAgentRequestModel}
            isStreaming={Boolean(effectiveAgent?.isRunning)}
            className="overflow-x-auto [scrollbar-width:none]"
          />
        </div>
      ) : null}
    </div>
  )
}
