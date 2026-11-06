import type {
  AgentStore,
  SessionExecutionStatus,
  SubAgentState
} from '../../stores/agent-store/types'
import type { ToolCallState } from './types'

/**
 * 会话作用域的 agent 编排视图。
 *
 * 背景（S-342）：本文件原是 OpenCowork 时代留的桩，无论传什么会话都返回同一份
 * 空常量。调用方（`useMessageListData` / `StaticMessageTranscript` / `MessageList`）
 * 把返回值直接接到了渲染判断上，于是 `hasOrchestrationData` 恒 false —— 子 agent
 * 编排时间轴只在有 team 数据时才出现，单靠 sub-agent 的编排永远不渲染。
 *
 * 现在的实现：agent-store 的三张表（active / completed / history）都是**全局**的，
 * 每个 `SubAgentState` 自带 `sessionId`，这里按会话过滤出一个视图。
 *
 * 稳定性要求：调用方把它丢进 `useAgentStore(selector)`，zustand 用 `Object.is`
 * 比对返回值。每次调用都造新对象会让订阅方无限重渲染，所以按「源引用三元组 +
 * 运行状态」缓存，源不动就返回同一个对象引用。
 */

export interface SessionScopedAgentSelection {
  activeSubAgents: Record<string, SubAgentState>
  completedSubAgents: Record<string, SubAgentState>
  subAgentHistory: SubAgentState[]
  hasActiveToolCallOutput: boolean
  isSessionRunning: boolean
  hasOrchestrationData: boolean
  signature: string
  toolCalls: ToolCallState[]
}

const EMPTY_SUB_AGENT_MAP: Record<string, SubAgentState> = {}
const EMPTY_SUB_AGENT_HISTORY: SubAgentState[] = []
const EMPTY_TOOL_CALLS: ToolCallState[] = []

const EMPTY_SELECTION: SessionScopedAgentSelection = {
  activeSubAgents: EMPTY_SUB_AGENT_MAP,
  completedSubAgents: EMPTY_SUB_AGENT_MAP,
  subAgentHistory: EMPTY_SUB_AGENT_HISTORY,
  hasActiveToolCallOutput: false,
  isSessionRunning: false,
  hasOrchestrationData: false,
  signature: 'empty',
  toolCalls: EMPTY_TOOL_CALLS
}

interface CacheEntry {
  activeRef: Record<string, SubAgentState>
  completedRef: Record<string, SubAgentState>
  historyRef: SubAgentState[]
  pendingRef: ToolCallState[]
  executedRef: ToolCallState[]
  running: SessionExecutionStatus | undefined
  value: SessionScopedAgentSelection
}

/** 会话数上限保护：切过太多会话就整表丢掉，重新积累。 */
const MAX_CACHED_SESSIONS = 32

const selectionCache = new Map<string, CacheEntry>()

/** 工具调用里算「正在输出」的状态。`completed` / `error` / `canceled` 都不算。 */
const ACTIVE_TOOL_CALL_STATUSES = new Set(['streaming', 'pending_approval', 'running'])

function filterBySession<T extends SubAgentState>(
  source: Record<string, T>,
  sessionId: string
): Record<string, T> {
  let filtered: Record<string, T> | null = null
  for (const [key, value] of Object.entries(source)) {
    if (value.sessionId !== sessionId) continue
    if (!filtered) filtered = {}
    filtered[key] = value
  }
  return filtered ?? (EMPTY_SUB_AGENT_MAP as Record<string, T>)
}

function filterHistoryBySession(source: SubAgentState[], sessionId: string): SubAgentState[] {
  const filtered = source.filter((entry) => entry.sessionId === sessionId)
  return filtered.length > 0 ? filtered : EMPTY_SUB_AGENT_HISTORY
}

function resolveToolCallBuckets(
  state: AgentStore,
  sessionId: string
): { pending: ToolCallState[]; executed: ToolCallState[] } {
  if (sessionId === state.liveSessionId) {
    return { pending: state.pendingToolCalls, executed: state.executedToolCalls }
  }
  const cache = state.sessionToolCallsCache[sessionId]
  if (cache) return cache
  return { pending: EMPTY_TOOL_CALLS, executed: EMPTY_TOOL_CALLS }
}

