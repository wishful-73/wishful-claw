/**
 * Stub reverse-request handlers for features that require external
 * infrastructure not yet available in wishful-claw.
 *
 * Channel (feishu/weixin) handlers have been moved to channel-handlers.ts
 * and are dispatched directly from reverse-handlers/index.ts.
 */

// ── Extension ──

export async function handleExtensionExecuteJsTool(params: Record<string, unknown>): Promise<unknown> {
  const toolName = params.toolName as string | undefined
  return {
    success: false,
    error: `Extension tool "${toolName}" failed: no extension runtime configured. Install extensions first.`
  }
}

// ── Team ──

interface TeamMessage {
  id: string
  teamId: string
  fromMemberId: string
  toMemberId: string | null
  content: unknown
  createdAt: number
}

const teamMessages = new Map<string, TeamMessage[]>()
let teamMsgCounter = 0

export async function handleTeamSendMessage(params: Record<string, unknown>): Promise<unknown> {
  const teamId = params.teamId as string | undefined
  const fromMemberId = params.fromMemberId as string | undefined
  if (!teamId || !fromMemberId) {
    return { success: false, error: 'teamId and fromMemberId are required' }
  }

  teamMsgCounter += 1
  const msg: TeamMessage = {
    id: `msg-${Date.now().toString(36)}-${teamMsgCounter}`,
    teamId,
    fromMemberId,
    toMemberId: (params.toMemberId as string) ?? null,
    content: params.content ?? params.message ?? '',
    createdAt: Date.now()
  }

  const queue = teamMessages.get(teamId) ?? []
  queue.push(msg)
  teamMessages.set(teamId, queue)

  return { success: true, messageId: msg.id }
}

/** Dispatcher for all stub handlers */
export async function handleStubReverseRequest(
  method: string,
  params: unknown
): Promise<unknown> {
  const args = (params as Record<string, unknown>) ?? {}

  // Extension
  if (method === 'extension:execute-js-tool') return handleExtensionExecuteJsTool(args)

  // Team
  if (method === 'team:send-message') return handleTeamSendMessage(args)

  return { success: false, error: `Unknown method: ${method}` }
}
