/**
 * Channel-side shell approval.
 *
 * A channel run (WeChat / Feishu / ...) has no desktop UI to render the tool
 * approval dialog, so relaying `sub-agent:approve-tool` to the renderer used to
 * dead-end there. Instead the request is sent back to the channel as a message
 * and the user's next text reply decides it.
 *
 * Deliberately free of store/IPC imports: the caller injects the `send` callback
 * so this dispatch stays unit-testable in a bare node environment (the same
 * reason `quota-failure.ts` was split out).
 */

/** How long a channel approval waits before it is treated as a rejection. */
export const SHELL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

/** Words that mean "run it". Kept tight: an ambiguous reply is not a verdict. */
const APPROVE_WORDS = new Set(['同意', '批准', '允许', '是', 'yes', 'y', 'ok', '1'])

/** Words that mean "do not run it". */
const REJECT_WORDS = new Set(['拒绝', '取消', '否', 'no', 'n', '0'])

interface PendingApproval {
  toolCallId: string
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

const pendingBySession = new Map<string, PendingApproval>()

/** Whether this session is currently waiting on a channel shell approval. */
export function hasPendingChannelShellApproval(sessionId: string): boolean {
  return pendingBySession.has(sessionId)
}

/**
 * Interprets a channel message as an approval verdict.
 *
 * Returns null when the text is not a verdict — the caller must then treat the
 * message as an ordinary request and start a normal run, so an unrelated message
 * arriving during a pending approval is never swallowed.
 */
export function parseShellApprovalVerdict(content: string): boolean | null {
  const text = content.trim().toLowerCase()
  if (!text) return null
  if (APPROVE_WORDS.has(text)) return true
  if (REJECT_WORDS.has(text)) return false
  return null
}

/**
 * Consumes a channel message as an approval reply.
 *
 * Returns true when it resolved a pending approval (the caller must then NOT
 * start a new run); false when nothing was pending or the text is not a verdict.
 */
export function resolvePendingChannelShellApproval(sessionId: string, content: string): boolean {
  const entry = pendingBySession.get(sessionId)
  if (entry === undefined) return false
  const verdict = parseShellApprovalVerdict(content)
  if (verdict === null) return false
  clearTimeout(entry.timeout)
  pendingBySession.delete(sessionId)
  entry.resolve(verdict)
  return true
}

/** The prompt shown in the channel, including how to answer and the deadline. */
export function buildShellApprovalPrompt(toolName: string, summary: string): string {
  const detail = summary ? `\n\n${summary}` : ''
  return (
    `Agent 请求执行命令（${toolName}），需要你确认：${detail}\n\n` +
    '回复「同意」执行，回复「拒绝」取消。10 分钟内未回复将自动拒绝。'
  )
}

export interface ChannelShellApprovalRequest {
  sessionId: string
  toolCallId: string
  toolName: string
  summary: string
  /** Sends text back to the channel. Injected so this module stays store-free. */
  send: (message: string) => Promise<void>
}

/**
 * Registers a pending approval and resolves with the user's verdict.
 *
 * Times out to `false`: a silent channel must never leave the run hanging on an
 * approval the user never saw (the defect this exists to fix).
 */
export function requestChannelShellApproval(
  request: ChannelShellApprovalRequest
): Promise<boolean> {
  const { sessionId, toolCallId, toolName, summary, send } = request

  // At most one pending approval per session. The Worker already serializes
  // gated calls, so this only guards against a stale entry surviving a restart.
  const previous = pendingBySession.get(sessionId)
  if (previous !== undefined) {
    clearTimeout(previous.timeout)
    pendingBySession.delete(sessionId)
    previous.resolve(false)
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      const entry = pendingBySession.get(sessionId)
      if (entry === undefined || entry.toolCallId !== toolCallId) return
      pendingBySession.delete(sessionId)
      void send('审批已超时（10 分钟未回复），本次命令按拒绝处理。')
      resolve(false)
    }, SHELL_APPROVAL_TIMEOUT_MS)

    pendingBySession.set(sessionId, {
      toolCallId,
      resolve: (approved) => {
        resolve(approved)
        void send(approved ? '已同意执行。' : '已拒绝执行，本次命令不会运行。')
      },
      timeout
    })

    void send(buildShellApprovalPrompt(toolName, summary))
  })
}

/** Drops every pending approval, rejecting each. Used on renderer teardown. */
export function cancelAllPendingChannelShellApprovals(): void {
  for (const entry of pendingBySession.values()) {
    clearTimeout(entry.timeout)
    entry.resolve(false)
  }
  pendingBySession.clear()
}
