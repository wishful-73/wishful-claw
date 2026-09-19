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
  /** 会话级「请求上下文上限」（iter-32 S-73/S-84）的 token 数，0 / 缺省 = 不限制。 */
  contextCapTokens?: number | null
  /** 设这个上限时的模型 id；模型换了上限即作废（见 resolveSessionContextCapTokens）。 */
  contextCapModelId?: string | null
  /** 会话级「压缩阈值」（iter-32 S-85）的比例，0 / 缺省 = 跟随全局设置。 */
  compressionThreshold?: number | null
  projectId?: string | null
}

export const DEFAULT_SESSION_CONTEXT: SessionContextDefaults = {
  projectCollaborationMode: 'cowork',
  coworkPermissionMode: 'fullAccess'
}

export function normalizeSessionContext(
  input: SessionContextInput,
  defaults: SessionContextDefaults = DEFAULT_SESSION_CONTEXT
): Pick<
  Session,
  | 'scope'
  | 'collaborationMode'
  | 'permissionMode'
  | 'contextCapTokens'
  | 'contextCapModelId'
  | 'compressionThreshold'
  | 'projectId'
> {
  const scope: SessionScope =
    input.scope === 'global' || input.scope === 'project'
      ? input.scope
      : input.projectId
        ? 'project'
        : 'global'

  // Permission mode is independent of collaboration mode and its default is shared by
  // every session kind (iter-31 S-59 — 老大: "YOLO 也共享 cowork 中的默认值"). An
  // explicit choice always wins; otherwise take the workspace default, so chat and
  // global sessions stop being pinned to 'default' while cowork keeps its behaviour.
  const requestedPermissionMode =
    input.permissionMode === 'default' || input.permissionMode === 'fullAccess'
      ? input.permissionMode
      : null
  const permissionMode = requestedPermissionMode ?? defaults.coworkPermissionMode

  // Request-context cap (iter-32 S-73/S-84) is opt-in per session. 0 means "not set";
  // the model id is kept alongside so a model switch invalidates the cap instead of
  // silently carrying an old number onto a window it was never meant for.
  const contextCapTokens =
    typeof input.contextCapTokens === 'number' &&
    Number.isFinite(input.contextCapTokens) &&
    input.contextCapTokens > 0
      ? Math.floor(input.contextCapTokens)
      : 0
  const contextCapModelId =
    contextCapTokens > 0 &&
    typeof input.contextCapModelId === 'string' &&
    input.contextCapModelId.trim().length > 0
      ? input.contextCapModelId.trim()
      : null

  // Session-level compression threshold (iter-32 S-85). 0 is the sentinel for "not
  // set — follow the global setting", so an out-of-range value must fall back to 0
  // rather than being clamped to a boundary (that would trap the user away from the
  // follow-global option). Keep the same 0.3 ~ 0.9 window the global setting uses.
  const requestedThreshold = input.compressionThreshold
  const compressionThreshold =
    typeof requestedThreshold === 'number' &&
    Number.isFinite(requestedThreshold) &&
    requestedThreshold >= 0.3 &&
    requestedThreshold <= 0.9
      ? requestedThreshold
      : 0

  if (scope === 'global') {
    return {
      scope: 'global',
      collaborationMode: 'chat',
      permissionMode,
      contextCapTokens,
      contextCapModelId,
      compressionThreshold,
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
    // Same rule as the global branch: an explicit choice always wins, otherwise the
    // shared workspace default — collaboration mode no longer changes the fallback.
    permissionMode,
    contextCapTokens,
    contextCapModelId,
    compressionThreshold,
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

/**
 * 会话的项目归属，全局域会话返回 null。必须从会话列表派生而不是拿
 * `activeProjectId` 猜——切会话时后者还停在上一个项目，会把错误的作用域带过去。
 */
export function resolveSessionProjectId(
  sessions: readonly Pick<Session, 'id' | 'scope' | 'projectId'>[],
  sessionId: string | null | undefined
): string | null {
  if (!sessionId) return null
  const session = sessions.find((item) => item.id === sessionId)
  return getSessionScope(session) === 'project' ? session?.projectId ?? null : null
}
