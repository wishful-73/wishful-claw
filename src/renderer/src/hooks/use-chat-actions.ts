import { useCallback, useEffect } from 'react'
import {
  useChatStore,
  updateCompressionStatus,
  applyCompactArtifactsToSession,
  updateSessionContextTokens,
  type ChatStore
} from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useLiveCompressionStore } from '@renderer/stores/live-compression-store'
import { useActivityStore } from '@renderer/stores/activity-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { useTaskStore } from '@renderer/stores/task-store'
import { registerExternalChannelReply } from '@renderer/hooks/use-channel-auto-reply'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import { getCachedTools, fetchToolDefinitions, fetchToolDefinitionsAsync } from '@renderer/lib/tools/tool-cache'
import { compressMessages } from '@renderer/lib/agent/context-compression'
import type { CompressionStatusMeta, ContentBlock, ProviderConfig, UnifiedMessage } from '@renderer/lib/api/types'
import { imageAttachmentToContentBlock, type ImageAttachment } from '@renderer/lib/image-attachments'
import { getCompactSummaryDisplayText, isCompactSummaryLikeMessage } from '@renderer/lib/agent/context-compression'
import { buildSelectedFileContext } from '@renderer/lib/agent/selected-file-context'
import { expandPastedBlocks } from '@renderer/lib/select-file-tags'
import { buildProviderPayload } from '@renderer/lib/agent/provider-payload'

export interface SendMessageOptions {
  clearCompletedTasksOnTurnStart?: boolean
  enablePlanMode?: boolean
  sessionMode?: 'normal' | 'goal' | 'global' | 'channel'
  collaborationMode?: 'chat' | 'cowork'
  permissionMode?: 'default' | 'fullAccess'
  selectedFileReferences?: unknown[]
  imageEdit?: unknown
  toolPreset?: string
  [key: string]: unknown
}

interface SendMessageRequest {
  text: string | {
    text: string
    images?: unknown[]
    skill?: string | null
    selectedFiles?: unknown[]
  }
  images?: unknown[]
  sessionId?: string
  opts?: SendMessageOptions
  queuedDispatch?: boolean
  /**
   * iter-30 BUG-A：出队时原样重发的 store 级参数。
   *
   * 「全局会话给项目会话派任务」这类调用方走的是 store.sendMessage(params)，
   * 它的 params 里有 sessionMode:'goal' / maxIterations:0 这种 handleSendMessage
   * 从 SendMessageRequest 反推不出来的东西。只存 requestText 会静默降级成普通轮，
   * 所以整份 params 一起存下来，出队时优先走它。
   */
  rawParams?: Parameters<ChatStore['sendMessage']>[0]
}

type SendMessageHandler = (request: SendMessageRequest) => Promise<boolean>

const _sendMessageHandlers = new Set<SendMessageHandler>()
const _startingSessionSends = new Set<string>()
const _dispatchingPendingSessions = new Set<string>()
const _pausedPendingSessionDispatch = new Set<string>()

