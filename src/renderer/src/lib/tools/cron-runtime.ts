import type { AIProvider } from '@shared/types/provider'
import type { AgentEvent } from '@renderer/lib/agent/types'
import type { ProviderConfig, ToolDefinition, UnifiedMessage } from '@renderer/lib/api/types'
import type { ChatMessage } from '@renderer/stores/chat-store/types'
import { runAgentViaSidecar } from '@renderer/lib/agent/run-agent-via-sidecar'
import { IPC } from '@renderer/lib/ipc/channels'
import { buildSidecarAgentRunRequest } from '@renderer/lib/ipc/sidecar-protocol'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import { dbGetMessageCount, dbUpdateSession, dbUpsertMessage } from '@renderer/stores/chat-store/db-helpers'
import { useProviderStore } from '@renderer/stores/provider-store'
import { fetchToolDefinitionsAsync } from './tool-cache'
import { cronEvents, type CronFiredEvent } from './cron-events'

const MAX_SUMMARY_LENGTH = 2000

let unsubscribe: (() => void) | null = null
const activeRuns = new Set<string>()

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

function buildDeliveryMessage(event: CronFiredEvent, result: CronRunResult): string {
  const title = event.name?.trim() || 'Scheduled task'
  if (result.status === 'success') {
    return result.summary ? `${title}\n\n${result.summary}` : `${title}\n\nCompleted successfully.`
  }
  const detail = result.error || result.summary || 'No error details were provided.'
  return `${title}\n\n${result.status === 'aborted' ? 'Aborted' : 'Failed'}: ${detail}`
}

async function deliverToSession(sessionId: string, content: string, runId: string): Promise<void> {
  const message: ChatMessage = {
    id: `${runId}-delivery`,
    role: 'assistant',
    text: content,
    createdAt: Date.now()
  }
  const sortOrder = await dbGetMessageCount(sessionId)
  await dbUpsertMessage(sessionId, message, sortOrder)
  await dbUpdateSession(sessionId, { updatedAt: message.createdAt })
  const session = useChatStore.getState().sessions.find((candidate) => candidate.id === sessionId)
  if (session) useChatStore.getState().addMessage(sessionId, message)
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
    const sessionId = event.deliveryTarget?.trim() || event.sessionId?.trim()
    if (!sessionId) throw new Error('session delivery requires deliveryTarget or sessionId')
    await deliverToSession(sessionId, content, runId)
    return
  }
  const notification = await ipcClient.invoke('notification:show', {
    title: event.name?.trim() || 'Scheduled task',
    body: content,
    type: result.status === 'success' ? 'success' : 'error'
  }) as { success?: boolean }
  if (notification.success === false) throw new Error('Desktop notifications are not supported')
}

async function persistRunFinished(event: CronFiredEvent, result: CronRunResult): Promise<void> {
  try {
    const response = await window.api.workerRequest('db/crons-mark-run-finished', {
      id: event.jobId,
      runAt: Date.now(),
      status: result.status,
      summary: result.summary,
      error: result.error
    })
    assertWorkerSuccess(response)
  } catch (error) {
    console.warn('[CronRuntime] failed to persist run state:', error)
  }
}

async function executeCron(event: CronFiredEvent): Promise<void> {
  if (activeRuns.has(event.jobId)) return
  activeRuns.add(event.jobId)
  const runId = createRunId(event.jobId)
  const startedAt = Date.now()
  let result: CronRunResult = { status: 'error', toolCallCount: 0 }
  cronEvents.emit({ type: 'run_started', jobId: event.jobId, runId })

  try {
    const resolved = resolveProvider(event)
    if (!resolved) throw new Error('No enabled provider/model configured for Cron task')
    const provider = buildProviderConfig(resolved.provider, resolved.modelId)
    const preset = event.workingFolder ? 'coding' : 'chat'
    const tools = await fetchToolDefinitionsAsync(preset) as unknown as ToolDefinition[]
    const message: UnifiedMessage = {
      id: `${runId}-user`,
      role: 'user',
      content: event.prompt?.trim() || 'Run the scheduled task.',
      createdAt: startedAt
    }
    const request = buildSidecarAgentRunRequest({
      messages: [message],
      provider,
      tools,
      runId,
      sessionId: event.sessionId ?? undefined,
      workingFolder: event.workingFolder ?? undefined,
      maxIterations: event.maxIterations && event.maxIterations > 0 ? event.maxIterations : 15,
      forceApproval: false,
      sessionMode: 'agent',
      callerAgent: event.agentId ?? undefined,
      pluginId: event.pluginId ?? undefined,
      pluginChatId: event.pluginChatId ?? undefined
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
    try {
      await deliverResult(event, result, runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.error = appendError(result.error, `Delivery failed: ${message}`)
    }

    await persistRunFinished(event, result)

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
      const message = error instanceof Error ? error.message : String(error)
      result.error = appendError(result.error, `Completion failed: ${message}`)
      await persistRunFinished(event, result)
    }

    publishRunFinished(event, runId, result)
    activeRuns.delete(event.jobId)
  }
}

function handleCronFire(raw: unknown): void {
  const event = asRecord(raw) as unknown as CronFiredEvent
  if (!event.jobId || !event.fireId) return
  cronEvents.emit({ type: 'fired', ...event })
  void executeCron(event)
}

export function initializeCronRuntime(): () => void {
  if (unsubscribe) return unsubscribe
  unsubscribe = ipcClient.on('cron:fire', handleCronFire)
  return () => {
    unsubscribe?.()
    unsubscribe = null
  }
}
