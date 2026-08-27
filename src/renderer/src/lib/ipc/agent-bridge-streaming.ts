import { agentBridge, canSidecarHandle } from './agent-bridge'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { CompressionResult } from '../agent/context-compression-config'
import { toAgentEvent } from '../agent/stream-event-adapter'
import { AgentEvent } from '../agent/types'
import { RESPONSES_SESSION_SCOPE_SIDECAR_TEXT_REQUEST, withAuxiliaryResponsesRequestPolicy } from '../api/responses-session-policy'
import { ProviderConfig, StreamEvent, ToolDefinition, UnifiedMessage } from '../api/types'
import { mapAgentEventToProviderEvents, toProviderErrorEvent } from './agent-bridge-events'
import { agentStream } from './agent-stream-receiver'
import { buildSidecarAgentRunRequest, isNativeSidecarProviderConfig, sanitizeSidecarMessageMeta } from './sidecar-protocol'
import { SidecarSlashCommandContext, SidecarSystemCommandContext } from './sidecar-protocol-types'
import { writeLog } from '@renderer/lib/error-logger'

/** One-line JSON for renderer log files (avoids "[object Object]" in captures). */
function logOptimizerTrace(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`
  if (level === 'error') {
    console.error(`[AgentBridge] ${line}`)
    writeLog('error', `[AgentBridge] ${line}`)
  } else if (level === 'warn') {
    console.warn(`[AgentBridge] ${line}`)
    writeLog('warn', `[AgentBridge] ${line}`)
  } else {
    console.log(`[AgentBridge] ${line}`)
  }
}

const DEBUG_BODY_READ_TIMEOUT_MS = 15_000

export async function readSidecarDebugBody(args: {
  bodyRef?: string
  sessionId?: string | null
}): Promise<string> {
  const result = (await agentBridge.request(
    'agent/debug-body-read',
    {
      ...(args.bodyRef ? { bodyRef: args.bodyRef } : {}),
      ...(args.sessionId ? { sessionId: args.sessionId } : {})
    },
    DEBUG_BODY_READ_TIMEOUT_MS
  )) as {
    success?: boolean
    body?: string
    error?: string
  }
  if (!result.success || typeof result.body !== 'string') {
    throw new Error(result.error || 'Debug body is unavailable')
  }
  return result.body
}

export function runSidecarCleanup(unsubscribe: (() => void) | null): void {
  if (unsubscribe) {
    unsubscribe()
  }
}

export async function* streamSidecarProviderTurn(args: {
  provider: ProviderConfig
  messages: UnifiedMessage[]
  tools: ToolDefinition[]
  planMode?: boolean
  slashCommand?: SidecarSlashCommandContext
  systemCommand?: SidecarSystemCommandContext
  requestContextTexts?: readonly string[]
  includeFullDebugBody?: boolean
  signal?: AbortSignal
}): AsyncGenerator<StreamEvent> {
  if (!isNativeSidecarProviderConfig(args.provider)) {
    yield {
      type: 'error',
      error: {
        type: 'native_unavailable',
        message: `${args.provider.type} requires the .NET Native Worker for execution.`
      }
    }
    return
  }

  const sidecarRequest = buildSidecarAgentRunRequest({
    messages: args.messages,
    provider: args.provider,
    tools: args.tools,
    maxIterations: 1,
    forceApproval: false,
    planMode: args.planMode,
    slashCommand: args.slashCommand,
    systemCommand: args.systemCommand,
    requestContextTexts: args.requestContextTexts,
    includeFullDebugBody: args.includeFullDebugBody,
    providerTurnOnly: true
  })
  if (!sidecarRequest) {
    yield {
      type: 'error',
      error: {
        type: 'request_build_failed',
        message: 'Sidecar provider request build failed.'
      }
    }
    return
  }

  try {
    const supportsAgentRun = await canSidecarHandle('agent.run')
    const supportsProvider = await canSidecarHandle(`provider.${args.provider.type}`)
    if (!supportsAgentRun || !supportsProvider) {
      yield {
        type: 'error',
        error: {
          type: 'native_unavailable',
          message: `${args.provider.type} is not available in the .NET Native Worker.`
        }
      }
      return
    }

    const initialized = await agentBridge.initialize()
    if (!initialized) {
      yield {
        type: 'error',
        error: {
          type: 'sidecar_unavailable',
          message: 'Sidecar unavailable.'
        }
      }
      return
    }

    const queue: StreamEvent[] = []
    const pendingEvents: Array<{ runId: string; event: { type: string; [key: string]: unknown } }> =
      []
    const startedToolIds = new Set<string>()
    let finished = false
    let notify: (() => void) | null = null
    let runId = ''
    let abortCleanup: (() => void) | null = null

    const wake = (): void => {
      if (!notify) return
      const resume = notify
      notify = null
      resume()
    }

    const pushProviderEvents = (events: StreamEvent[]): void => {
      if (events.length === 0) return
      for (const event of events) {
        queue.push(event)
      }
      if (events.some((event) => event.type === 'error')) {
        finished = true
      }
      wake()
    }

    const dispatchAgentEvent = (event: { type: string; [key: string]: unknown }): void => {
      if (event.type === 'loop_end') {
        finished = true
        wake()
        return
      }
      pushProviderEvents(
        mapAgentEventToProviderEvents(event as unknown as AgentEvent, startedToolIds)
      )
    }

    const unsubscribe = agentStream.subscribeAll((eventRunId, _sessionId, streamEvent) => {
      const event = toAgentEvent(streamEvent)
      if (!event) return

      if (!runId) {
        pendingEvents.push({
          runId: eventRunId,
          event: event as unknown as { type: string; [key: string]: unknown }
        })
        return
      }

      if (eventRunId && eventRunId !== runId) return
      dispatchAgentEvent(event as unknown as { type: string; [key: string]: unknown })
    })

    try {
      const result = await agentBridge.runAgent(sidecarRequest)
      runId = result.runId
      logOptimizerTrace('info', 'sidecar provider turn started', {
        runId,
        providerType: args.provider.type,
        model: args.provider.model,
        tools: args.tools.map((tool) => tool.name),
        providerTurnOnly: true,
        signalAlreadyAborted: args.signal?.aborted === true,
        bufferedForeignEvents: pendingEvents.filter((pending) => pending.runId !== runId).length
      })

      if (args.signal) {
        if (args.signal.aborted) {
          logOptimizerTrace('warn', 'signal already aborted at start — cancelling own run', {
            runId,
            reason: args.signal.reason instanceof Error ? args.signal.reason.message : String(args.signal.reason ?? 'unknown')
          })
          void agentBridge.cancelAgent(runId).catch(() => {})
          finished = true
        } else {
          const onAbort = (): void => {
            const reason = args.signal?.reason
            logOptimizerTrace('warn', 'abort signalled mid-turn — cancelling run', {
              runId,
              reason: reason instanceof Error ? reason.message : String(reason ?? 'unknown')
            })
            void agentBridge.cancelAgent(runId).catch(() => {})
            finished = true
            wake()
          }
          args.signal.addEventListener('abort', onAbort, { once: true })
          abortCleanup = () => args.signal?.removeEventListener('abort', onAbort)
        }
      }

      for (const pending of pendingEvents.splice(0, pendingEvents.length)) {
        if (pending.runId && pending.runId !== runId) continue
        dispatchAgentEvent(pending.event)
        if (finished) break
      }

      while (!finished || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          continue
        }
        const next = queue.shift()
        if (next) yield next
      }
      logOptimizerTrace('info', 'sidecar provider turn stream ended', {
        runId,
        queuedLeftover: queue.length,
        sawLoopEnd: finished
      })
    } finally {
      abortCleanup?.()
      unsubscribe()
    }
  } catch (error) {
    yield toProviderErrorEvent(error)
  }
}

export async function runSidecarTextRequest(args: {
  provider: ProviderConfig
  messages: UnifiedMessage[]
  signal?: AbortSignal
  maxIterations?: number
  responsesSessionScope?: string
}): Promise<string> {
  const provider = withAuxiliaryResponsesRequestPolicy(
    args.provider,
    args.responsesSessionScope ?? RESPONSES_SESSION_SCOPE_SIDECAR_TEXT_REQUEST
  )
  const sidecarRequest = buildSidecarAgentRunRequest({
    messages: args.messages,
    provider,
    tools: [],
    maxIterations: args.maxIterations ?? 1,
    forceApproval: false
  })
  if (!sidecarRequest) {
    throw new Error('Sidecar request build failed')
  }

  if (!isNativeSidecarProviderConfig(provider)) {
    throw new Error('Sidecar capability unavailable')
  }

  const supportsAgentRun = await canSidecarHandle('agent.run')
  const supportsProvider = await canSidecarHandle(`provider.${provider.type}`)
  if (!supportsAgentRun || !supportsProvider) {
    throw new Error('Sidecar capability unavailable')
  }

  const initialized = await agentBridge.initialize()
  if (!initialized) {
    throw new Error('Sidecar unavailable')
  }

  let text = ''
  let settled = false
  let unsubscribe: (() => void) | null = null
  let runId = ''
  const pendingEvents: Array<{ runId: string; event: { type: string; [key: string]: unknown } }> =
    []

  try {
    await new Promise<void>((resolve, reject) => {
      const handleEvent = (event: { type: string; [key: string]: unknown }): void => {
        switch (event.type) {
          case 'text_delta':
            if (typeof event.text === 'string' && event.text) text += event.text
            break
          case 'error':
            settled = true
            args.signal?.removeEventListener('abort', abortHandler)
            reject(event.error instanceof Error ? event.error : new Error(String(event.error)))
            break
          case 'loop_end':
            settled = true
            args.signal?.removeEventListener('abort', abortHandler)
            resolve()
            break
          default:
            break
        }
      }

      const onAbort = async (): Promise<void> => {
        try {
          if (runId) {
            await agentBridge.cancelAgent(runId)
          }
        } catch {
          // ignore cancellation races
        }
        reject(new Error('aborted'))
      }

      if (args.signal?.aborted) {
        void onAbort()
        return
      }

      const abortHandler = (): void => {
        void onAbort()
      }
      args.signal?.addEventListener('abort', abortHandler, { once: true })

      unsubscribe = agentStream.subscribeAll((eventRunId, _sessionId, streamEvent) => {
        const event = toAgentEvent(streamEvent)
        if (!event) return

        if (!runId) {
          pendingEvents.push({
            runId: eventRunId,
            event: event as unknown as { type: string; [key: string]: unknown }
          })
          return
        }

        if (eventRunId !== runId) return
        handleEvent(event as unknown as { type: string; [key: string]: unknown })
      })

      void (async () => {
        try {
          const result = await agentBridge.runAgent(sidecarRequest)
          runId = result.runId
          for (const pending of pendingEvents.splice(0, pendingEvents.length)) {
            if (pending.runId && pending.runId !== runId) continue
            handleEvent(pending.event)
            if (settled) break
          }
        } catch (error) {
          args.signal?.removeEventListener('abort', abortHandler)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    })
  } finally {
    runSidecarCleanup(unsubscribe)
    if (!settled) {
      try {
        await agentBridge.cancelAgent(runId)
      } catch {
        // ignore cancellation races
      }
    }
  }

  return text
}

export async function runSidecarContextCompression(args: {
  provider: ProviderConfig
  messages: UnifiedMessage[]
  signal?: AbortSignal
  preserveCount?: number
  focusPrompt?: string
  pinnedContext?: string
  trigger?: 'auto' | 'manual'
  preTokens?: number
  sessionId?: string
}): Promise<{
  messages: UnifiedMessage[]
  result: CompressionResult
  compactArtifacts?: UnifiedMessage[]
}> {
  if (args.signal?.aborted) {
    throw new Error('aborted')
  }

  const initialized = await agentBridge.initialize()
  if (!initialized) {
    throw new Error('Sidecar unavailable')
  }

  const messages = args.messages.map((message) => {
    const meta = sanitizeSidecarMessageMeta(message.meta)
    if (meta === message.meta) return message
    return meta ? { ...message, meta } : { ...message, meta: undefined }
  })

  const result = await ipcClient.invoke('worker:request', {
    method: 'agent/compress-context',
    params: {
      provider: args.provider,
      messages,
      ...(typeof args.preserveCount === 'number' && Number.isFinite(args.preserveCount)
        ? { preserveCount: args.preserveCount }
        : {}),
      ...(args.focusPrompt ? { focusPrompt: args.focusPrompt } : {}),
      ...(args.pinnedContext ? { pinnedContext: args.pinnedContext } : {}),
      ...(args.trigger ? { trigger: args.trigger } : {}),
      ...(typeof args.preTokens === 'number' && Number.isFinite(args.preTokens)
        ? { preTokens: args.preTokens }
        : {}),
      ...(args.sessionId ? { sessionId: args.sessionId } : {})
    }
  })

  if (args.signal?.aborted) {
    throw new Error('aborted')
  }

  return result as {
    messages: UnifiedMessage[]
    result: CompressionResult
    compactArtifacts?: UnifiedMessage[]
  }
}
