import i18next from 'i18next'
import { toast } from 'sonner'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { resolveSessionModelSelection } from '../session-model-resolution'
import { buildProviderPayload } from './provider-payload'
import type { AIProvider } from '../../../../shared/types/provider'

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

// 429 / 503 是 ProviderHttpException 消息里的固定形态："... request failed HTTP 429: ..."
const QUOTA_STATUS_PATTERNS = [/HTTP\s+429/, /HTTP\s+503/]
const QUOTA_PHRASE_PATTERNS = [
  /rate[_\s-]?limit/i,
  /\bquota\b/i,
  /usage[_\s-]?limit/i,
  /overload/i,
  /\bcapacity\b/i
]
/** 上下文超限换个服务商也好不了，必须排除 —— 否则会一路切到列表尽头。 */
const NOT_QUOTA_PATTERNS = [
  /context[_\s-]?(window|length)/i,
  /too[_\s-]?long/i,
  /maximum[_\s-]?context/i
]

export function isQuotaFailure(message?: string | null): boolean {
  if (!message) return false
  for (const pattern of NOT_QUOTA_PATTERNS) {
    if (pattern.test(message)) return false
  }
  for (const pattern of QUOTA_STATUS_PATTERNS) {
    if (pattern.test(message)) return true
  }
  return QUOTA_PHRASE_PATTERNS.some((pattern) => pattern.test(message))
}

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
 * 下一个可用候选。返回 null 表示不该切（未启用 / 非 auto 会话 / 都试过了）。
 */
export function resolveNextAutoFallbackTarget(sessionId: string): AutoFallbackTarget | null {
  const fallback = useSettingsStore.getState().providerFallback
  if (!fallback?.enabled || fallback.priority.length === 0) return null

  const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session || session.modelSelectionMode !== 'auto') return null

  const providerState = useProviderStore.getState()
  const providers = providerState.providers

  // 当前实际在用的服务商 —— auto 模式下它来自 auto 路由，不一定写在 session 上，
  // 所以走解析函数拿，失败的那个不能再排进候选。
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

  for (const id of fallback.priority) {
    if (skip.has(id)) continue
    const provider = providers.find((item) => item.id === id)
    if (!provider || !provider.enabled) continue
    if (provider.requiresApiKey !== false && !provider.apiKey) continue
    const modelId = pickFallbackModelId(provider, current.modelId)
    if (!modelId) continue
    return {
      providerId: id,
      modelId,
      providerName: provider.name,
      modelName: modelId,
      fromProviderName
    }
  }

  return null
}

/**
 * 模型怎么定：候选也有当前这个 id 就继续用它（行为完全一致），否则用它自己的
 * 默认模型，再否则第一个可用的对话模型。
 */
function pickFallbackModelId(provider: AIProvider, currentModelId?: string | null): string | null {
  const models = (provider.models ?? []).filter(
    (model) => model.enabled !== false && (model.category === undefined || model.category === 'chat')
  )
  if (currentModelId && models.some((model) => model.id === currentModelId)) return currentModelId
  if (provider.defaultModel && models.some((model) => model.id === provider.defaultModel)) {
    return provider.defaultModel
  }
  return models[0]?.id ?? null
}

/**
 * 落盘切换（等价于用户操作模型切换器），并把该候选记进本次链路。
 * 保持会话仍是 auto 模式 —— 下次失败还会继续往下切。
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
 * 一次 run 以限额错误收尾时的入口。
 *
 * 判定与取候选都是同步的（纯读 store），真正动手放在下一拍：error 事件是在
 * sendMessage 的流处理里收到的，当场再调 sendMessage 会重入同一条链路。
 */
export function scheduleAutoFallback(sessionId: string, errorMessage?: string | null): void {
  if (!isQuotaFailure(errorMessage)) return
  const target = resolveNextAutoFallbackTarget(sessionId)
  if (!target) return

  setTimeout(() => {
    void runAutoFallback(sessionId, target)
  }, 400)
}

async function runAutoFallback(sessionId: string, target: AutoFallbackTarget): Promise<void> {
  if (!applyAutoFallbackTarget(sessionId, target)) return

  toast.info(describeAutoFallbackSwitch(target.fromProviderName, target))

  const provider = useProviderStore.getState().providers.find((item) => item.id === target.providerId)
  if (!provider) return

  const chatStore = useChatStore.getState()
  const session = chatStore.sessions.find((item) => item.id === sessionId)
  if (!session) return

  // The follow-up turn must start with the same parameters a manual send uses.
  // Leaving them out makes the Worker guess: it infers scope from
  // projectId/workingFolder, forces collaborationMode to "chat" for a global run
  // and defaults toolPreset to "full" — so a project session would be pushed
  // forward without its project tools. See AgentRunContextPolicy / AgentLoop.
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
      toolPreset: session.collaborationMode === 'cowork' && workingFolder ? 'coding' : 'chat',
      workingFolder,
      sshConnectionId,
      projectId,
      scope: session.scope,
      collaborationMode: session.collaborationMode,
      runtimeRole: 'sessionAgent',
      permissionMode: session.permissionMode,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
      personaId: session.personaId ?? settings.defaultPersonaId ?? undefined,
      language: settings.language,
      userRules: settings.systemPrompt || undefined,
      contextCompressionEnabled: settings.contextCompressionEnabled,
      contextCompressionThreshold: settings.contextCompressionThreshold
    })
  } catch (error) {
    // 推进失败就到此为止 —— 不继续往下切，把报错留给用户自己决定。
    console.warn('[provider-auto-fallback] failed to continue after switching:', error)
  }
}
