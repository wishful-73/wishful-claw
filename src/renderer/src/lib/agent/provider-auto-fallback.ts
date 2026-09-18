import i18next from 'i18next'
import { toast } from 'sonner'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { resolveSessionModelSelection } from '../session-model-resolution'
import { buildProviderPayload } from './provider-payload'
import { isQuotaFailureSignal } from './quota-failure'
import { pickNextFallbackCandidate, resolveFallbackChain } from './fallback-chain'
import type { ProviderFallbackCandidate } from '../../../../shared/types/provider'

/**
 * iter-29 / S-21: 自动接管「撞上限额后手动换服务商 + 发一句继续推进」这两步。
 *
 * 口径（2026-09-14 定）：
 * - 一次 agent run 撞上配额限制就结束了，不存在「跑一半接着跑」，所以不需要在
 *   AgentLoop 内部换端点 —— C# 侧零改动；
 * - 前端发消息本来就只带增量，历史是模型调用时才拼的，所以自动切换只要替用户
 *   做两件事：操作模型切换器（换服务商+模型）、发一句「继续推进」；
 * - 只有会话处于 **auto** 模式才切 —— auto 这个选项的定义就是这个能力；
 * - 起点仍由现有 auto 路由决定，这里只接管失败后的切换；
 * - 切过去就粘在当前会话，不回头；每个候选一次，试完就停。
 */

/** 自动推进时发给模型的话，等价于用户手动敲的那句「继续」。 */
export function autoFallbackContinueText(): string {
  return i18next.t('settings:provider.fallback.continuePrompt', { defaultValue: '继续推进' })
}

// 限额判定搬到了 lib/agent/quota-failure.ts —— 纯函数，能单独测。
// 这里 re-export 保持既有 import 路径可用。
export { isQuotaFailure } from './quota-failure'

/**
 * 每个会话一条推进链：记住这次链路上已经用过的服务商。内存态即可 —— 重启后
 * 用户重新发一句「继续」本来就是一次新链路。
 */
const attemptedBySession = new Map<string, { ids: string[]; at: number }>()

/** 超过这个时间没再失败，就当作新一轮对话，链路重新从第一个候选开始。 */
const ATTEMPT_CHAIN_TTL_MS = 10 * 60 * 1000

function liveAttempts(sessionId: string): string[] {
  const entry = attemptedBySession.get(sessionId)
  if (!entry) return []
  if (Date.now() - entry.at > ATTEMPT_CHAIN_TTL_MS) {
    attemptedBySession.delete(sessionId)
    return []
  }
  return entry.ids
}

export function clearAutoFallbackAttempts(sessionId: string): void {
  attemptedBySession.delete(sessionId)
}

export interface AutoFallbackTarget {
  providerId: string
  modelId: string
  providerName: string
  modelName: string
  /** 让位出来的那个，用于给用户的提示文案。 */
  fromProviderName: string
}

/**
 * 一个会话实际生效的候选链：会话级覆盖优先，没有就用设置页里的全局默认。
 *
 * 覆盖只活在本次运行（内存态，跟 `attemptedBySession` / auto 选型表同层），重启
 * 回到默认 —— 所以这里刻意只读这两处，不碰 DB。
 */
export function resolveFallbackCandidates(sessionId: string): ProviderFallbackCandidate[] {
  const override = useUIStore.getState().fallbackCandidatesBySession[sessionId]
  return resolveFallbackChain(override, useSettingsStore.getState().providerFallback?.candidates ?? [])
}

/**
 * 下一个可用候选。返回 null 表示不该切（未启用 / 非 auto 会话 / 都试过了）。
 *
 * 模型**直接来自配置**，不猜：候选写的是「服务商 + 它上面的首选模型」，同名模型在
 * 不同服务商不是同一个东西（协议 / 上下文长度 / 计费都不同），拿"名字撞上了"来推
 * 是错的。`modelId` 为空表示用户还没选，跳过而不是替他选一个。
 */
export function resolveNextAutoFallbackTarget(sessionId: string): AutoFallbackTarget | null {
  const fallback = useSettingsStore.getState().providerFallback
  if (!fallback?.enabled) return null

  const candidates = resolveFallbackCandidates(sessionId)
  if (candidates.length === 0) return null

  const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session || session.modelSelectionMode !== 'auto') return null

  const providerState = useProviderStore.getState()
  const providers = providerState.providers

  // 当前实际在用的服务商 —— auto 模式下它不一定写在 session 上，所以走解析函数拿，
  // 失败的那个不能再排进候选。
  const current = resolveSessionModelSelection({
    session,
    providers,
    activeProviderId: providerState.activeProviderId,
    activeModelId: providerState.activeModelId,
    globalMode: useSettingsStore.getState().mainModelSelectionMode
  })

  const skip = new Set<string>(liveAttempts(sessionId))
  if (current.providerId) skip.add(current.providerId)
  const fromProviderName = current.providerId
    ? (providers.find((item) => item.id === current.providerId)?.name ?? current.providerId)
    : 'auto'

  const match = pickNextFallbackCandidate(candidates, providers, skip)
  if (!match) return null
  return {
    providerId: match.provider.id,
    modelId: match.modelId,
    providerName: match.provider.name,
    modelName: match.modelId,
    fromProviderName
  }
}

