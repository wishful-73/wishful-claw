/*
 * Wishful Claw 自研：后台子 agent 完成后唤醒空闲的主会话。
 *
 * 背景：后台子 agent 完成时，Worker 会把报告注入父 run 的消息队列；但如果
 * 主 loop 已经正常结束，队列已关闭，报告会被丢弃。Worker 侧现在把这种情况
 * 的报告缓冲到 session 级通知区，本 hook 监听渲染端 sub_agent_end 事件：
 * 若该会话当前空闲，先 drain 缓冲报告，再以一条用户消息唤醒主会话继续处理。
 * 若主会话仍在运行，什么都不做——报告会通过正常队列注入下一轮。
 */

import * as React from 'react'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { buildProviderPayload, hasActiveSessionRunForSession } from '@renderer/hooks/use-chat-actions'
import { backgroundSubAgentCompletions } from '@renderer/lib/agent/sub-agents/background-events'

const WAKE_DEBOUNCE_MS = 800
const MAX_WAKE_ATTEMPTS = 3

interface PendingWake {
  timer: number
  attempts: number
}

const pendingWakes = new Map<string, PendingWake>()

async function drainBufferedReports(sessionId: string): Promise<string[]> {
  try {
    const result = await ipcClient.invoke('agent:drain-sub-agent-notifications', { sessionId })
    const payload = result as { ok?: boolean; messages?: Array<{ content?: unknown }> }
    if (!payload?.ok || !Array.isArray(payload.messages)) return []

    const reports: string[] = []
    for (const message of payload.messages) {
      const content = message.content
      if (typeof content === 'string') {
        reports.push(content)
      } else if (Array.isArray(content)) {
        const text = content
          .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text?: unknown }).text ?? '') : ''))
          .filter(Boolean)
          .join('\n')
        if (text) reports.push(text)
      }
    }
    return reports
  } catch (err) {
    // Best effort: a failed drain looks identical to "nothing buffered", so without
    // this the report is dropped and no trace survives.
    console.error('[subagent-wakeup] Failed to drain buffered reports:', sessionId, err)
    return []
  }
}

async function wakeSession(sessionId: string): Promise<void> {
  const chatStore = useChatStore.getState()

  // Session gone (deleted while we waited) — drop the wake.
  const session = chatStore.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return

  // Main run active — reports ride the normal queue; nothing to do.
  // 判活跃要用跟发送路径同一个判据：只看 streamingMessages 会漏掉「正在起跑」和「agent
  // 已登记但还没推出流式消息」两种状态，那两种情况下 drain 掉缓冲就没人接力了。
  if (hasActiveSessionRunForSession(sessionId)) return

  // 先把前置条件全部探明再动缓冲：drain 是破坏性的，中途任何 return 都会让报告蒸发。
  const providerStore = useProviderStore.getState()
  const activeProvider = providerStore.getActiveProvider()
  const modelId = providerStore.activeModelId || activeProvider?.defaultModel
  if (!activeProvider || !modelId) return

  const reports = await drainBufferedReports(sessionId)
  if (reports.length === 0) return

  const settings = useSettingsStore.getState()
  const reportText = reports.join('\n\n---\n\n')
  const content =
    `[系统] 后台子 agent 已完成，以下是它的报告。请基于报告继续处理，` +
    `如有需要可向用户总结结果。\n\n${reportText}`

  void chatStore.sendMessage({
    provider: buildProviderPayload(activeProvider, modelId, settings) as unknown as Record<string, unknown>,
    messages: [{ role: 'user', content }],
    sessionId,
    toolPreset: session.collaborationMode === 'cowork' && session.workingFolder ? 'coding' : 'chat',
    workingFolder: session.scope === 'project' ? session.workingFolder : undefined,
    sshConnectionId: session.scope === 'project' ? session.sshConnectionId : undefined,
    projectId: session.scope === 'project' ? session.projectId : undefined,
    scope: session.scope,
    collaborationMode: session.collaborationMode,
    runtimeRole: 'sessionAgent',
    permissionMode: session.permissionMode,
    maxIterations: 0,
    maxParallelTools: settings.maxParallelToolCalls,
    maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
    personaId: settings.defaultPersonaId ?? undefined,
    language: settings.language,
    userRules: settings.systemPrompt || undefined,
    contextCompressionEnabled: settings.contextCompressionEnabled,
    contextCompressionThreshold: settings.contextCompressionThreshold
  })
}

function scheduleWake(sessionId: string): void {
  const existing = pendingWakes.get(sessionId)
  if (existing) {
    if (existing.attempts >= MAX_WAKE_ATTEMPTS) return
    existing.attempts += 1
    window.clearTimeout(existing.timer)
    const attempts = existing.attempts
    const timer = window.setTimeout(() => {
      pendingWakes.delete(sessionId)
      void wakeSession(sessionId)
    }, WAKE_DEBOUNCE_MS * attempts)
    pendingWakes.set(sessionId, { timer, attempts })
    return
  }

  const timer = window.setTimeout(() => {
    pendingWakes.delete(sessionId)
    void wakeSession(sessionId)
  }, WAKE_DEBOUNCE_MS)
  pendingWakes.set(sessionId, { timer, attempts: 1 })
}

/**
 * Mount once at app root. Watches background sub-agent completions and wakes
 * an idle main session so the report is processed instead of lost.
 */
export function useBackgroundSubAgentWakeup(): void {
  React.useEffect(() => {
    return backgroundSubAgentCompletions.on((event) => {
      if (!event.sessionId) return
      scheduleWake(event.sessionId)
    })
  }, [])
}