export function useChatActions() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelStream = useChatStore((s) => s.cancelStream)

  const handleSendMessage = useCallback(
    async ({ text, images: _images, sessionId, opts, queuedDispatch = false }: SendMessageRequest): Promise<boolean> => {
      const chatStore = useChatStore.getState()
      const targetSessionId = sessionId ?? chatStore.activeSessionId
      if (!targetSessionId) {
        console.error('[ChatActions] No active session')
        return false
      }

      const request: SendMessageRequest = { text, images: _images, sessionId: targetSessionId, opts }
      if (
        hasActiveSessionRunForSession(targetSessionId) ||
        (!queuedDispatch && hasPendingSessionMessagesForSession(targetSessionId))
      ) {
        if (!queuedDispatch) enqueuePendingSessionMessage(request, targetSessionId)
        return false
      }

      _startingSessionSends.add(targetSessionId)
      try {
      // Resolve provider/model through the same session-aware path the UI
      // displays (ModelSwitcher / InputArea). Previously this read the global
      // provider store directly, so a session-bound model switch updated the
      // UI but the request still went out with the stale global model.
      const settingsStore = useSettingsStore.getState()
      const resolved = resolveSendModel(targetSessionId)
      if (!resolved) {
        console.error('[ChatActions] No provider/model selected')
        pausePendingSessionDispatch(targetSessionId)
        return false
      }
      const activeProvider = resolved.provider
      const modelId = resolved.modelId

      // Clear activities for new turn
      useActivityStore.getState().clearActivities()

      // OpenCowork semantics: at the start of a fresh normal turn, wipe the
      // session's agent Todos only when every task is already completed.
      // Incomplete / blocked / in-review Todos must survive across turns;
      // queued dispatches and special paths (continue/team/subagent) never clear.
      if (opts?.clearCompletedTasksOnTurnStart && !queuedDispatch) {
        const taskStore = useTaskStore.getState()
        const sessionTasks = taskStore.getTasksBySession(targetSessionId)
        if (sessionTasks.length > 0 && sessionTasks.every((t) => t.status === 'completed')) {
          taskStore.deleteSessionTasks(targetSessionId)
        }
      }

      // Get session's working folder — fall back to project's workingFolder
      const session = chatStore.sessions.find((s) => s.id === targetSessionId)
      // Channel-bound session: every reply echoes back to the external chat
      // (Feishu/Weixin), regardless of whether the turn was triggered by an
      // inbound channel message, a manual message here, or a scheduled task.
      if (session?.pluginId && session?.externalChatId) {
        registerExternalChannelReply(targetSessionId, session.pluginId, session.externalChatId)
      }
      if (!session) {
        console.error('[ChatActions] Target session does not exist:', targetSessionId)
        return false
      }
      const isChannelSession = Boolean(session.pluginId && session.externalChatId)
      const projectId = session.scope === 'project' ? session.projectId : undefined
      const project = projectId ? chatStore.projects.find((p) => p.id === projectId) : null
      const workingFolder = session.scope === 'project'
        ? session.workingFolder ?? project?.workingFolder ?? undefined
        : undefined
      const sshConnectionId = session.scope === 'project'
        ? session.sshConnectionId ?? project?.sshConnectionId ?? undefined
        : undefined
      console.log('[ChatActions] sshConnectionId:', { session: session?.sshConnectionId, project: project?.sshConnectionId, resolved: sshConnectionId, projectId })

      // Backend manages the session conversation (Reasonix pattern).
      // Frontend only sends the new user message; the backend appends
      // it to the in-memory session and handles all history.

      // Tool definitions: use whatever is already cached/registered.
      // App startup (registerAllTools + ensureConversationReady) handles
      // initialization; if tools aren't ready yet, send without them —
      // the agent can still respond, just without tool-calling capability.
      const toolPreset = opts?.toolPreset ??
        (isChannelSession
          ? 'channel'
          : session.collaborationMode === 'cowork' && workingFolder ? 'coding' : 'chat')
      const settings = settingsStore
      const codegraphEnabled = useAppPluginStore.getState().isCodeGraphToolAvailable()

      // For special presets (e.g. skill-installer), fetch async to ensure
      // the correct tool list is used. For default presets, use cache + background fetch.
      // 发给 LLM 的工具清单由 Worker 侧 ToolPreset 决定（渲染端只负责预热/刷新缓存）；
      // 渲染端注册的 handler 仍可按名字执行，只是定义不下发。
      if (opts?.toolPreset) {
        await fetchToolDefinitionsAsync(opts.toolPreset)
      } else {
        getCachedTools()
        fetchToolDefinitions(toolPreset) // fire-and-forget background fetch
      }

      const messageText = typeof text === 'string' ? text : text.text
      const imageAttachments = Array.isArray(_images)
        ? _images as ImageAttachment[]
        : typeof text !== 'string' && Array.isArray(text.images)
          ? text.images as ImageAttachment[]
          : []
      const imageBlocks: ContentBlock[] = imageAttachments.map(imageAttachmentToContentBlock)

      // Resolve thinking config from the model definition
      const modelConfig = activeProvider.models.find((m: any) => m.id === modelId)

      // 注入挂在「文本 → userContent」这一步：排队消息重放把原文存进
      // PendingSessionMessageItem 后出队仍回到本函数，挂在 composer 侧会漏注入。
      const selectedFileContext = await buildSelectedFileContext({
        text: messageText,
        workingFolder,
        sshConnectionId,
        modelConfig
      })
      // 读盘结果只进发给模型的内容；落库与气泡用 messageText，
      // 经下面的 userMessageText 传给 store，避免 `<system-reminder>` 污染 DB 文本。
      // T-13: messageText 保留 `<pasted-block>` 标签（聊天窗要按 chip 渲染），
      // 所以发给模型前必须展开回原文 —— 模型收到的仍是全文，不因折叠丢内容。
      const modelSourceText = expandPastedBlocks(messageText)
      const modelText = selectedFileContext.contextText
        ? `${modelSourceText}\n\n${selectedFileContext.contextText}`
        : modelSourceText
      const userContent: string | ContentBlock[] = imageBlocks.length > 0
        ? [{ type: 'text', text: modelText }, ...imageBlocks]
        : modelText

      // The provider payload — including the thinking flags — is built in one
      // place; see lib/agent/provider-payload.ts.
      const provider = buildProviderPayload(activeProvider, modelId, settings)

      const started = await sendMessage({
        provider,
        messages: [{ role: 'user', content: userContent }],
        userMessageText: messageText,
        ...(selectedFileContext.meta ? { meta: { selectedFileReads: selectedFileContext.meta } } : {}),
        sessionId: targetSessionId,
        toolPreset,
        codegraphEnabled,
        workingFolder,
        maxIterations: 0, // 0 = unlimited, agent runs until no more tool calls
        maxParallelTools: settings.maxParallelToolCalls,
        maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
        personaId: session?.personaId ?? settings.defaultPersonaId ?? undefined,
        language: settings.language,
        userRules: settings.systemPrompt || undefined,
        contextCompressionEnabled: settings.contextCompressionEnabled,
        contextCompressionThreshold: settings.contextCompressionThreshold,
        sshConnectionId,
        projectId,
        scope: session.scope,
        collaborationMode: session.collaborationMode,
        runtimeRole: opts?.sessionMode === 'goal' ? 'goalRunner' : 'sessionAgent',
        ...(opts?.enablePlanMode && !isChannelSession ? { enablePlanMode: true } : {}),
        sessionMode: isChannelSession ? 'channel' as const : opts?.sessionMode,
        permissionMode: isChannelSession ? 'default' as const : session.permissionMode,
        ...(isChannelSession ? {
          pluginId: session.pluginId,
          pluginType: session.pluginType,
          pluginChatId: session.externalChatId,
          channelSession: true
        } : {})
      })
      if (!started) pausePendingSessionDispatch(targetSessionId)
      return started
      } catch (error) {
        console.error('[ChatActions] Failed to send message', error)
        pausePendingSessionDispatch(targetSessionId)
        return false
      } finally {
        _startingSessionSends.delete(targetSessionId)
      }
    },
    [sendMessage]
  )

  useEffect(() => {
    _sendMessageHandlers.add(handleSendMessage)
    return () => {
      _sendMessageHandlers.delete(handleSendMessage)
    }
  }, [handleSendMessage])

  const stopStreaming = useCallback(async () => {
    const sessionId = useChatStore.getState().activeSessionId
    if (sessionId) pausePendingSessionDispatch(sessionId)
    await cancelStream()
  }, [cancelStream])

  return {
    sendMessage: handleSendMessage,
    stopStreaming
  }
}

