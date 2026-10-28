/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useAgentStore } from '@renderer/stores/agent-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { isRightPanelScopeActive } from '@renderer/stores/right-panel-scope'
import { removeTeamLimiter } from '../sub-agents/create-tool'
import { abortAllTeammates } from './team-native-control'
import type { TeamRuntimeSnapshot } from '../../../../../shared/team-runtime-types'

type NativeTeamUiUpdateResult = {
  ok: boolean
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTeamRuntimeSnapshot(value: unknown): value is TeamRuntimeSnapshot {
  return (
    isRecord(value) &&
    isRecord(value.team) &&
    typeof value.team.name === 'string' &&
    Array.isArray(value.recentMessages)
  )
}

export async function handleNativeTeamUiUpdate(params: unknown): Promise<NativeTeamUiUpdateResult> {
  const record = isRecord(params) ? params : {}
  const action = typeof record.action === 'string' ? record.action : ''
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined

  if (action === 'snapshot') {
    if (!isTeamRuntimeSnapshot(record.snapshot)) {
      return { ok: false, error: 'Invalid native team snapshot payload.' }
    }
    useTeamStore.getState().syncRuntimeSnapshot(record.snapshot, sessionId)
    if (record.openPanel === true) {
      const ui = useUIStore.getState()
      // S-259：与 register.ts 的 team_start 同一判据 —— 后台会话的团队快照
      // 不许掀开用户面前的面板（会撑开一片空白，因为内容按会话作用域过滤）。
      if (isRightPanelScopeActive(ui, sessionId)) {
        ui.setRightPanelOpen(true)
        ui.setRightPanelTab('team')
      }
    }
    return { ok: true }
  }

  if (action === 'end') {
    const team = useTeamStore.getState().activeTeam
    if (team?.name) {
      abortAllTeammates()
      useAgentStore.getState().clearPendingApprovals()
      removeTeamLimiter(team.name)
    }
    useTeamStore
      .getState()
      .handleTeamEvent({ type: 'team_end', sessionId: sessionId ?? team?.sessionId })
    return { ok: true }
  }

  return { ok: false, error: `Unsupported native team UI action: ${action}` }
}
