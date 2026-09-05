/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { Session } from '@renderer/stores/chat-store'
import type { ChatView } from '@renderer/stores/ui-store'

const PROJECT_SCOPED_VIEWS = new Set<ChatView>(['project', 'archive', 'channels', 'git'])

interface SessionScopeInput {
  chatView: ChatView
  session?: Pick<Session, 'scope' | 'projectId'> | null
  activeProjectId?: string | null
  workingFolder?: string | null
}

export function isProjectSession({
  chatView,
  session,
  activeProjectId
}: SessionScopeInput): boolean {
  if (session) {
    if (session.scope === 'global') return false
    if (session.scope === 'project') return true
    return Boolean(session.projectId)
  }

  return PROJECT_SCOPED_VIEWS.has(chatView) && Boolean(activeProjectId)
}

export function isChatSession(input: SessionScopeInput): boolean {
  return !isProjectSession(input)
}

export function workspaceContextAvailable(input: SessionScopeInput): boolean {
  return isProjectSession(input) && Boolean(input.workingFolder?.trim())
}