export function abortSession(sessionId: string): void {
  const store = useChatStore.getState()
  store.setStreamingMessageId(sessionId, null)
}

export function clearPendingSessionMessages(sessionId: string): number {
  const count = _pendingMessages.get(sessionId)?.length ?? 0
  if (count === 0 && !_pausedPendingSessionDispatch.has(sessionId)) return 0
  _pendingMessages.delete(sessionId)
  _pausedPendingSessionDispatch.delete(sessionId)
  notifyPendingSessionMessageListeners()
  return count
}

export function getPendingSessionMessageCountForSession(sessionId: string): number {
  return _pendingMessages.get(sessionId)?.length ?? 0
}

export function subscribePendingSessionMessages(onStoreChange: () => void): () => void {
  _pendingListeners.add(onStoreChange)
  return () => { _pendingListeners.delete(onStoreChange) }
}

// Shared provider type used by the send paths (buildProviderPayload's input).
type SendProvider = NonNullable<ReturnType<ReturnType<typeof useProviderStore.getState>['getActiveProvider']>>

// Resolve the provider/model a send will actually use, mirroring exactly what
// the UI displays (ModelSwitcher / InputArea via resolveSessionModelSelection).
// Session-bound model switches used to update only the UI while sends kept
// reading the global provider store, so requests went out with the stale
// global model. Returns null when no usable provider/model exists.
export function resolveSendModel(sessionId: string): { provider: SendProvider; modelId: string } | null {
  const providerStore = useProviderStore.getState()
  const chatStore = useChatStore.getState()
  const settings = useSettingsStore.getState()
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  const channel = session?.pluginId
    ? (useChannelStore.getState().channels.find((c) => c.id === session.pluginId) ?? null)
    : null
  const selection = resolveSessionModelSelection({
    session,
    providers: providerStore.providers,
    activeProviderId: providerStore.activeProviderId,
    activeModelId: providerStore.activeModelId,
    globalMode: settings.mainModelSelectionMode,
    channelProviderId: channel?.providerId,
    channelModelId: channel?.model
  })
  const resolvedProviderId = selection.providerId
  let resolvedModelId: string | null = selection.modelId
  let provider = resolvedProviderId
    ? (providerStore.providers.find((p) => p.id === resolvedProviderId) ?? null)
    : null
  if (!provider) {
    provider = providerStore.getActiveProvider() ?? null
    // Fell back to the global provider — realign the model with it too
    resolvedModelId = null
  }
  if (!provider) return null
  const modelId = resolvedModelId
    || providerStore.activeModelId
    || provider.defaultModel
    || provider.models.find((m: any) => m.enabled)?.id
  if (!modelId) return null
  return { provider, modelId }
}

