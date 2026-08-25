import type { AIProvider } from '@shared/types/provider'
import type { AgentEvent } from '@renderer/lib/agent/types'
import type { ProviderConfig, ToolDefinition, UnifiedMessage } from '@renderer/lib/api/types'
import { runAgentViaSidecar } from '@renderer/lib/agent/run-agent-via-sidecar'
import { buildSidecarAgentRunRequest } from '@renderer/lib/ipc/sidecar-protocol'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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

async function persistRunFinished(event: CronFiredEvent, result: CronRunResult): Promise<void> {
  try {
    await window.api.workerRequest('db/crons-mark-run-finished', {
      id: event.jobId,
      runAt: Date.now(),
      status: result.status,
      summary: result.summary,
      error: result.error
    })
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
    await persistRunFinished(event, result)
    publishRunFinished(event, runId, result)
    activeRuns.delete(event.jobId)
  }
}

function handleCronFire(raw: unknown): void {
  const event = asRecord(raw) as unknown as CronFiredEvent
  if (!event.jobId) return
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
