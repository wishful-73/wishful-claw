/**
 * Sub-agent tool approval handler.
 *
 * When a sub-agent executes a tool that requires approval (Write, Edit, Bash, etc.),
 * the Worker sends a reverse-request via the renderer tool bridge. This module
 * registers a pending approval promise and returns it. The SubAgentCard UI
 * renders approve/reject buttons, and resolving the promise sends the response
 * back to the Worker.
 *
 * Race condition handling: the stream event (tool_call_start with pending_approval
 * status) may arrive at the renderer before the reverse-request reaches the
 * renderer tool bridge. To handle this, early resolutions are cached: if the
 * user clicks approve/reject before the reverse-request arrives, the result
 * is stored and applied when the request arrives.
 */

import { confirm } from '@renderer/components/ui/confirm-dialog'
import { inputSummary } from '@renderer/components/chat/tool-call-summary'

const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; toolName: string; input: Record<string, unknown> }
>()

/** Early resolutions: user clicked before reverse-request arrived. */
const earlyResolutions = new Map<string, boolean>()

export interface SubAgentApprovalRequest {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export interface SubAgentApprovalResponse {
  approved: boolean
}

/**
 * Called by the renderer tool bridge when a sub-agent:approve-tool
 * reverse-request arrives. Returns a promise that resolves when the
 * user clicks approve/reject in the SubAgentCard UI.
 *
 * If the user already clicked (early resolution), resolves immediately.
 */
export async function handleSubAgentApprovalRequest(
  params: unknown
): Promise<SubAgentApprovalResponse> {
  const record = isRecord(params) ? params : {}
  const toolCallId =
    typeof record.toolCallId === 'string' ? record.toolCallId.trim() : ''
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : ''
  const input = isRecord(record.input) ? record.input : {}

  if (!toolCallId) {
    return { approved: false }
  }

  // Default permission mode (main agent loop): no card UI is mounted for these
  // approvals, so resolve synchronously via a confirm dialog. sequence keeps
  // concurrent dialogs in tool-card order despite IPC arrival randomness.
  if (record.source === 'default-mode') {
    const detail = inputSummary(toolName, input)
    const approved = await confirm({
      title: `工具调用确认 — ${toolName}`,
      description: detail ? `即将执行：${detail}` : '此工具需要你的确认后才会执行。',
      confirmLabel: '允许执行',
      cancelLabel: '拒绝',
      variant: 'warning',
      sequence: typeof record.startedAt === 'number' ? record.startedAt : undefined
    })
    return { approved }
  }

  // Check if user already resolved before the request arrived
  if (earlyResolutions.has(toolCallId)) {
    const approved = earlyResolutions.get(toolCallId)!
    earlyResolutions.delete(toolCallId)
    return { approved }
  }

  return new Promise<SubAgentApprovalResponse>((resolve) => {
    pendingApprovals.set(toolCallId, {
      resolve: (approved: boolean) => resolve({ approved }),
      toolName,
      input
    })

    // Auto-reject after 5 minutes to prevent infinite hangs
    setTimeout(() => {
      if (pendingApprovals.has(toolCallId)) {
        pendingApprovals.delete(toolCallId)
        resolve({ approved: false })
      }
    }, 300_000)
  })
}

/**
 * Returns a specific pending approval by toolCallId, or null if not pending.
 */
export function getPendingApproval(toolCallId: string): SubAgentApprovalRequest | null {
  const entry = pendingApprovals.get(toolCallId)
  if (!entry) return null
  return { toolCallId, toolName: entry.toolName, input: entry.input }
}

/**
 * Resolves a pending approval. Called by SubAgentCard when user clicks
 * approve or reject.
 *
 * If the reverse-request hasn't arrived yet (early resolution), the result
 * is cached and applied when the request arrives.
 */
export function resolveSubAgentApproval(toolCallId: string, approved: boolean): void {
  const entry = pendingApprovals.get(toolCallId)
  if (entry) {
    pendingApprovals.delete(toolCallId)
    entry.resolve(approved)
  } else {
    // Early resolution: cache until the reverse-request arrives
    earlyResolutions.set(toolCallId, approved)
  }
}

/**
 * Checks if a tool call has been early-resolved (user clicked before
 * the reverse-request arrived). Used by UI to show "processing" state.
 */
export function isEarlyResolved(toolCallId: string): boolean {
  return earlyResolutions.has(toolCallId)
}

/**
 * Cancels all pending approvals (e.g. when session is closed).
 */
export function cancelAllPendingApprovals(): void {
  for (const [, entry] of pendingApprovals) {
    entry.resolve(false)
  }
  pendingApprovals.clear()
  earlyResolutions.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