// The provider payload sent to agent/run is built in exactly one place — see
// lib/agent/provider-payload.ts for what it contains and why. Re-exported here
// because existing callers (cron-runtime, goal-session-views, the background
// sub-agent wakeup) import it from this module.
export { buildProviderPayload }

export async function sendImplementPlan(sessionId: string, planId: string): Promise<void> {
  const planStore = (await import('@renderer/stores/plan-store')).usePlanStore.getState()
  const uiStore = (await import('@renderer/stores/ui-store')).useUIStore.getState()
  const chatStore = useChatStore.getState()
  const settingsStore = (await import('@renderer/stores/settings-store')).useSettingsStore.getState()

  const plan = planStore.plans[planId]
  if (!plan || plan.status !== 'awaiting_review') return

  // Approve plan
  planStore.approvePlan(planId)
  planStore.beginImplementation(planId)

  // Exit plan mode
  uiStore.exitPlanMode(sessionId)

  // Get provider and session info — session-aware, same resolution the UI shows
  const resolved = resolveSendModel(sessionId)
  if (!resolved) return
  const { provider: activeProvider, modelId } = resolved
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) return
  const workingFolder = session.scope === 'project' ? session.workingFolder ?? undefined : undefined
  const sshConnectionId = session.scope === 'project' ? session.sshConnectionId ?? undefined : undefined
  const projectId = session.scope === 'project' ? session.projectId ?? undefined : undefined

  // Clear activities for new turn
  useActivityStore.getState().clearActivities()

  // Build provider the same way handleSendMessage does
  const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

  // Send implementation message
  await chatStore.sendMessage({
    provider,
    messages: [{ role: 'user', content: `The plan has been approved. The plan file is at: ${plan.filePath ?? '(unknown path)'}. Read the plan file, then execute it step by step using the Task tool to dispatch sub-agents -- do NOT implement steps yourself. For each step: (1) call UpdatePlanStep to mark it in_progress, (2) use the Task tool with subagent_type "custom" and background=false to dispatch a foreground work sub-agent with a self-contained prompt containing all context needed for that step, (3) when the sub-agent returns, call UpdatePlanStep to mark it completed or failed based on the result. If a step fails, assess whether the remaining plan needs adjustment before continuing.` }],
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
    maxParallelTools: settingsStore.maxParallelToolCalls,
    maxConcurrentSubAgents: settingsStore.maxConcurrentSubAgents,
    personaId: session?.personaId ?? settingsStore.defaultPersonaId ?? undefined,
    language: settingsStore.language,
    userRules: settingsStore.systemPrompt || undefined,
    contextCompressionEnabled: settingsStore.contextCompressionEnabled,
    contextCompressionThreshold: settingsStore.contextCompressionThreshold
  })
}

