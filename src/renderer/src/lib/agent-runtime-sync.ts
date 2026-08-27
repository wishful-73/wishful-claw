/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { SubAgentEvent } from '@renderer/lib/agent/sub-agents/types'
import type { TeamEvent } from '@renderer/lib/agent/teams/types'
import type { ToolCallState } from '@renderer/lib/agent/types'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { TaskItem } from '@renderer/stores/task-store'
import type { ActiveTeam } from '@renderer/stores/team-store'
import type { TeamRuntimeSnapshot } from '../../../shared/team-runtime-types'

export type AgentRuntimeSyncEvent =
  | { kind: 'set_running'; running: boolean }
  | {
      kind: 'set_session_status'
      sessionId: string
      status: 'running' | 'retrying' | 'completed' | null
    }
  | { kind: 'add_tool_call'; toolCall: ToolCallState; sessionId?: string | null }
  | {
      kind: 'update_tool_call'
      id: string
      patch: Partial<ToolCallState>
      sessionId?: string | null
    }
  | { kind: 'task_add'; task: TaskItem }
  | {
      kind: 'task_update'
      id: string
      patch: Partial<Omit<TaskItem, 'id' | 'createdAt'>>
    }
  | { kind: 'task_delete'; id: string }
  | { kind: 'task_delete_session'; sessionId: string }
  | { kind: 'team_event'; event: TeamEvent; sessionId?: string | null }
  | { kind: 'team_snapshot'; snapshot: TeamRuntimeSnapshot; sessionId?: string | null }
  | {
      kind: 'team_meta'
      patch: Partial<Pick<ActiveTeam, 'permissionMode' | 'teamAllowedPaths'>>
    }
  | { kind: 'clear_session_team'; sessionId: string }
  | { kind: 'subagent_event'; event: SubAgentEvent; sessionId?: string | null }
  | { kind: 'resolve_approval'; toolCallId: string; approved: boolean }
  | { kind: 'clear_pending_approvals' }

let suppressionDepth = 0

export function isAgentRuntimeSyncSuppressed(): boolean {
  return suppressionDepth > 0
}

export function withAgentRuntimeSyncSuppressed<T>(fn: () => T): T {
  suppressionDepth += 1
  try {
    return fn()
  } finally {
    suppressionDepth = Math.max(0, suppressionDepth - 1)
  }
}

export function emitAgentRuntimeSync(event: AgentRuntimeSyncEvent): void {
  if (isAgentRuntimeSyncSuppressed()) return
  ipcClient.send(IPC.AGENT_RUNTIME_SYNC, event)
}
