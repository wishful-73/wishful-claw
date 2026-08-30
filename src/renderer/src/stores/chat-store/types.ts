import type { TokenUsageWire, RequestTimingWire } from '@shared/agent-stream-protocol'
import type { RequestDebugInfo, MessageMeta, ContentBlock } from '@renderer/lib/api/types'

// ─── Session Context ───
export type SessionMode = 'chat' | 'clarify' | 'cowork' | 'code' | 'acp'
export type SessionScope = 'global' | 'project'
export type CollaborationMode = 'chat' | 'cowork'
export type PermissionMode = 'default' | 'fullAccess'

export type SessionModelSelectionMode = 'inherit' | 'auto' | 'manual'

// ─── Chat Message ───
export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'completed' | 'error'
  output?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface ContentSegment {
  type: 'thinking' | 'text' | 'tool_use'
  iteration: number
  thinking?: string
  text?: string
  toolCallId?: string
  toolName?: string
  input?: Record<string, unknown>
  status?: 'running' | 'completed' | 'error'
  output?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface MemoryRecallInfo {
  /** One of: injected, already_injected, no_match, filtered_by_threshold, empty_message. */
  reason: string
  /** Titles (or #id) of entries actually injected. */
  hits: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  thinking?: string
  thinkingEncrypted?: boolean
  isStreaming?: boolean
  usage?: TokenUsageWire
  timing?: RequestTimingWire
  error?: string
  toolCalls?: ToolCallInfo[]
  segments?: ContentSegment[]
  currentIteration?: number
  debugInfo?: RequestDebugInfo
  memoryRecall?: MemoryRecallInfo
  meta?: MessageMeta
  content?: string | ContentBlock[]
  preToolPhase?: boolean
  _revision?: number
  createdAt: number
}

// ─── Session ───
export interface Session {
  id: string
  title: string
  icon?: string
  mode: SessionMode
  scope: SessionScope
  collaborationMode: CollaborationMode
  permissionMode: PermissionMode
  messages: ChatMessage[]
  messageCount: number
  messagesLoaded: boolean
  loadedRangeStart: number
  loadedRangeEnd: number
  // Total conversation turns (user messages) reported by the last turn-based load.
  totalTurns?: number
  lastKnownMessageCount?: number
  createdAt: number
  updatedAt: number
  projectId?: string
  workingFolder?: string
  sshConnectionId?: string
  planId?: string
  pinned?: boolean
  pluginId?: string
  pluginType?: string
  externalChatId?: string
  pluginChatType?: 'p2p' | 'group'
  pluginSenderId?: string
  pluginSenderName?: string
  modelSelectionMode?: SessionModelSelectionMode
  providerId?: string
  modelId?: string
  personaId?: string
  // Session-cumulative cache counters from backend (Reasonix-style).
  // Updated on each message_end event, read directly by the status bar.
  sessionCacheHit?: number
  sessionCacheMiss?: number
}

// ─── Project ───
export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  workingFolder?: string
  sshConnectionId?: string
  pluginId?: string
  pinned?: boolean
  providerId?: string
  modelId?: string
  sessionCount?: number
}

// ─── Create Session Options ───
export interface CreateSessionOptions {
  scope?: SessionScope
  collaborationMode?: CollaborationMode
  permissionMode?: PermissionMode
  preserveProjectless?: boolean
  planId?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
}

// ─── Session Prompt Snapshot (placeholder, 迭代七完善) ───
export interface SessionPromptSnapshot {
  mode: SessionMode
  planMode: boolean
  systemPrompt: string
  toolDefs: unknown[]
  projectId?: string
  workingFolder?: string
  sshConnectionId?: string | null
  contextCacheKey?: string
  systemHash?: string
  toolsHash?: string
  toolCount?: number
  createdAt?: number
}

export function createRestorableSessionSnapshot(session: Session): Session {
  return {
    id: session.id,
    title: session.title,
    icon: session.icon,
    mode: session.mode,
    scope: session.scope,
    collaborationMode: session.collaborationMode,
    permissionMode: session.permissionMode,
    messages: session.messages,
    messageCount: session.messageCount,
    messagesLoaded: session.messagesLoaded,
    loadedRangeStart: session.loadedRangeStart,
    loadedRangeEnd: session.loadedRangeEnd,
    totalTurns: session.totalTurns,
    lastKnownMessageCount: session.lastKnownMessageCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    projectId: session.projectId,
    workingFolder: session.workingFolder,
    sshConnectionId: session.sshConnectionId,
    planId: session.planId,
    pinned: session.pinned,
    pluginId: session.pluginId,
    externalChatId: session.externalChatId,
    pluginChatType: session.pluginChatType,
    pluginSenderId: session.pluginSenderId,
    pluginSenderName: session.pluginSenderName,
    modelSelectionMode: session.modelSelectionMode,
    providerId: session.providerId,
    modelId: session.modelId,
    sessionCacheHit: session.sessionCacheHit,
    sessionCacheMiss: session.sessionCacheMiss
  }
}