export async function sendPlanRevision(sessionId: string, planId: string, feedback: string): Promise<void> {
  const planStore = (await import('@renderer/stores/plan-store')).usePlanStore.getState()
  const uiStore = (await import('@renderer/stores/ui-store')).useUIStore.getState()
  const chatStore = useChatStore.getState()
  const settingsStore = (await import('@renderer/stores/settings-store')).useSettingsStore.getState()

  const plan = planStore.plans[planId]
  if (!plan) return

  // Reject plan
  planStore.rejectPlan(planId)

  // Re-enter plan mode for revision
  uiStore.enterPlanMode(sessionId)

  // Get provider and session info — session-aware, same resolution the UI shows
  const resolved = resolveSendModel(sessionId)
  if (!resolved) return
  const { provider: activeProvider, modelId } = resolved
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) return
  const workingFolder = session.scope === 'project' ? session.workingFolder ?? undefined : undefined
  const sshConnectionId = session.scope === 'project' ? session.sshConnectionId ?? undefined : undefined
  const projectId = session.scope === 'project' ? session.projectId ?? undefined : undefined

  // Clear activities for new turn
  useActivityStore.getState().clearActivities()

  // Build provider the same way handleSendMessage does
  const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

  // Send rejection feedback
  await chatStore.sendMessage({
    provider,
    messages: [{ role: 'user', content: `The plan was rejected. The plan file is at: ${plan.filePath ?? '(unknown path)'}. Please revise the plan in the plan file based on this feedback: ${feedback}` }],
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
    maxParallelTools: settingsStore.maxParallelToolCalls,
    maxConcurrentSubAgents: settingsStore.maxConcurrentSubAgents,
    personaId: session?.personaId ?? settingsStore.defaultPersonaId ?? undefined,
    language: settingsStore.language,
    userRules: settingsStore.systemPrompt || undefined,
    contextCompressionEnabled: settingsStore.contextCompressionEnabled,
    contextCompressionThreshold: settingsStore.contextCompressionThreshold,
    enablePlanMode: true
  })
}

/**
 * Exit plan mode — called when user clicks "Exit Plan Mode" on the banner.
 *
 * Two scenarios:
 * 1. Agent is actively streaming (exploring / planning / executing) —
 *    no pending reverse request. We must cancel the agent loop first,
 *    then send a user message so the agent knows the plan was cancelled.
 * 2. Agent is waiting for plan review (SubmitPlanReview reverse request
 *    pending) — cancelPlanReview resolves the reverse request with
 *    cancelled=true. The agent loop resumes and gets the cancellation.
 *    No new message needed — the agent handles it.
 */
export async function exitPlanMode(sessionId: string | null): Promise<void> {
  if (!sessionId) return

  const uiStore = (await import('@renderer/stores/ui-store')).useUIStore.getState()
  const planStore = (await import('@renderer/stores/plan-store')).usePlanStore.getState()

  // 1. Cancel any pending plan review reverse request
  const plan = planStore.getPlanBySession(sessionId)
  if (plan) {
    const { cancelPlanReview } = await import('@renderer/lib/tools/plan-native-ui')
    cancelPlanReview(sessionId)
  }

  // 2. Exit plan mode UI (remove banner)
  uiStore.exitPlanMode(sessionId)

  // 3. If agent is streaming, cancel the loop and send a message
  const chatStore = useChatStore.getState()
  const wasStreaming = !!chatStore.streamingMessageId

  if (wasStreaming) {
    // Cancel the running agent loop
    await chatStore.cancelStream()

    // Send a user message so the agent knows the plan was cancelled
    const providerStore = (await import('@renderer/stores/provider-store')).useProviderStore.getState()
    const settingsStore = (await import('@renderer/stores/settings-store')).useSettingsStore.getState()
    const activeProvider = providerStore.getActiveProvider()
    if (!activeProvider) return
    const modelId = providerStore.activeModelId || activeProvider.defaultModel || activeProvider.models.find((m: any) => m.enabled)?.id
    if (!modelId) return
    const session = chatStore.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const workingFolder = session.scope === 'project' ? session.workingFolder ?? undefined : undefined
    const sshConnectionId = session.scope === 'project' ? session.sshConnectionId ?? undefined : undefined
    const projectId = session.scope === 'project' ? session.projectId ?? undefined : undefined

    useActivityStore.getState().clearActivities()

    const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

    await chatStore.sendMessage({
      provider,
      messages: [{ role: 'user', content: '用户退出了计划模式，计划已取消。不再需要计划流程，请正常对话。' }],
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
      maxParallelTools: settingsStore.maxParallelToolCalls,
      maxConcurrentSubAgents: settingsStore.maxConcurrentSubAgents,
      personaId: session?.personaId ?? settingsStore.defaultPersonaId ?? undefined,
      language: settingsStore.language,
      userRules: settingsStore.systemPrompt || undefined,
      contextCompressionEnabled: settingsStore.contextCompressionEnabled,
      contextCompressionThreshold: settingsStore.contextCompressionThreshold
    })
  }
}

export async function sendImplementPlanInNewSession(_projectId: string | null, _planId: string): Promise<void> {
  // TODO: implement plan execution in new session
}

// === Additional exports needed by WishfulClaw InputArea ===

