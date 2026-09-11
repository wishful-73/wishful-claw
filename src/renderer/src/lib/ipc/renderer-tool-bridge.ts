import { handleNativeBrowserToolRequest } from '@renderer/lib/tools/browser-native-ui'
import { handleMcpCapabilityList, handleMcpCapabilityInspect } from '@renderer/lib/tools/mcp-capability-bridge'
import { handleNativeAskUserRequest } from '@renderer/lib/tools/ask-user-tool'
import { handleSubAgentApprovalRequest } from '@renderer/lib/tools/sub-agent-approval'
import { handleNativePlanUiUpdate, handleNativePlanReviewRequest } from '@renderer/lib/tools/plan-native-ui'
import { handleNativeGoalConfirmRequest } from '@renderer/lib/tools/goal-native-ui'
import { handleSkillManagementExecute } from '@renderer/lib/tools/skill-management-bridge'
import { handleProjectSendSessionMessage } from '@renderer/lib/tools/project-send-message'
import { handleSessionFollowUpUpdate } from '@renderer/lib/tools/session-follow-up-runtime'
import { decodeIpcMessagePack, invokeMessagePack } from '@renderer/lib/ipc/messagepack-ipc-client'
import {
  SIDECAR_RENDERER_TOOL_REQUEST_MSGPACK_CHANNEL,
  SIDECAR_RENDERER_TOOL_RESPONSE_MSGPACK_CHANNEL
} from '../../../../shared/messagepack/binary-ipc'

// Native AgentRuntime owns the loop and tool execution. This bridge is only
// for renderer/UI boundaries that cannot live inside the native worker.

type RendererToolRequestPayload = { requestId: string; method: string; params: unknown }
type RendererToolResponsePayload = { requestId: string; result?: unknown; error?: string }

type RendererToolBridgeWindow = Window & {
  __wishfulClawRendererToolBridgeCleanup?: () => void
}

function getBridgeWindow(): RendererToolBridgeWindow {
  return window as RendererToolBridgeWindow
}

async function sendRendererToolResponse(response: RendererToolResponsePayload): Promise<void> {
  await invokeMessagePack(SIDECAR_RENDERER_TOOL_RESPONSE_MSGPACK_CHANNEL, response)
}

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within
 * timeoutMs, rejects with a timeout error so the caller can still send
 * an error response back to the worker instead of leaving the agent
 * hanging forever.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function handleRendererToolRequest(payload: RendererToolRequestPayload): Promise<void> {
  if (!payload?.requestId) return

  try {
    if (payload.method === 'browser/tool-request') {
      // Browser tools must return quickly even on failure — the agent loop
      // is blocked waiting for the result. 20s is generous enough for page
      // loads but prevents infinite hangs if the webview never attaches.
      const result = await withTimeout(
        handleNativeBrowserToolRequest(payload.params),
        60_000,
        'browser/tool-request'
      )
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'ask-user/request') {
      // ask-user may wait for explicit user interaction — no extra timeout
      // here; the Main process 60s fallback covers the worst case.
      const result = await handleNativeAskUserRequest(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'mcp:capability-list') {
      const result = await handleMcpCapabilityList()
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'mcp:capability-inspect') {
      const result = await handleMcpCapabilityInspect(payload.params as { serverId: string; toolName: string })
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'skill-management:execute') {
      const result = await handleSkillManagementExecute(payload.params as { toolName: string; input: Record<string, unknown> })
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'sub-agent:approve-tool') {
      // Sub-agent tool approval — waits for user to click approve/reject
      // in the SubAgentCard UI. 5 min auto-reject fallback in the handler.
      const result = await handleSubAgentApprovalRequest(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'plan/review-request') {
      // Plan review waits for explicit user interaction (approve/reject).
      const result = await handleNativePlanReviewRequest(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'goal/confirm-request') {
      // Goal confirmation waits for explicit user interaction (confirm/discard).
      const result = await handleNativeGoalConfirmRequest(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'project/send-session-message') {
      const result = await handleProjectSendSessionMessage(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'session-follow-up/update') {
      const result = await handleSessionFollowUpUpdate(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }

    if (payload.method === 'plan/ui-update') {
      // Plan UI update — sync plan state from native worker to renderer store.
      const result = await handleNativePlanUiUpdate(payload.params)
      await sendRendererToolResponse({
        requestId: payload.requestId,
        result
      })
      return
    }
  } catch (error) {
    // CRITICAL: even if the tool handler throws or times out, we must send
    // a response back so the agent loop doesn't hang forever.
    await sendRendererToolResponse({
      requestId: payload.requestId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function attachRendererToolBridge(): void {
  const bridgeWindow = getBridgeWindow()
  bridgeWindow.__wishfulClawRendererToolBridgeCleanup?.()
  bridgeWindow.__wishfulClawRendererToolBridgeCleanup = undefined
  window.electron.ipcRenderer.removeAllListeners(SIDECAR_RENDERER_TOOL_REQUEST_MSGPACK_CHANNEL)

  const msgpackCleanup = window.electron.ipcRenderer.on(
    SIDECAR_RENDERER_TOOL_REQUEST_MSGPACK_CHANNEL,
    async (_event: unknown, bytes: ArrayBuffer | ArrayBufferView) => {
      await handleRendererToolRequest(decodeIpcMessagePack<RendererToolRequestPayload>(bytes))
    }
  )
  bridgeWindow.__wishfulClawRendererToolBridgeCleanup = () => {
    msgpackCleanup()
  }
}
