import { useCallback } from 'react'
import {
  useChatStore,
  recordCompressionStatusMessage,
  applyCompactArtifactsToSession
} from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useActivityStore } from '@renderer/stores/activity-store'
import { useSettingsStore, resolveReasoningEffortForModel } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { registerExternalChannelReply } from '@renderer/hooks/use-channel-auto-reply'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import { getCachedTools, fetchToolDefinitions, fetchToolDefinitionsAsync, type CachedToolDef } from '@renderer/lib/tools/tool-cache'
import { compressMessages } from '@renderer/lib/agent/context-compression'
import type { ProviderConfig, UnifiedMessage } from '@renderer/lib/api/types'

export interface SendMessageOptions {
  clearCompletedTasksOnTurnStart?: boolean
  enablePlanMode?: boolean
  sessionMode?: 'normal' | 'goal' | 'global'
  selectedFileReferences?: unknown[]
  imageEdit?: unknown
  toolPreset?: string
  [key: string]: unknown
}


export function useChatActions() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelStream = useChatStore((s) => s.cancelStream)

  const handleSendMessage = useCallback(
    async ({ text, images: _images, sessionId, opts }: { text: string | { text: string; images?: unknown[]; skill?: string | null; selectedFiles?: unknown[] }; images?: unknown[]; sessionId?: string; opts?: SendMessageOptions }) => {
      const chatStore = useChatStore.getState()
      const targetSessionId = sessionId ?? chatStore.activeSessionId
      if (!targetSessionId) {
        console.error('[ChatActions] No active session')
        return
      }

      // Resolve provider/model through the same session-aware path the UI
      // displays (ModelSwitcher / InputArea). Previously this read the global
      // provider store directly, so a session-bound model switch updated the
      // UI but the request still went out with the stale global model.
      const settingsStore = useSettingsStore.getState()
      const resolved = resolveSendModel(targetSessionId)
      if (!resolved) {
        console.error('[ChatActions] No provider/model selected')
        return
      }
      const activeProvider = resolved.provider
      const modelId = resolved.modelId

      // Clear activities for new turn
      useActivityStore.getState().clearActivities()

      // Get session's working folder — fall back to project's workingFolder
      const session = chatStore.sessions.find((s) => s.id === targetSessionId)
      // Channel-bound session: every reply echoes back to the external chat
      // (Feishu/Weixin), regardless of whether the turn was triggered by an
      // inbound channel message, a manual message here, or a scheduled task.
      if (session?.pluginId && session?.externalChatId) {
        registerExternalChannelReply(targetSessionId, session.pluginId, session.externalChatId)
      }
      const projectId = session?.projectId
      const project = projectId ? chatStore.projects.find((p) => p.id === projectId) : null
      const workingFolder = session?.workingFolder ?? project?.workingFolder ?? undefined
      const sshConnectionId = session?.sshConnectionId ?? project?.sshConnectionId ?? undefined
      console.log('[ChatActions] sshConnectionId:', { session: session?.sshConnectionId, project: project?.sshConnectionId, resolved: sshConnectionId, projectId })

      // Backend manages the session conversation (Reasonix pattern).
      // Frontend only sends the new user message; the backend appends
      // it to the in-memory session and handles all history.

      // Tool definitions: use whatever is already cached/registered.
      // App startup (registerAllTools + ensureConversationReady) handles
      // initialization; if tools aren't ready yet, send without them —
      // the agent can still respond, just without tool-calling capability.
      const toolPreset = opts?.toolPreset ?? (workingFolder ? 'coding' : 'chat')
      const settings = settingsStore
      const codegraphEnabled = useAppPluginStore.getState().isCodeGraphToolAvailable()

      // For special presets (e.g. skill-installer), fetch async to ensure
      // the correct tool list is used. For default presets, use cache + background fetch.
      let workerTools: CachedToolDef[] | null
      if (opts?.toolPreset) {
        workerTools = await fetchToolDefinitionsAsync(opts.toolPreset)
      } else {
        workerTools = getCachedTools()
        fetchToolDefinitions(toolPreset) // fire-and-forget background fetch
      }
      // Filter out WebSearch/WebFetch when web search is not enabled.
      const webSearchEnabled = settings.webSearchEnabled
      const filteredWorkerTools = (workerTools ?? []).filter(
        (t) => webSearchEnabled || (t.name !== 'WebSearch' && t.name !== 'WebFetch')
      )
      // Use only the Worker's preset-filtered tool list.
      // Renderer-registered tool handlers are still available for execution
      // (toolRegistry.get() works by name), but their definitions are NOT
      // sent to the LLM — this keeps the tool list lean and lets the Worker's
      // ToolPreset control what the LLM sees.
      void filteredWorkerTools // tools now managed by backend via toolPreset

      const userContent = text

      // Resolve thinking config from the model definition
      const modelConfig = activeProvider.models.find((m: any) => m.id === modelId)
      const thinkingConfig = modelConfig?.thinkingConfig
      const thinkingEnabled = settings.thinkingEnabled && !!thinkingConfig
      const reasoningEffort = thinkingConfig
        ? resolveReasoningEffortForModel({
            reasoningEffort: settings.reasoningEffort,
            reasoningEffortByModel: settings.reasoningEffortByModel,
            providerId: activeProvider.id,
            modelId,
            thinkingConfig
          })
        : undefined

      const provider = {
        id: activeProvider.id,
        name: activeProvider.name,
        type: activeProvider.type,
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: modelId,
        contextLength: modelConfig?.contextLength ?? undefined,
        temperature: settings.temperature ?? undefined,
        maxTokens: settings.maxTokens ?? undefined,
        thinkingEnabled,
        thinkingConfig: thinkingConfig ?? undefined,
        reasoningEffort,
        requestTimeoutSeconds: settings.apiRequestTimeoutSeconds ?? undefined,
        requestMaxRetries: settings.requestMaxRetries ?? undefined
      }

      await sendMessage({
        provider,
        messages: [{ role: 'user', content: userContent }],
        sessionId: targetSessionId,
        toolPreset,
        webSearchEnabled,
        codegraphEnabled,
        workingFolder,
        maxIterations: 0, // 0 = unlimited, agent runs until no more tool calls
        maxParallelTools: settings.maxParallelToolCalls,
        maxToolCallsPerTurn: settings.maxToolCallsPerTurn,
        maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
        personaId: session?.personaId ?? settings.defaultPersonaId ?? undefined,
        language: settings.language,
        userRules: settings.systemPrompt || undefined,
        contextCompressionEnabled: settings.contextCompressionEnabled,
        contextCompressionThreshold: settings.contextCompressionThreshold,
        sshConnectionId,
        projectId,
        ...(opts?.enablePlanMode ? { enablePlanMode: true } : {}),
        sessionMode: opts?.sessionMode,
        permissionMode: settings.autoApprove ? 'fullAccess' : 'default'
      })

      void opts
    },
    [sendMessage]
  )

  const stopStreaming = useCallback(async () => {
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
  void sessionId
  // Placeholder — 迭代四实现 pending message queue
  return 0
}

export function getPendingSessionMessageCountForSession(sessionId: string): number {
  void sessionId
  return 0
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
function resolveSendModel(sessionId: string): { provider: SendProvider; modelId: string } | null {
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
  const autoSelection = useUIStore.getState().autoModelSelectionsBySession[sessionId] ?? null
  const resolvedProviderId = selection.isAutoModeActive && autoSelection?.providerId
    ? autoSelection.providerId
    : selection.providerId
  let resolvedModelId: string | null = selection.isAutoModeActive && autoSelection?.modelId
    ? autoSelection.modelId
    : selection.modelId
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

// Build a complete provider object matching handleSendMessage's logic.
// Both sendImplementPlan and sendPlanRevision need this -- they bypass
// handleSendMessage but must send the same provider shape to agent/run.
export function buildProviderPayload(
  activeProvider: SendProvider,
  modelId: string,
  settings: ReturnType<typeof useSettingsStore.getState>
): Record<string, unknown> {
  const modelConfig = activeProvider!.models.find((m: any) => m.id === modelId)
  const thinkingConfig = modelConfig?.thinkingConfig
  const thinkingEnabled = settings.thinkingEnabled && !!thinkingConfig
  const reasoningEffort = thinkingConfig
    ? resolveReasoningEffortForModel({
        reasoningEffort: settings.reasoningEffort,
        reasoningEffortByModel: settings.reasoningEffortByModel,
        providerId: activeProvider!.id,
        modelId,
        thinkingConfig
      })
    : undefined

  return {
    id: activeProvider!.id,
    name: activeProvider!.name,
    type: activeProvider!.type,
    apiKey: activeProvider!.apiKey,
    baseUrl: activeProvider!.baseUrl,
    model: modelId,
    temperature: settings.temperature ?? undefined,
    maxTokens: settings.maxTokens ?? undefined,
    thinkingEnabled,
    thinkingConfig: thinkingConfig ?? undefined,
    reasoningEffort,
    requestTimeoutSeconds: settings.apiRequestTimeoutSeconds ?? 100,
    requestMaxRetries: settings.requestMaxRetries ?? 10
  }
}

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
  const workingFolder = session?.workingFolder ?? undefined
  const sshConnectionId = session?.sshConnectionId ?? undefined
  const projectId = session?.projectId ?? undefined

  // Clear activities for new turn
  useActivityStore.getState().clearActivities()

  // Build provider the same way handleSendMessage does
  const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

  // Send implementation message
  await chatStore.sendMessage({
    provider,
    messages: [{ role: 'user', content: `The plan has been approved. The plan file is at: ${plan.filePath ?? '(unknown path)'}. Read the plan file, then execute it step by step using the Task tool to dispatch sub-agents -- do NOT implement steps yourself. For each step: (1) call UpdatePlanStep to mark it in_progress, (2) use the Task tool with subagent_type "custom" and background=false to dispatch a foreground work sub-agent with a self-contained prompt containing all context needed for that step, (3) when the sub-agent returns, call UpdatePlanStep to mark it completed or failed based on the result. If a step fails, assess whether the remaining plan needs adjustment before continuing.` }],
    sessionId,
    toolPreset: workingFolder ? 'coding' : 'chat',
    webSearchEnabled: settingsStore.webSearchEnabled,
    workingFolder,
    sshConnectionId,
    projectId,
    maxIterations: 0,
    maxParallelTools: settingsStore.maxParallelToolCalls,
    maxToolCallsPerTurn: settingsStore.maxToolCallsPerTurn,
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
  const workingFolder = session?.workingFolder ?? undefined
  const sshConnectionId = session?.sshConnectionId ?? undefined
  const projectId = session?.projectId ?? undefined

  // Clear activities for new turn
  useActivityStore.getState().clearActivities()

  // Build provider the same way handleSendMessage does
  const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

  // Send rejection feedback
  await chatStore.sendMessage({
    provider,
    messages: [{ role: 'user', content: `The plan was rejected. The plan file is at: ${plan.filePath ?? '(unknown path)'}. Please revise the plan in the plan file based on this feedback: ${feedback}` }],
    sessionId,
    toolPreset: workingFolder ? 'coding' : 'chat',
    webSearchEnabled: settingsStore.webSearchEnabled,
    workingFolder,
    sshConnectionId,
    projectId,
    maxIterations: 0,
    maxParallelTools: settingsStore.maxParallelToolCalls,
    maxToolCallsPerTurn: settingsStore.maxToolCallsPerTurn,
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
    const workingFolder = session?.workingFolder ?? undefined
    const sshConnectionId = session?.sshConnectionId ?? undefined
    const projectId = session?.projectId ?? undefined

    useActivityStore.getState().clearActivities()

    const provider = buildProviderPayload(activeProvider, modelId, settingsStore)

    await chatStore.sendMessage({
      provider,
      messages: [{ role: 'user', content: '用户退出了计划模式，计划已取消。不再需要计划流程，请正常对话。' }],
      sessionId,
      toolPreset: workingFolder ? 'coding' : 'chat',
      webSearchEnabled: settingsStore.webSearchEnabled,
      workingFolder,
      sshConnectionId,
      projectId,
      maxIterations: 0,
      maxParallelTools: settingsStore.maxParallelToolCalls,
      maxToolCallsPerTurn: settingsStore.maxToolCallsPerTurn,
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
  createdAt: number
  draft?: string
}

export type ManualCompressionResult = 'compressed' | 'skipped' | 'blocked' | 'failed'

/**
 * Manual context compression for a session (floating block / ContextRing entry).
 * The Worker endpoint prefers its own in-memory SessionConversation and only
 * falls back to the UI transcript when the Worker has not restored the session.
 * Returns an explicit status so the UI can distinguish compressed / skipped /
 * blocked / failed instead of collapsing everything into an error.
 */
export async function compressSessionContext(sessionId: string): Promise<ManualCompressionResult> {
  const chatStore = useChatStore.getState()
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) return 'blocked'

  // Never compress while the session has an active run — the Worker would
  // reject it too, but checking here gives instant feedback without a round trip.
  if (chatStore.streamingMessages[sessionId]) return 'blocked'

  const messages = session.messages ?? []
  if (messages.length === 0) return 'skipped'

  const resolved = resolveSendModel(sessionId)
  if (!resolved) return 'blocked'

  const settingsStore = useSettingsStore.getState()
  const providerPayload = buildProviderPayload(resolved.provider, resolved.modelId, settingsStore)
  const modelConfig = resolved.provider.models.find((m: any) => m.id === resolved.modelId)
  const provider = {
    ...providerPayload,
    contextLength: modelConfig?.contextLength ?? undefined
  } as unknown as ProviderConfig

  // Fallback wire messages for the stateless path — the Worker ignores them
  // when it already holds the session conversation.
  const fallbackMessages: UnifiedMessage[] = messages.map((m) => ({
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
      sessionId
    )
    const status = result.status ?? (result.compressed ? 'compressed' : 'skipped')
    if (status === 'compressed') {
      // Manual runs emit no stream events — record the same status card and
      // boundary/summary pair the auto path produces via context_compressed.
      const now = Date.now()
      recordCompressionStatusMessage(sessionId, {
        state: 'compressed',
        startedAt: now,
        completedAt: now,
        trigger: result.trigger ?? 'manual',
        ...(typeof result.messagesSummarized === 'number'
          ? { messagesSummarized: result.messagesSummarized }
          : {}),
        ...(result.summarizerFailed ? { summarizerFailed: true } : {})
      }, `manual-${now}`)
      if (compactArtifacts?.length) {
        applyCompactArtifactsToSession(sessionId, compactArtifacts)
      }
      return 'compressed'
    }
    if (status === 'blocked') return 'blocked'
    if (status === 'skipped' || status === 'cancelled') return 'skipped'
    console.warn('[ChatActions] Manual compression failed', result.error)
    return 'failed'
  } catch (error) {
    console.error('[ChatActions] Manual compression error', error)
    return 'failed'
  }
}

const _pendingMessages = new Map<string, PendingSessionMessageItem[]>()
const _pendingListeners = new Set<() => void>()

export function getPendingSessionMessages(sessionId: string): PendingSessionMessageItem[] {
  return _pendingMessages.get(sessionId) ?? []
}

export function isPendingSessionDispatchPaused(_sessionId: string): boolean {
  return false
}

export function removePendingSessionMessage(sessionId: string, messageId: string): boolean {
  const list = _pendingMessages.get(sessionId) ?? []
  const filtered = list.filter((m) => m.id !== messageId)
  _pendingMessages.set(sessionId, filtered)
  _pendingListeners.forEach((fn) => fn())
  return filtered.length < list.length
}

export function updatePendingSessionMessageDraft(
  sessionId: string,
  messageId: string,
  draft: unknown
): void {
  const list = _pendingMessages.get(sessionId) ?? []
  const msg = list.find((m) => m.id === messageId)
  if (msg) {
    if (typeof draft === 'string') {
      msg.draft = draft
    } else if (draft && typeof draft === 'object') {
      const d = draft as { text?: string; images?: unknown[]; command?: unknown }
      msg.draft = d.text ?? ''
      if (d.images) msg.images = d.images as any[]
      if (d.command) msg.command = d.command as any
    }
    _pendingListeners.forEach((fn) => fn())
  }
}

export function quotePendingSessionMessageIntoConversation(
  _sessionId: string,
  _messageId: string
): unknown {
  return null
}

export function dispatchNextQueuedMessageForSession(_sessionId: string): boolean {
  return false
}

export function hasActiveSessionRunForSession(_sessionId: string): boolean {
  return false
}

export function hasPendingSessionMessagesForSession(sessionId: string): boolean {
  return (_pendingMessages.get(sessionId)?.length ?? 0) > 0
}

export function resetTeamAutoTrigger(): void {}

export function stopSessionStreaming(sessionId: string): void {
  abortSession(sessionId)
}