export interface PendingSessionMessageItem {
  id: string
  sessionId: string
  role: 'user'
  content: string
  text: string
  command?: { name: string; content: string } | null
  images: import('@renderer/lib/image-attachments').ImageAttachment[]
  skill?: string | null
  selectedFiles?: unknown[]
  opts?: SendMessageOptions
  requestText: string | {
    text: string
    images?: unknown[]
    skill?: string | null
    selectedFiles?: unknown[]
  }
  createdAt: number
  draft?: string
  /** 见 SendMessageRequest.rawParams —— 有它时出队直接重放这份参数。 */
  rawParams?: Parameters<ChatStore['sendMessage']>[0]
}

export type ManualCompressionResult = 'compressed' | 'skipped' | 'blocked' | 'restore_failed' | 'failed'

/**
 * Manual context compression for a session (floating block / ContextRing entry).
 * The Worker compresses its own authoritative conversation, rebuilding it from the
 * DB first when the Worker is cold — so a compression right after an app restart
 * works on the full context instead of the renderer's paged transcript.
 * Returns an explicit status so the UI can distinguish compressed / skipped /
 * blocked / restore_failed / failed instead of collapsing everything into an error.
 */
export async function compressSessionContext(sessionId: string): Promise<ManualCompressionResult> {
  const chatStore = useChatStore.getState()
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) return 'blocked'

  const operationId = `manual:${sessionId}:${Date.now()}`
  const startedAt = Date.now()
  const updateStatus = (meta: CompressionStatusMeta): void => {
    updateCompressionStatus(sessionId, meta, operationId)
    if (meta.state !== 'compressing') {
      useLiveCompressionStore.getState().clear(sessionId)
    }
  }
  useLiveCompressionStore.getState().start(sessionId, { trigger: 'manual' })
  updateStatus({ operationId, state: 'compressing', startedAt, trigger: 'manual' })

  // Never compress while the session has an active run — the Worker would
  // reject it too, but checking here gives instant feedback without a round trip.
  if (chatStore.streamingMessages[sessionId]) {
    updateStatus({
      operationId,
      state: 'blocked',
      startedAt,
      completedAt: Date.now(),
      trigger: 'manual',
      error: 'session has an active agent run'
    })
    return 'blocked'
  }

  // No local "transcript is empty" gate: the Worker rebuilds the session's
  // authoritative conversation from the DB when it is cold, and the renderer
  // transcript is only a paged slice of it.
  const resolved = resolveSendModel(sessionId)
  if (!resolved) {
    updateStatus({
      operationId,
      state: 'blocked',
      startedAt,
      completedAt: Date.now(),
      trigger: 'manual',
      error: 'no provider or model selected'
    })
    return 'blocked'
  }

  const settingsStore = useSettingsStore.getState()
  const providerPayload = buildProviderPayload(resolved.provider, resolved.modelId, settingsStore)
  const modelConfig = resolved.provider.models.find((m: any) => m.id === resolved.modelId)
  const provider = {
    ...providerPayload,
    contextLength: modelConfig?.contextLength ?? undefined
  } as unknown as ProviderConfig

  // Only consumed by the Worker when the request carries no sessionId; a session
  // request compresses the conversation the Worker restores from the DB.
  const fallbackMessages: UnifiedMessage[] = (session.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content ?? m.text ?? '',
    createdAt: m.createdAt,
    ...(m.meta ? { meta: m.meta } : {})
  }))

  try {
    const { result, compactArtifacts } = await compressMessages(
      fallbackMessages,
      provider,
      undefined,
      0,
      undefined,
      undefined,
      'manual',
      0,
      sessionId,
      settingsStore.contextCompressionThreshold
    )
    const status = result.status ?? (result.compressed ? 'compressed' : 'skipped')
    if (status === 'compressed') {
      const summaryArtifact = compactArtifacts?.find((artifact) =>
        isCompactSummaryLikeMessage(artifact)
      )
      const now = Date.now()
      if (compactArtifacts?.length) {
        applyCompactArtifactsToSession(sessionId, compactArtifacts, operationId)
      }
      updateStatus({
        operationId,
        state: 'compressed',
        startedAt,
        completedAt: now,
        trigger: result.trigger ?? 'manual',
        originalCount: result.originalCount,
        newCount: result.newCount,
        preTokens: result.estimatedPreTokens,
        ...(typeof result.messagesSummarized === 'number'
          ? { messagesSummarized: result.messagesSummarized }
          : {}),
        ...(result.summarizerFailed ? { summarizerFailed: true } : {}),
        ...(summaryArtifact
          ? {
              summaryText: getCompactSummaryDisplayText(summaryArtifact).trim(),
              summaryMessageId: summaryArtifact.id
            }
          : {})
      })
      // Manual compression emits no message_end event — refresh the last
      // usage-bearing message's contextTokens so ContextRing updates now
      // instead of after the next turn.
      if (typeof result.estimatedNewTokens === 'number' && result.estimatedNewTokens > 0) {
        updateSessionContextTokens(sessionId, result.estimatedNewTokens)
      }
      return 'compressed'
    }
    const terminalState = status === 'blocked'
      ? 'blocked'
      : status === 'cancelled'
        ? 'cancelled'
        : status === 'skipped'
          ? 'skipped'
          : 'failed'
    updateStatus({
      operationId,
      state: terminalState,
      startedAt,
      completedAt: Date.now(),
      trigger: result.trigger ?? 'manual',
      originalCount: result.originalCount,
      newCount: result.newCount,
      preTokens: result.estimatedPreTokens,
      ...(result.error ? { error: result.error } : {})
    })
    if (status === 'blocked') {
      // The card keeps the generic blocked state; the entry control needs to know
      // this one specifically means "the Worker cannot rebuild this context".
      return result.reason === 'restore_failed' ? 'restore_failed' : 'blocked'
    }
    if (status === 'skipped' || status === 'cancelled') return 'skipped'
    console.warn('[ChatActions] Manual compression failed', result.error)
    return 'failed'
  } catch (error) {
    console.error('[ChatActions] Manual compression error', error)
    updateStatus({
      operationId,
      state: 'failed',
      startedAt,
      completedAt: Date.now(),
      trigger: 'manual',
      error: error instanceof Error ? error.message : 'compression failed'
    })
    return 'failed'
  }
}

