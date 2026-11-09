import type {
  UnifiedMessage
} from '@renderer/lib/api/types'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'


class AgentBridgeClient {
  private initialized = false
  private initializePromise: Promise<boolean> | null = null

  async initialize(): Promise<boolean> {
    if (this.initialized) return true
    if (!this.initializePromise) {
      this.initializePromise = this.initializeWithRetry().finally(() => {
        this.initializePromise = null
      })
    }

    return await this.initializePromise
  }

  private async initializeWithRetry(): Promise<boolean> {
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // worker:request auto-starts the worker via ensureStarted(); a ping
        // verifies the named-pipe connection is live.
        await ipcClient.invoke('worker:request', { method: 'worker/ping', params: {} })
        this.initialized = true
        return true
      } catch (err) {
        this.initialized = false
        console.error(`[AgentBridge] Initialize failed (attempt ${attempt}/${maxAttempts}):`, err)

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }

        return false
      }
    }

    return false
  }

  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    return await ipcClient.invoke('worker:request', { method, params, timeoutMs })
  }

  notify(method: string, params?: unknown): void {
    ipcClient.send('sidecar:notify', method, params)
  }

  async isRunning(): Promise<boolean> {
    try {
      await ipcClient.invoke('worker:request', { method: 'worker/ping', params: {} })
      return true
    } catch {
      return false
    }
  }

  async runAgent(params: unknown): Promise<{ started: boolean; runId: string }> {
    return await ipcClient.invoke(
      'worker:request',
      { method: 'agent/run', params }
    ) as { started: boolean; runId: string }
  }

  async cancelAgent(runId: string): Promise<{ cancelled: boolean; runId?: string }> {
    return await ipcClient.invoke(
      'worker:request',
      { method: 'agent/cancel', params: { runId } }
    ) as { cancelled: boolean; runId?: string }
  }

  /**
   * Cancel a specific sub-agent run (queued or running, including background/team
   * children that agent:cancel cannot reach) by its Task tool_use id.
   */
  async cancelSubAgent(
    toolUseId: string,
    sessionId?: string
  ): Promise<{ cancelled: boolean; count: number }> {
    return (await this.request('agent/cancel-subagent', {
      toolUseId,
      sessionId
    })) as { cancelled: boolean; count: number }
  }

  async requestStopAgent(runId: string): Promise<{ stopped: boolean; runId?: string }> {
    return await ipcClient.invoke(
      'worker:request',
      { method: 'agent/request-stop', params: { runId } }
    ) as { stopped: boolean; runId?: string }
  }

  async appendAgentMessages(
    runId: string,
    messages: UnifiedMessage[]
  ): Promise<{ appended: boolean; runId?: string; count: number }> {
    return await ipcClient.invoke(
      'worker:request',
      { method: 'agent/append-messages', params: { runId, messages } }
    ) as { appended: boolean; runId?: string; count: number }
  }

  async stop(): Promise<void> {
    // Worker lifecycle is managed by the main process; renderer stop is a no-op.
    this.initializePromise = null
    this.initialized = false
  }

  // The main process replaces the worker process transparently (supervised
  // restart); the replacement never saw this client's initialize handshake.
  markRuntimeRestarted(): void {
    this.initialized = false
  }
}

/**
 * Check if a capability is available via the main-process runtime bridge.
 */
export async function canSidecarHandle(capability: string): Promise<boolean> {
  // The worker supports agent.run, openai-chat, and anthropic providers.
  // No IPC round-trip needed — these are statically known.
  if (capability === 'agent.run') return true
  if (capability.startsWith('provider.')) {
    const providerType = capability.slice('provider.'.length)
    return providerType === 'openai-chat' || providerType === 'anthropic'
  }
  return false
}

/**
 * Singleton bridge client instance.
 */
export const agentBridge = new AgentBridgeClient()

ipcClient.on('sidecar:lifecycle', (payload) => {
  const state = (payload as { state?: string } | undefined)?.state
  if (state !== 'disconnected' && state !== 'reconnected') return
  agentBridge.markRuntimeRestarted()
})

// Bounded so the debug panel surfaces a failure quickly instead of hanging on
// the 60s native-worker default when a body read stalls.

// Re-export streaming functions from separate module
export { streamSidecarProviderTurn, runSidecarTextRequest, runSidecarContextCompression, readSidecarDebugBody } from './agent-bridge-streaming'
