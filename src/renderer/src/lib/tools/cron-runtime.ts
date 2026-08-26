import type { AIProvider } from '@shared/types/provider'
import type { AgentEvent } from '@renderer/lib/agent/types'
import type { ProviderConfig, ToolDefinition, UnifiedMessage } from '@renderer/lib/api/types'
import type { ChatMessage } from '@renderer/stores/chat-store/types'
import { toast } from 'sonner'
import i18n from 'i18next'
import { runAgentViaSidecar } from '@renderer/lib/agent/run-agent-via-sidecar'
import { IPC } from '@renderer/lib/ipc/channels'
import { agentStream } from '@renderer/lib/ipc/agent-stream-receiver'
import { registerExternalChannelReply } from '@renderer/hooks/use-channel-auto-reply'
import { buildSidecarAgentRunRequest } from '@renderer/lib/ipc/sidecar-protocol'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import { awaitSessionCreated, dbGetMessageCount, dbGetSession, dbUpdateSession, dbUpsertMessage } from '@renderer/stores/chat-store/db-helpers'
import { useProviderStore } from '@renderer/stores/provider-store'
import { fetchToolDefinitionsAsync } from './tool-cache'
import { cronEvents, type CronFiredEvent } from './cron-events'

const MAX_SUMMARY_LENGTH = 2000

let unsubscribe: (() => void) | null = null
// Job IDs gate duplicate execution; run IDs represent live cron_runs rows for
// query-side orphan normalization. These sets intentionally have different keys.
const activeJobIds = new Set<string>()
const activeRunIds = new Set<string>()
// Fire events may be delivered more than once (e.g. duplicated IPC listeners
// after a dev HMR reload). Deduplicate by fireId so one fire executes once.
const processedFireIds = new Set<string>()

function pruneProcessedFireIds(): void {
  if (processedFireIds.size <= 500) return
  for (const id of processedFireIds) {
    processedFireIds.delete(id)
    if (processedFireIds.size <= 250) break
  }
}

/** Live in-memory runIds — the authoritative "still executing" set. */
export function getActiveRunIds(): string[] {
  return [...activeRunIds]
}

interface CronRunResult {
  status: 'success' | 'error' | 'aborted'
  summary?: string
  error?: string
  toolCallCount: number
}