const _pendingMessages = new Map<string, PendingSessionMessageItem[]>()
const _pendingListeners = new Set<() => void>()

function notifyPendingSessionMessageListeners(): void {
  _pendingListeners.forEach((listener) => listener())
}

function getRequestText(request: SendMessageRequest): {
  text: string
  images: unknown[]
  skill?: string | null
  selectedFiles?: unknown[]
} {
  if (typeof request.text === 'string') {
    return { text: request.text, images: request.images ?? [] }
  }
  return {
    text: request.text.text,
    images: request.images ?? request.text.images ?? [],
    skill: request.text.skill,
    selectedFiles: request.text.selectedFiles
  }
}

export function enqueuePendingSessionMessage(request: SendMessageRequest, sessionId: string): void {
  const normalized = getRequestText(request)
  const now = Date.now()
  const item: PendingSessionMessageItem = {
    id: `pending-${now}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    role: 'user',
    content: normalized.text,
    text: normalized.text,
    images: normalized.images as import('@renderer/lib/image-attachments').ImageAttachment[],
    skill: normalized.skill,
    selectedFiles: normalized.selectedFiles,
    opts: request.opts ? { ...request.opts } : undefined,
    requestText: typeof request.text === 'string' ? request.text : { ...request.text },
    createdAt: now,
    ...(request.rawParams ? { rawParams: request.rawParams } : {})
  }
  const list = _pendingMessages.get(sessionId) ?? []
  _pendingMessages.set(sessionId, [...list, item])
  notifyPendingSessionMessageListeners()
}

export function getPendingSessionMessages(sessionId: string): PendingSessionMessageItem[] {
  return _pendingMessages.get(sessionId) ?? []
}

export function isPendingSessionDispatchPaused(sessionId: string): boolean {
  return _pausedPendingSessionDispatch.has(sessionId)
}

export function pausePendingSessionDispatch(sessionId: string): void {
  if ((_pendingMessages.get(sessionId)?.length ?? 0) === 0) return
  if (_pausedPendingSessionDispatch.has(sessionId)) return
  _pausedPendingSessionDispatch.add(sessionId)
  notifyPendingSessionMessageListeners()
}

export function removePendingSessionMessage(sessionId: string, messageId: string): boolean {
  const list = _pendingMessages.get(sessionId) ?? []
  const filtered = list.filter((message) => message.id !== messageId)
  if (filtered.length === list.length) return false
  if (filtered.length > 0) _pendingMessages.set(sessionId, filtered)
  else {
    _pendingMessages.delete(sessionId)
    _pausedPendingSessionDispatch.delete(sessionId)
  }
  notifyPendingSessionMessageListeners()
  return true
}

export function updatePendingSessionMessageDraft(
  sessionId: string,
  messageId: string,
  draft: unknown
): void {
  const list = _pendingMessages.get(sessionId) ?? []
  const index = list.findIndex((message) => message.id === messageId)
  if (index < 0) return

  const current = list[index]
  let text = current.text
  let images = current.images
  let command = current.command
  if (typeof draft === 'string') {
    text = draft
  } else if (draft && typeof draft === 'object') {
    const nextDraft = draft as { text?: string; images?: unknown[]; command?: unknown }
    text = nextDraft.text ?? ''
    images = (nextDraft.images ?? current.images) as import('@renderer/lib/image-attachments').ImageAttachment[]
    command = (nextDraft.command ?? current.command) as PendingSessionMessageItem['command']
  }

  const requestText = typeof current.requestText === 'string'
    ? text
    : { ...current.requestText, text, images }
  const updated: PendingSessionMessageItem = {
    ...current,
    content: text,
    text,
    images: [...images],
    command,
    requestText,
    draft: text
  }
  _pendingMessages.set(sessionId, [
    ...list.slice(0, index),
    updated,
    ...list.slice(index + 1)
  ])
  notifyPendingSessionMessageListeners()
}

export function quotePendingSessionMessageIntoConversation(
  _sessionId: string,
  _messageId: string
): false {
  return false
}

export function dispatchNextQueuedMessageForSession(
  sessionId: string,
  resumePaused = true
): boolean {
  if (_dispatchingPendingSessions.has(sessionId)) return false
  if (_pausedPendingSessionDispatch.has(sessionId)) {
    if (!resumePaused || hasActiveSessionRunForSession(sessionId)) return false
    _pausedPendingSessionDispatch.delete(sessionId)
    notifyPendingSessionMessageListeners()
  }
  if (hasActiveSessionRunForSession(sessionId)) return false
  const head = _pendingMessages.get(sessionId)?.[0]
  if (!head) return false
  // rawParams 项出队走 store.sendMessage，不经过 handleSendMessage，所以没挂载
  // InputArea 时也能出队 —— 跨会话派发的队列不该被 UI 挂载状态卡住。
  if (!head.rawParams && _sendMessageHandlers.size === 0) {
    pausePendingSessionDispatch(sessionId)
    return false
  }

  _dispatchingPendingSessions.add(sessionId)
  setTimeout(async () => {
    let retryAfterDelay = false
    try {
      if (_pausedPendingSessionDispatch.has(sessionId)) return
      if (hasActiveSessionRunForSession(sessionId)) {
        retryAfterDelay = true
        return
      }
      const item = _pendingMessages.get(sessionId)?.[0]
      const handler = Array.from(_sendMessageHandlers).at(-1)
      if (!item) return
      // rawParams 项原样重放 store 级参数（跨会话派发带着 sessionMode / maxIterations
      // 这类 handleSendMessage 表达不出的东西）；其余仍走 handler 重新解析。
      const started = item.rawParams
        ? await useChatStore.getState().sendMessage(item.rawParams)
        : handler
          ? await handler({
              text: item.requestText,
              images: item.images,
              sessionId,
              opts: item.opts,
              queuedDispatch: true
            })
          : false
      if (!started) {
        pausePendingSessionDispatch(sessionId)
        return
      }
      const current = _pendingMessages.get(sessionId) ?? []
      if (current[0]?.id === item.id) {
        const remaining = current.slice(1)
        if (remaining.length > 0) _pendingMessages.set(sessionId, remaining)
        else _pendingMessages.delete(sessionId)
        notifyPendingSessionMessageListeners()
      }
    } catch (error) {
      console.error('[ChatActions] Failed to dispatch queued message', error)
      pausePendingSessionDispatch(sessionId)
    } finally {
      _dispatchingPendingSessions.delete(sessionId)
      const hasPending = (_pendingMessages.get(sessionId)?.length ?? 0) > 0
      if (
        hasPending &&
        !_pausedPendingSessionDispatch.has(sessionId) &&
        (retryAfterDelay || !hasActiveSessionRunForSession(sessionId))
      ) {
        setTimeout(() => dispatchNextQueuedMessageForSession(sessionId, false), 50)
      }
    }
  }, 50)
  return true
}

export function hasActiveSessionRunForSession(sessionId: string): boolean {
  if (_startingSessionSends.has(sessionId)) return true
  if (useChatStore.getState().streamingMessages[sessionId]) return true
  const status = useAgentStore.getState().runningSessions[sessionId]
  return status === 'running' || status === 'retrying'
}

export function hasPendingSessionMessagesForSession(sessionId: string): boolean {
  return (_pendingMessages.get(sessionId)?.length ?? 0) > 0
}

export function resetTeamAutoTrigger(): void {}

export function stopSessionStreaming(sessionId: string): void {
  abortSession(sessionId)
}
