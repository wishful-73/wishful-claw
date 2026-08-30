import type {
  CollaborationMode,
  PermissionMode,
  Session,
  SessionScope
} from '@renderer/stores/chat-store/types'

export interface SessionContextDefaults {
  projectCollaborationMode: CollaborationMode
  coworkPermissionMode: PermissionMode
}

interface SessionContextInput {
  scope?: SessionScope | null
  collaborationMode?: CollaborationMode | null
  permissionMode?: PermissionMode | null
  projectId?: string | null
}

export const DEFAULT_SESSION_CONTEXT: SessionContextDefaults = {
  projectCollaborationMode: 'cowork',
  coworkPermissionMode: 'fullAccess'
}

export function normalizeSessionContext(
  input: SessionContextInput,
  defaults: SessionContextDefaults = DEFAULT_SESSION_CONTEXT
): Pick<Session, 'scope' | 'collaborationMode' | 'permissionMode' | 'projectId'> {
  const scope: SessionScope =
    input.scope === 'global' || input.scope === 'project'
      ? input.scope
      : input.projectId
        ? 'project'
        : 'global'

  if (scope === 'global') {
    return {
      scope: 'global',
      collaborationMode: 'chat',
      permissionMode: 'default',
      projectId: undefined
    }
  }

  if (!input.projectId) {
    throw new Error('Project sessions require projectId.')
  }

  const collaborationMode: CollaborationMode =
    input.collaborationMode === 'chat' || input.collaborationMode === 'cowork'
      ? input.collaborationMode
      : defaults.projectCollaborationMode

  return {
    scope: 'project',
    collaborationMode,
    permissionMode:
      collaborationMode === 'chat'
        ? 'default'
        : input.permissionMode === 'default' || input.permissionMode === 'fullAccess'
          ? input.permissionMode
          : defaults.coworkPermissionMode,
    projectId: input.projectId
  }
}

export function getSessionScope(
  session?: Pick<Session, 'scope' | 'projectId'> | null
): SessionScope | null {
  if (!session) return null
  if (session.scope === 'global' || session.scope === 'project') return session.scope
  return session.projectId ? 'project' : 'global'
}