function appendError(current: string | undefined, next: string): string {
  return truncate(current ? `${current}; ${next}` : next)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function assertWorkerSuccess(value: unknown): void {
  const result = asRecord(value)
  if (result.success === false || typeof result.error === 'string') {
    throw new Error(typeof result.error === 'string' ? result.error : 'Worker request failed')
  }
}

function createRunId(jobId: string): string {
  return `cron-run-${jobId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function truncate(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

function resolveProvider(event: CronFiredEvent): { provider: AIProvider; modelId: string } | null {
  const store = useProviderStore.getState()
  const providers = store.providers.filter((provider) => provider.enabled)
  const requestedModel = event.model?.trim()
  const requestedProvider = event.agentId
    ? providers.find((provider) => provider.id === event.agentId || provider.builtinId === event.agentId)
    : undefined
  const provider = requestedProvider
    ?? (requestedModel
      ? providers.find((candidate) => candidate.models.some((model) => model.id === requestedModel))
      : undefined)
    ?? providers.find((candidate) => candidate.id === store.activeProviderId)
    ?? providers[0]
  if (!provider) return null

  const modelId = requestedModel
    || (provider.id === store.activeProviderId ? store.activeModelId : '')
    || provider.defaultModel
    || provider.models.find((model) => model.enabled && (!model.category || model.category === 'chat'))?.id
    || provider.models.find((model) => model.enabled)?.id
  if (!modelId) return null
  return { provider, modelId }
}

function buildProviderConfig(provider: AIProvider, modelId: string): ProviderConfig {
  const model = provider.models.find((candidate) => candidate.id === modelId)
  return {
    type: model?.type ?? provider.type,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: modelId,
    contextLength: model?.contextLength,
    category: model?.category,
    providerId: provider.id,
    providerBuiltinId: provider.builtinId,
    maxTokens: model?.maxOutputTokens,
    useSystemProxy: provider.useSystemProxy,
    allowInsecureTls: provider.allowInsecureTls,
    thinkingConfig: model?.thinkingConfig,
    requestOverrides: model?.requestOverrides ?? provider.requestOverrides,
    instructionsPrompt: provider.instructionsPrompt,
    cacheTtl: model?.cacheTtl ?? provider.cacheTtl,
    websocketUrl: model?.websocketUrl ?? provider.websocketUrl,
    websocketMode: model?.websocketMode ?? provider.websocketMode
  }
}

function publishRunFinished(event: CronFiredEvent, runId: string, result: CronRunResult): void {
  cronEvents.emit({
    type: 'run_finished',
    jobId: event.jobId,
    runId,
    status: result.status,
    toolCallCount: result.toolCallCount,
    jobName: event.name,
    sessionId: event.sessionId,
    deliveryMode: event.deliveryMode,
    deliveryTarget: event.deliveryTarget,
    outputSummary: result.summary,
    error: result.error
  })
}

function resolveLinkedSessionId(event: CronFiredEvent): string | undefined {
  if (event.outputMode === 'reuse_session') {
    return event.reuseSessionId?.trim() || event.deliveryTarget?.trim() || event.sessionId?.trim() || undefined
  }
  return event.sessionId?.trim() || undefined
}

async function prepareRunEvent(event: CronFiredEvent): Promise<CronFiredEvent> {
  const outputMode = event.outputMode
    ?? (event.pluginId ? 'bot' : event.deliveryMode === 'session' ? 'reuse_session' : 'new_session')
  if (outputMode === 'bot') {
    return { ...event, outputMode, deliveryMode: 'plugin' }
  }

  const chatStore = useChatStore.getState()
  if (outputMode === 'reuse_session') {
    const sessionId = event.reuseSessionId?.trim() || event.deliveryTarget?.trim() || event.sessionId?.trim()
    if (!sessionId) throw new Error('Cron task has no reusable session selected')
    const session = chatStore.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) throw new Error('The reusable session no longer exists')
    const scopeMatches = event.scope === 'project'
      ? Boolean(event.projectId && session.projectId === event.projectId)
      : !session.projectId
    if (!scopeMatches) throw new Error('The reusable session no longer matches the task scope')
    return {
      ...event,
      outputMode,
      sessionId,
      reuseSessionId: sessionId,
      workingFolder: session.workingFolder ?? event.workingFolder,
      deliveryMode: 'session',
      deliveryTarget: sessionId
    }
  }

  const project = event.scope === 'project' && event.projectId
    ? chatStore.projects.find((candidate) => candidate.id === event.projectId)
    : undefined
  if (event.scope === 'project' && !project) throw new Error('The Automation project no longer exists')
  const previousActiveSessionId = chatStore.activeSessionId
  const sessionId = chatStore.createSession('cowork', project?.id ?? null, {
    preserveProjectless: !project,
    workingFolder: project?.workingFolder ?? event.workingFolder ?? null,
    sshConnectionId: project?.sshConnectionId ?? null
  })
  chatStore.updateSessionTitle(sessionId, event.name?.trim() || 'Automation')
  chatStore.setActiveSession(previousActiveSessionId)
  await awaitSessionCreated(sessionId)
  return {
    ...event,
    outputMode: 'new_session',
    sessionId,
    workingFolder: project?.workingFolder ?? event.workingFolder,
    deliveryMode: 'session',
    deliveryTarget: sessionId
  }
}

function buildDeliveryMessage(event: CronFiredEvent, result: CronRunResult): string {
  const title = event.name?.trim() || 'Scheduled task'
  if (result.status === 'success') {
    return result.summary ? `${title}\n\n${result.summary}` : `${title}\n\nCompleted successfully.`
  }
  const detail = result.error || result.summary || 'No error details were provided.'
  return `${title}\n\n${result.status === 'aborted' ? 'Aborted' : 'Failed'}: ${detail}`
}

async function deliverToSession(sessionId: string, content: string, cronTaskId: string, runId: string): Promise<void> {
  const message: ChatMessage = {
    id: `${runId}-delivery`,
    role: 'assistant',
    text: content,
    createdAt: Date.now(),
    meta: {
      cronTaskId,
      cronRunId: runId
    }
  }
  const sortOrder = await dbGetMessageCount(sessionId)
  await dbUpsertMessage(sessionId, message, sortOrder)
  await dbUpdateSession(sessionId, { updatedAt: message.createdAt })
  const session = useChatStore.getState().sessions.find((candidate) => candidate.id === sessionId)
  if (session) useChatStore.getState().addMessage(sessionId, message)
  // Channel-bound session: the result must also reach the external chat.
  // Send through the unified channel-send path so instance fallback applies;
  // the summary message stays local-only (no auto-reply echo of itself).
  if (session?.pluginId && session?.externalChatId) {
    await ipcClient.invoke(IPC.PLUGIN_EXEC, {
      pluginId: session.pluginId,
      action: 'sendMessage',
      params: {
        chatId: session.externalChatId,
        content,
        pluginType: session.pluginType ?? undefined
      }
    })
  }
}

async function deliverResult(event: CronFiredEvent, result: CronRunResult, runId: string): Promise<void> {
  const mode = event.deliveryMode ?? 'desktop'
  if (mode === 'none') return
  const content = buildDeliveryMessage(event, result)
  if (mode === 'plugin') {
    if (!event.pluginId || !event.pluginChatId) {
      throw new Error('plugin delivery requires pluginId and pluginChatId')
    }
    await ipcClient.invoke(IPC.PLUGIN_EXEC, {
      pluginId: event.pluginId,
      action: 'sendMessage',
      params: {
        chatId: event.pluginChatId,
        content,
        pluginType: event.pluginType ?? undefined,
        taskId: event.jobId
      }
    })
    return
  }
  if (mode === 'session') {
    const sessionId = resolveLinkedSessionId(event)
    if (!sessionId) throw new Error('session delivery requires deliveryTarget or sessionId')
    await deliverToSession(sessionId, content, event.jobId, runId)
    return
  }
  const notification = await ipcClient.invoke('notification:show', {
    title: event.name?.trim() || 'Scheduled task',
    body: content,
    type: result.status === 'success' ? 'success' : 'error'
  }) as { success?: boolean }
  if (notification.success === false) throw new Error('Desktop notifications are not supported')
}

async function persistRunStarted(event: CronFiredEvent, runId: string, startedAt: number): Promise<void> {
  try {
    const response = await window.api.workerRequest('db/cron-runs-start', {
      runId,
      cronId: event.jobId,
      sessionId: resolveLinkedSessionId(event),
      fireId: event.fireId,
      startedAt
    })
    assertWorkerSuccess(response)
  } catch (error) {
    console.warn('[CronRuntime] failed to persist run start:', error)
  }
}

async function persistRunFinished(event: CronFiredEvent, runId: string, result: CronRunResult): Promise<void> {
  try {
    const response = await window.api.workerRequest('db/crons-mark-run-finished', {
      id: event.jobId,
      runAt: Date.now(),
      status: result.status,
      summary: result.summary,
      error: result.error
    })
    const runResponse = await window.api.workerRequest('db/cron-runs-finish', {
      runId,
      status: result.status,
      summary: result.summary,
      error: result.error,
      toolCallCount: result.toolCallCount,
      finishedAt: Date.now()
    })
    assertWorkerSuccess(runResponse)
    assertWorkerSuccess(response)
  } catch (error) {
    console.warn('[CronRuntime] failed to persist run state:', error)
  }
}

interface CronSessionCompletion {
  text: string
  error?: string
}

/** Collect the Cron session's own stream so completion and channel delivery do
 * not depend on the currently mounted chat page or another auto-reply listener. */
function waitForCronSessionCompletion(sessionId: string, timeoutMs = 30 * 60_000): Promise<CronSessionCompletion> {
  return new Promise((resolve, reject) => {
    let text = ''
    let settled = false
    const timer = setTimeout(() => finish(new Error('In-session run timed out waiting for the stream to finish')), timeoutMs)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      if (error) reject(error)
      else resolve({ text: text.trim() })
    }
    const unsubscribe = agentStream.subscribeAll((_runId, eventSessionId, event) => {
      if (eventSessionId !== sessionId) return
      if (event.type === 'text_delta') text += event.text
      else if (event.type === 'error') finish(new Error(event.message))
      else if (event.type === 'loop_end') finish()
    })
  })
}

async function runInSession(runEvent: CronFiredEvent, result: CronRunResult): Promise<void> {
  const sessionId = runEvent.sessionId
  if (!sessionId) throw new Error('In-session execution requires a target session')

  let chatStore = useChatStore.getState()
  // Busy check: never interleave with an in-flight turn in the same session.
  if (chatStore.streamingMessages[sessionId]) {
    throw new Error('Skipped: the target session is busy with another conversation')
  }

  let targetSession = chatStore.sessions.find((candidate) => candidate.id === sessionId)

    // After an app restart the store is empty — channel sessions are created
    // by the Main process and never enter the renderer store on their own.
    // beginUserTurn silently no-ops for missing sessions (no placeholder
    // messages → stream deltas have nothing to attach to), so inject first.
    if (!targetSession) {
      useChatStore.setState((state) => {
        if (state.sessions.some((candidate) => candidate.id === sessionId)) return
        state.sessions.push({
          id: sessionId,
          title: runEvent.name?.trim() || 'Automation',
          mode: 'cowork',
          messages: [],
          messageCount: 0,
          messagesLoaded: true,
          loadedRangeStart: 0,
          loadedRangeEnd: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectId: runEvent.projectId ?? undefined,
          workingFolder: runEvent.workingFolder ?? undefined,
          pluginId: runEvent.pluginId ?? undefined,
          externalChatId: runEvent.pluginChatId ?? undefined,
          modelSelectionMode: 'inherit'
        })
      })
      // Reload from DB so prior history is available before the new turn.
      await useChatStore.getState().loadRecentSessionMessages(sessionId, true)
      // The placeholder lacks persisted channel metadata — restore the real
      // external chat target / plugin type from the DB session row.
      if (!useChatStore.getState().sessions.find((candidate) => candidate.id === sessionId)?.externalChatId) {
        const stored = await dbGetSession(sessionId).catch(() => null)
        if (stored) {
          useChatStore.setState((state) => {
            const target = state.sessions.find((candidate) => candidate.id === sessionId)
            if (!target) return
            target.pluginId = target.pluginId ?? stored.pluginId
            target.pluginType = target.pluginType ?? stored.pluginType
            target.externalChatId = target.externalChatId ?? stored.externalChatId
          })
        }
      }
      chatStore = useChatStore.getState()
      targetSession = chatStore.sessions.find((candidate) => candidate.id === sessionId)
      if (!targetSession) throw new Error('The target session no longer exists')
    }

    // Channel echo uses the unified pipeline: register the session so
    // loop_end forwards the final reply to the external chat — identical
    // to what manual messages do via the send entry point.
    if (targetSession.pluginId && targetSession.externalChatId) {
      registerExternalChannelReply(sessionId, targetSession.pluginId, targetSession.externalChatId)
    }

    const resolved = resolveProvider(runEvent)
    if (!resolved) throw new Error('No enabled provider/model configured for Cron task')
    const provider = buildProviderConfig(resolved.provider, resolved.modelId)

    // Subscribe before sendMessage: stream events may arrive before the IPC
    // request returns. This also works when the Automation page is mounted.
    const completionPromise = waitForCronSessionCompletion(sessionId)
    await chatStore.sendMessage({
      provider: provider as unknown as Record<string, unknown>,
      messages: [{ role: 'user', content: runEvent.prompt?.trim() || 'Run the scheduled task.' }],
      sessionId,
      toolPreset: runEvent.workingFolder ? 'coding' : 'chat',
      workingFolder: runEvent.workingFolder,
      maxIterations: runEvent.maxIterations && runEvent.maxIterations > 0 ? runEvent.maxIterations : 15,
      forceApproval: false,
      permissionMode: 'fullAccess',
      nonInteractive: true,
      callerAgent: runEvent.agentId ?? undefined
    } as unknown as Parameters<typeof chatStore.sendMessage>[0])
    const completion = await completionPromise
    const state = useChatStore.getState()
    const session = state.sessions.find((candidate) => candidate.id === sessionId)
    const lastAssistant = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && !m.isStreaming)
    const finalText = completion.text || lastAssistant?.text?.trim() || ''
    result.status = lastAssistant?.error ? 'error' : 'success'
    result.summary = truncate(finalText)
    if (result.status === 'error') {
      result.error = truncate(lastAssistant?.error ?? 'In-session run failed')
    }
  }

async function executeCron(event: CronFiredEvent): Promise<void> {
  if (activeJobIds.has(event.jobId)) return
  activeJobIds.add(event.jobId)
  const runId = createRunId(event.jobId)
  activeRunIds.add(runId)
  const startedAt = Date.now()
  let result: CronRunResult = { status: 'error', toolCallCount: 0 }
  let runEvent = event
  cronEvents.emit({ type: 'run_started', jobId: event.jobId, runId })

  try {
    runEvent = await prepareRunEvent(event)
    await persistRunStarted(runEvent, runId, startedAt)

    // In-session mode: run through the normal chat pipeline so the whole
    // streaming process is visible in the target session, then skip the
    // silent sidecar path below.
    if (event.runMode === 'session' && runEvent.outputMode !== 'bot') {
      result = { status: 'error', toolCallCount: 0 }
      try {
        await runInSession(runEvent, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith('Skipped:')) {
          result = { status: 'aborted', error: truncate(message), toolCallCount: 0 }
        } else {
          result = { status: 'error', error: truncate(message), toolCallCount: 0 }
        }
      }
      return
    }

    const resolved = resolveProvider(runEvent)
    if (!resolved) throw new Error('No enabled provider/model configured for Cron task')
    const provider = buildProviderConfig(resolved.provider, resolved.modelId)
    const preset = runEvent.workingFolder ? 'coding' : 'chat'
    const tools = await fetchToolDefinitionsAsync(preset) as unknown as ToolDefinition[]
    const message: UnifiedMessage = {
      id: `${runId}-user`,
      role: 'user',
      content: runEvent.prompt?.trim() || 'Run the scheduled task.',
      createdAt: startedAt
    }
    const request = buildSidecarAgentRunRequest({
      messages: [message],
      provider,
      tools,
      runId,
      sessionId: runEvent.sessionId ?? undefined,
      workingFolder: runEvent.workingFolder ?? undefined,
      maxIterations: runEvent.maxIterations && runEvent.maxIterations > 0 ? runEvent.maxIterations : 15,
      forceApproval: false,
      permissionMode: 'fullAccess',
      sessionMode: 'agent',
      callerAgent: runEvent.agentId ?? undefined,
      pluginId: runEvent.pluginId ?? undefined,
      pluginChatId: runEvent.pluginChatId ?? undefined
    })
    if (!request) throw new Error('Failed to build Cron sidecar request')

    let summary = ''
    let iteration = 0
    for await (const agentEvent of runAgentViaSidecar(request, { routeSubAgentEventsToBus: false })) {
      const eventRecord = agentEvent as AgentEvent
      if (eventRecord.type === 'text_delta') summary += eventRecord.text
      if (eventRecord.type === 'iteration_start') iteration = eventRecord.iteration
      if (eventRecord.type === 'tool_call_start') result.toolCallCount += 1
      if (eventRecord.type === 'error') throw eventRecord.error
      if (eventRecord.type === 'loop_end') {
        if (eventRecord.reason === 'aborted') result.status = 'aborted'
        else if (eventRecord.reason === 'error') result.status = 'error'
        else result.status = 'success'
      }
      if (eventRecord.type === 'iteration_end' || eventRecord.type === 'message_end') {
        cronEvents.emit({
          type: 'run_progress',
          jobId: event.jobId,
          runId,
          iteration,
          toolCalls: result.toolCallCount,
          elapsed: Date.now() - startedAt,
          currentStep: eventRecord.type
        })
      }
    }
    result.summary = truncate(summary.trim())
    if (result.status === 'error' && !result.error) result.error = 'Cron Agent run ended without a completion event'
  } catch (error) {
    result = {
      ...result,
      status: 'error',
      error: truncate(error instanceof Error ? error.message : String(error))
    }
  } finally {
    // In-session mode already streamed the full result into the session via
    // sendMessage; skip the separate delivery step to avoid duplicates.
    if (!(event.runMode === 'session' && runEvent.outputMode !== 'bot')) {
      try {
        await deliverResult(runEvent, result, runId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.error = appendError(result.error, `Delivery failed: ${message}`)
      }
    }

    await persistRunFinished(runEvent, runId, result)

    try {
      const completion = asRecord(await ipcClient.invoke('cron:run-complete', {
        jobId: event.jobId,
        fireId: event.fireId
      }))
      if (typeof completion.error === 'string' && completion.error) throw new Error(completion.error)
      if (completion.archived === true) {
        cronEvents.emit({ type: 'job_removed', jobId: event.jobId, reason: 'delete_after_run' })
      }
    } catch (error) {
      // Completion handshake failed — record it on the result for the toast,
      // but do NOT re-persist: the run was already finalized above and a
      // second Finish can never match the no-longer-'running' row.
      const message = error instanceof Error ? error.message : String(error)
      result.error = appendError(result.error, `Completion failed: ${message}`)
    }

    publishRunFinished(runEvent, runId, result)

    // User-visible feedback: scheduled runs write into sessions/plugins
    // silently, so without this toast the run appears to "do nothing".
    const jobName = event.name?.trim() || event.jobId
    if (result.status === 'success') {
      toast.success(i18n.t('automation.runFinished', { ns: 'layout', name: jobName }), {
        description: result.summary || undefined,
        action: runEvent.outputMode === 'new_session' && runEvent.sessionId && runEvent.deliveryMode === 'session'
          ? {
              label: i18n.t('automation.openSession', { ns: 'layout' }),
              onClick: () => useChatStore.getState().setActiveSession(runEvent.sessionId!)
            }
          : undefined
      })
    } else {
      toast.error(i18n.t('automation.runFailed', { ns: 'layout', name: jobName }), {
        description: result.error || result.summary || undefined
      })
    }

    activeRunIds.delete(runId)
    activeJobIds.delete(event.jobId)
  }
}

function handleCronFire(raw: unknown): void {
  const event = asRecord(raw) as unknown as CronFiredEvent
  if (!event.jobId || !event.fireId) return
  if (processedFireIds.has(event.fireId)) return
  processedFireIds.add(event.fireId)
  pruneProcessedFireIds()
  cronEvents.emit({ type: 'fired', ...event })
  void executeCron(event)
}

export function initializeCronRuntime(): () => void {
  if (unsubscribe) return unsubscribe
  unsubscribe = ipcClient.on('cron:fire', handleCronFire)
  // Expose the live run set for read-time orphan detection (AutomationPage).
  ;(window as unknown as { __cronRuntime?: { getActiveRunIds: () => string[] } }).__cronRuntime = {
    getActiveRunIds
  }
  return () => {
    unsubscribe?.()
    unsubscribe = null
  }
}
