/*
 * Wishful Claw 自研：后台子 agent 完成后唤醒空闲的主会话。
 *
 * 背景：后台子 agent 完成时，Worker 会把报告注入父 run 的消息队列；父 run 已结束
 * （队列关闭）时，报告被缓冲到 session 级通知区。本 hook 监听渲染端 sub_agent_end
 * 事件，把该会话挂上号，在它空闲下来时 drain 缓冲，并以一条用户消息唤醒主会话继续处理。
 *
 * iter-31 S-53 修改：原先固定重试 3 次（800/1600/2400ms），而那三次几乎必然全落
 * 在主 run 仍然活着的时间窗里 —— 每次都被「主 run 活跃」挡回来，之后再没有任何东西
 * 来触发，报告就永远躺在通知区（实测：子代理 08:27 结束，到 08:31 会话里零回推）。
 * 现在改成事件驱动：主 run 活跃时挂着号，等它空闲的那一刻补唤醒。
 */

import * as React from 'react'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { buildProviderPayload, hasActiveSessionRunForSession } from '@renderer/hooks/use-chat-actions'
import { backgroundSubAgentCompletions } from '@renderer/lib/agent/sub-agents/background-events'

/**
 * 事件到达时 Worker 可能还没把报告写进通知区 —— 它先 emit 事件、后写缓冲。
 * 所以第一次尝试要等一等；缓冲写入就在 emit 之后几行，这个延迟远远够用。
 */
const DRAIN_DELAY_MS = 400

/** 有报告待处理、但还没成功送达的会话。主 run 活跃期间就挂在这里等着。 */
const pendingSessions = new Set<string>()

/** 防重入：store 订阅会被密集触发，同一时刻只跑一轮。 */
let draining = false

let drainTimer: number | null = null

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

  // 调用方已判过一次，这里是防御性重复。判据要与发送路径一致：只看 streamingMessages
  // 会漏掉「正在起跑」和「agent 已登记但还没推出流式消息」两种状态。
  if (hasActiveSessionRunForSession(sessionId)) return

  // 先把前置条件全部探明再动缓冲：drain 是破坏性的，中途任何 return 都会让报告蒸发。
  const providerStore = useProviderStore.getState()
  const activeProvider = providerStore.getActiveProvider()
  const modelId = providerStore.activeModelId || activeProvider?.defaultModel
  if (!activeProvider || !modelId) {
    // 没有可用服务商就没法唤醒。留个痕，否则报告会静默消失。
    console.error('[subagent-wakeup] No active provider/model — cannot wake session:', sessionId)
    return
  }

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

async function drainPendingSessions(): Promise<void> {
  if (draining || pendingSessions.size === 0) return
  draining = true
  try {
    for (const sessionId of [...pendingSessions]) {
      // 主 run 还活着 —— 报告会随正常队列进入它的下一轮，这里不该 drain
      //（drain 是破坏性的，拿走就没人接力了）。但不能就这么算了：挂着号，
      // 等它空闲时再来看。这正是 S-53 修掉的那个洞。
      if (hasActiveSessionRunForSession(sessionId)) continue

      pendingSessions.delete(sessionId)
      await wakeSession(sessionId)
    }
  } finally {
    draining = false
  }
}

function scheduleDrain(): void {
  if (drainTimer !== null) return
  drainTimer = window.setTimeout(() => {
    drainTimer = null
    void drainPendingSessions()
  }, DRAIN_DELAY_MS)
}

/**
 * Mount once at app root. Watches background sub-agent completions and wakes
 * an idle main session so the report is processed instead of lost.
 */
export function useBackgroundSubAgentWakeup(): void {
  React.useEffect(() => {
    const unsubscribeCompletions = backgroundSubAgentCompletions.on((event) => {
      if (!event.sessionId) return
      pendingSessions.add(event.sessionId)
      scheduleDrain()
    })

    // 主 run 结束时不会再有任何 completion 事件（子代理早就结束了）—— 报告却可能
    // 还挂着号。订阅两个决定「会话是否在跑」的 store，在它空闲的那一刻补一次。
    // 挂着号的会话为空时两个回调都立即返回，开销可忽略。
    const unsubscribeChat = useChatStore.subscribe(() => {
      void drainPendingSessions()
    })
    const unsubscribeAgent = useAgentStore.subscribe(() => {
      void drainPendingSessions()
    })

    return () => {
      unsubscribeCompletions()
      unsubscribeChat()
      unsubscribeAgent()
    }
  }, [])
}