/**
 * 落盘切换（等价于用户操作模型切换器），并把该候选记进本次链路。
 * 保持会话仍是 auto 模式 —— 下次失败还会继续往下切。
 *
 * 只写会话本身：`auto` 分支优先读会话绑定（`session-model-resolution`），所以下一个
 * 普通消息就会用这个目标 —— 「切了不粘」的病根是当年把结果写去了一张 auto 会另外
 * 优先读的表，而那张表没人写。现在没有那张表了。
 */
export function applyAutoFallbackTarget(sessionId: string, target: AutoFallbackTarget): boolean {
  const store = useChatStore.getState()
  if (typeof store.setSessionAutoFallbackTarget !== 'function') return false
  store.setSessionAutoFallbackTarget(sessionId, target.providerId, target.modelId)

  const attempted = liveAttempts(sessionId)
  attempted.push(target.providerId)
  attemptedBySession.set(sessionId, { ids: attempted, at: Date.now() })
  return true
}

export function describeAutoFallbackSwitch(from: string, target: AutoFallbackTarget): string {
  return i18next.t('settings:provider.fallback.autoSwitched', {
    defaultValue: '{{from}} 触发限额，已自动切换到 {{to}}',
    from,
    to: `${target.providerName} / ${target.modelName}`
  })
}

/**
 * 一次 run 以限额错误收尾时的入口。**返回值 = 调用方是否应该吞掉那张报错卡片。**
 *
 * 判定与取候选都是同步的（纯读 store），真正动手放在下一拍：error 事件是在
 * sendMessage 的流处理里收到的，当场再调 sendMessage 会重入同一条链路。
 *
 * 只有「算得出下一个候选」才返回 true —— 候选试完 / 只启用了一家 / 非 auto 会话，
 * 都必须照常渲染报错卡片。否则用户看到的是"既没切、错误也没了"的静默失败。
 *
 * 延迟执行落空时（这 400ms 里用户手动切了模型、删了会话等）会把卡片**补回来**，
 * 所以这个动作是可撤销的：先吞、失败再还。
 */
export function tryTakeOverQuotaFailure(args: {
  sessionId: string
  runId: string
  errorMessage?: string | null
  errorType?: string | null
  statusCode?: number | null
}): boolean {
  const { sessionId, runId, errorMessage } = args
  if (!isQuotaFailureSignal(args)) return false

  const target = resolveNextAutoFallbackTarget(sessionId)
  if (!target) return false

  setTimeout(() => {
    void runAutoFallback(sessionId, target).then((continued) => {
      if (!continued) restoreErrorCard(sessionId, runId, errorMessage ?? '')
    })
  }, 400)
  return true
}

/** Puts the quota error back on the message when the handover did not happen after all. */
function restoreErrorCard(sessionId: string, runId: string, message: string): void {
  if (!message) return
  useChatStore.setState((state) => {
    const session = state.sessions.find((item) => item.id === sessionId)
    const message_ = session?.messages.find((item) => item.id === runId)
    if (message_) message_.error = message
  })
}

/** Returns false when the handover was abandoned (caller restores the error card). */
async function runAutoFallback(sessionId: string, target: AutoFallbackTarget): Promise<boolean> {
  // 重新校验：这 400ms 里用户可能已经手动切了模型（auto → manual）、删了会话，或者
  // 自己又发了消息。此时再动手就是拿一个过期的决定覆盖用户的当前选择。
  const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session || session.modelSelectionMode !== 'auto') return false

  if (!applyAutoFallbackTarget(sessionId, target)) return false

  toast.info(describeAutoFallbackSwitch(target.fromProviderName, target))

  const provider = useProviderStore.getState().providers.find((item) => item.id === target.providerId)
  if (!provider) return false

  const chatStore = useChatStore.getState()

  // The follow-up turn must start with the same parameters a manual send uses.
  // Leaving them out makes the Worker guess: it infers scope from
  // projectId/workingFolder and forces collaborationMode to "chat" for a global run —
  // so a project session would be pushed forward without its project tools.
  // See AgentRunContextPolicy / AgentLoop.
  const settings = useSettingsStore.getState()
  const projectId = session.scope === 'project' ? (session.projectId ?? undefined) : undefined
  const project = projectId ? chatStore.projects.find((item) => item.id === projectId) : null
  const workingFolder = session.scope === 'project'
    ? (session.workingFolder ?? project?.workingFolder ?? undefined)
    : undefined
  const sshConnectionId = session.scope === 'project'
    ? (session.sshConnectionId ?? project?.sshConnectionId ?? undefined)
    : undefined

  const text = autoFallbackContinueText()
  try {
    await chatStore.sendMessage({
      provider: buildProviderPayload(provider, target.modelId, settings),
      messages: [{ role: 'user', content: text }],
      userMessageText: text,
      sessionId,
      workingFolder,
      sshConnectionId,
      projectId,
      scope: session.scope,
      collaborationMode: session.collaborationMode,
      runtimeRole: 'sessionAgent',
      permissionMode: session.permissionMode,
      contextCapEnabled: session.contextCapEnabled,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
      personaId: session.personaId ?? settings.defaultPersonaId ?? undefined,
      language: settings.language,
      userRules: settings.systemPrompt || undefined,
      contextCompressionEnabled: settings.contextCompressionEnabled,
      contextCompressionThreshold: settings.contextCompressionThreshold,
      sandboxEnabled: settings.sandboxEnabled
    })
    return true
  } catch (error) {
    // 推进失败就到此为止 —— 不继续往下切，把报错留给用户自己决定。
    console.warn('[provider-auto-fallback] failed to continue after switching:', error)
    return false
  }
}