function isSessionRunningStatus(status: SessionExecutionStatus | undefined): boolean {
  return status === 'running' || status === 'retrying'
}

function hasActiveToolCallOutput(pending: ToolCallState[], executed: ToolCallState[]): boolean {
  for (const toolCall of pending) {
    if (ACTIVE_TOOL_CALL_STATUSES.has(toolCall.status)) return true
  }
  for (const toolCall of executed) {
    if (ACTIVE_TOOL_CALL_STATUSES.has(toolCall.status)) return true
  }
  return false
}

function countEntries(map: Record<string, SubAgentState>): number {
  return Object.keys(map).length
}

export function selectSessionScopedAgentState(
  state: AgentStore,
  sessionId: string | null | undefined,
  _options?: { mode?: string }
): SessionScopedAgentSelection {
  if (!sessionId) return EMPTY_SELECTION

  const running = state.runningSessions[sessionId]
  const buckets = resolveToolCallBuckets(state, sessionId)

  const cached = selectionCache.get(sessionId)
  if (
    cached &&
    cached.activeRef === state.activeSubAgents &&
    cached.completedRef === state.completedSubAgents &&
    cached.historyRef === state.subAgentHistory &&
    cached.pendingRef === buckets.pending &&
    cached.executedRef === buckets.executed &&
    cached.running === running
  ) {
    return cached.value
  }

  const activeSubAgents = filterBySession(state.activeSubAgents, sessionId)
  const completedSubAgents = filterBySession(state.completedSubAgents, sessionId)
  const subAgentHistory = filterHistoryBySession(state.subAgentHistory, sessionId)
  const hasOrchestrationData =
    countEntries(activeSubAgents) > 0 ||
    countEntries(completedSubAgents) > 0 ||
    subAgentHistory.length > 0
  const activeToolCallOutput = hasActiveToolCallOutput(buckets.pending, buckets.executed)

  const value: SessionScopedAgentSelection = {
    activeSubAgents,
    completedSubAgents,
    subAgentHistory,
    hasActiveToolCallOutput: activeToolCallOutput,
    isSessionRunning: isSessionRunningStatus(running),
    hasOrchestrationData,
    signature: `a${countEntries(activeSubAgents)}/c${countEntries(completedSubAgents)}/h${subAgentHistory.length}/${running ?? 'idle'}`,
    toolCalls: buckets.executed.length > 0 || buckets.pending.length > 0
      ? [...buckets.executed, ...buckets.pending]
      : EMPTY_TOOL_CALLS
  }

  if (selectionCache.size >= MAX_CACHED_SESSIONS && !selectionCache.has(sessionId)) {
    selectionCache.clear()
  }
  selectionCache.set(sessionId, {
    activeRef: state.activeSubAgents,
    completedRef: state.completedSubAgents,
    historyRef: state.subAgentHistory,
    pendingRef: buckets.pending,
    executedRef: buckets.executed,
    running,
    value
  })

  return value
}

/**
 * 从会话视图里按 `toolUseId` 找一条 sub-agent 记录。
 * 先活后死再历史，与 store 里 `activeSubAgents → completedSubAgents → subAgentHistory`
 * 的优先级一致。
 */
export function findSubAgentInSelection(
  selection: SessionScopedAgentSelection | null | undefined,
  toolUseId: string | null | undefined
): SubAgentState | null {
  if (!selection || !toolUseId) return null

  const live = selection.activeSubAgents[toolUseId] ?? selection.completedSubAgents[toolUseId]
  if (live) return live

  const fromHistory = selection.subAgentHistory.find((entry) => entry.toolUseId === toolUseId)
  return fromHistory ?? null
}

/** 仅供测试与诊断：清空缓存，让下一次调用强制重建。 */
export function resetSessionScopedAgentStateCache(): void {
  selectionCache.clear()
}
