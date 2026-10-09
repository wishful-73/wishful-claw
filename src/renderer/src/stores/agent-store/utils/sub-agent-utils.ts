
import type {
  UnifiedMessage,
  ContentBlock,
  MessageRequestModelMeta
} from '../../../lib/api/types'
import { calculateCacheReadRatio } from '../../../lib/agent/cache-shape'
import type { SubAgentState, SessionSubAgentLiveState } from '../types'
import { MAX_COMPLETED_SUBAGENTS } from '../constants'

export function trimSubAgentTranscript(sa: { transcript: UnifiedMessage[] }): void {
  void sa
}

export function sumOptionalUsageValue(current?: number, incoming?: number): number | undefined {
  const total = (current ?? 0) + (incoming ?? 0)
  return total || undefined
}

export function mergeMessageUsage(
  current: UnifiedMessage['usage'],
  incoming: UnifiedMessage['usage']
): UnifiedMessage['usage'] {
  if (!incoming) return current
  if (!current) {
    const cacheReadRatio = calculateCacheReadRatio(incoming)
    const { cacheReadRatio: _cacheReadRatio, ...incomingWithoutRatio } = incoming
    return {
      ...incomingWithoutRatio,
      requestTimings: incoming.requestTimings ? [...incoming.requestTimings] : undefined,
      ...(cacheReadRatio !== undefined ? { cacheReadRatio } : {})
    }
  }

  const inputTokens = current.inputTokens + incoming.inputTokens
  const cacheReadTokens = sumOptionalUsageValue(current.cacheReadTokens, incoming.cacheReadTokens)
  const mergedUsage: UnifiedMessage['usage'] = {
    inputTokens,
    outputTokens: current.outputTokens + incoming.outputTokens,
    billableInputTokens: sumOptionalUsageValue(
      current.billableInputTokens,
      incoming.billableInputTokens
    ),
    cacheCreationTokens: sumOptionalUsageValue(
      current.cacheCreationTokens,
      incoming.cacheCreationTokens
    ),
    cacheCreation5mTokens: sumOptionalUsageValue(
      current.cacheCreation5mTokens,
      incoming.cacheCreation5mTokens
    ),
    cacheCreation1hTokens: sumOptionalUsageValue(
      current.cacheCreation1hTokens,
      incoming.cacheCreation1hTokens
    ),
    cacheReadTokens,
    reasoningTokens: sumOptionalUsageValue(current.reasoningTokens, incoming.reasoningTokens),
    contextTokens: incoming.contextTokens ?? current.contextTokens,
    totalDurationMs: sumOptionalUsageValue(current.totalDurationMs, incoming.totalDurationMs),
    requestTimings: [...(current.requestTimings ?? []), ...(incoming.requestTimings ?? [])]
  }
  const cacheReadRatio = calculateCacheReadRatio(mergedUsage)
  return {
    ...mergedUsage,
    ...(cacheReadRatio !== undefined ? { cacheReadRatio } : {})
  }
}

function bumpMessageRevision(message: UnifiedMessage): void {
  message._revision = (message._revision ?? 0) + 1
}

export function finalizeAssistantMessage(
  sa: SubAgentState,
  usage?: UnifiedMessage['usage'],
  providerResponseId?: string,
  clearCurrentMessage = true,
  requestModel?: MessageRequestModelMeta
): void {
  if (!sa.currentAssistantMessageId) return
  const message = sa.transcript.find((item) => item.id === sa.currentAssistantMessageId)
  if (!message || message.role !== 'assistant') {
    sa.currentAssistantMessageId = null
    return
  }
  if (usage) {
    message.usage = mergeMessageUsage(message.usage, usage)
  }
  if (providerResponseId) {
    message.providerResponseId = providerResponseId
  }
  if (requestModel) {
    message.meta = {
      ...(message.meta ?? {}),
      requestModel
    }
  }
  let changed = Boolean(usage || providerResponseId || requestModel)
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'thinking' && !block.completedAt) {
        block.completedAt = Date.now()
        changed = true
      }
    }
  }
  if (changed) {
    bumpMessageRevision(message)
  }
  if (clearCurrentMessage) {
    sa.currentAssistantMessageId = null
  }
}

export function trimCompletedSubAgentsMap(map: Record<string, SubAgentState>): void {
  const keys = Object.keys(map)
  if (keys.length <= MAX_COMPLETED_SUBAGENTS) return
  const removeCount = keys.length - MAX_COMPLETED_SUBAGENTS
  for (let i = 0; i < removeCount; i++) {
    delete map[keys[i]]
  }
}

export function trimSubAgentHistory(history: SubAgentState[]): void {
  void history
}

function compactSubAgentTranscriptForHistory(transcript: UnifiedMessage[]): UnifiedMessage[] {
  return transcript
}

export function compactSubAgentForHistory(sa: SubAgentState): SubAgentState {
  return {
    ...sa,
    streamingText: sa.isRunning ? sa.streamingText : '',
    currentAssistantMessageId: sa.isRunning ? sa.currentAssistantMessageId : null,
    transcript: compactSubAgentTranscriptForHistory(sa.transcript)
  }
}

export function cloneSubAgentStateSnapshot(sa: SubAgentState): SubAgentState {
  const compacted = compactSubAgentForHistory(sa)
  try {
    return JSON.parse(JSON.stringify(compacted)) as SubAgentState
  } catch {
    return {
      ...compacted,
      toolCalls: compacted.toolCalls.map((toolCall) => ({ ...toolCall })),
      transcript: compacted.transcript.map((message) => ({
        ...message,
        content: Array.isArray(message.content)
          ? JSON.parse(JSON.stringify(message.content))
          : message.content
      }))
    }
  }
}

export function upsertSubAgentHistory(history: SubAgentState[], sa: SubAgentState): void {
  const snapshot = cloneSubAgentStateSnapshot(sa)
  const existingIndex = history.findIndex((item) => item.toolUseId === snapshot.toolUseId)
  if (existingIndex !== -1) {
    const existing = history[existingIndex]
    if (
      existing.name === snapshot.name &&
      existing.displayName === snapshot.displayName &&
      existing.toolUseId === snapshot.toolUseId &&
      existing.sessionId === snapshot.sessionId &&
      existing.description === snapshot.description &&
      existing.prompt === snapshot.prompt &&
      existing.isRunning === snapshot.isRunning &&
      existing.success === snapshot.success &&
      existing.endReason === snapshot.endReason &&
      existing.errorMessage === snapshot.errorMessage &&
      existing.iteration === snapshot.iteration &&
      existing.streamingText === snapshot.streamingText &&
      existing.currentAssistantMessageId === snapshot.currentAssistantMessageId &&
      existing.report === snapshot.report &&
      existing.reportStatus === snapshot.reportStatus &&
      existing.startedAt === snapshot.startedAt &&
      existing.completedAt === snapshot.completedAt &&
      JSON.stringify(existing.usage) === JSON.stringify(snapshot.usage) &&
      JSON.stringify(existing.requestModel) === JSON.stringify(snapshot.requestModel) &&
      JSON.stringify(existing.mcpServerIds) === JSON.stringify(snapshot.mcpServerIds) &&
      existing.permissionMode === snapshot.permissionMode &&
      JSON.stringify(existing.transcript) === JSON.stringify(snapshot.transcript) &&
      JSON.stringify(existing.toolCalls) === JSON.stringify(snapshot.toolCalls)
    ) {
      return
    }
    history[existingIndex] = snapshot
  } else {
    history.push(snapshot)
  }
  trimSubAgentHistory(history)
}

function getCurrentAssistantBlocks(sa: SubAgentState): ContentBlock[] | null {
  if (!sa.currentAssistantMessageId) return null
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
  if (!assistant) return null
  if (!Array.isArray(assistant.content)) {
    assistant.content = []
    bumpMessageRevision(assistant)
  }
  return assistant.content
}

export function appendThinkingToSubAgent(sa: SubAgentState, thinking: string): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks) return
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
  const last = blocks[blocks.length - 1]
  if (last?.type === 'thinking') {
    last.thinking += thinking
    if (assistant) bumpMessageRevision(assistant)
    return
  }
  blocks.push({ type: 'thinking', thinking })
  if (assistant) bumpMessageRevision(assistant)
}

export function appendThinkingEncryptedToSubAgent(
  sa: SubAgentState,
  encryptedContent: string,
  provider: 'anthropic' | 'openai-responses' | 'google'
): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks || !encryptedContent) return
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)

  let target: Extract<ContentBlock, { type: 'thinking' }> | null = null
  let providerMatchedTarget: Extract<ContentBlock, { type: 'thinking' }> | null = null
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type !== 'thinking') continue
    if (!block.encryptedContent) {
      target = block
      break
    }
    if (!providerMatchedTarget && block.encryptedContentProvider === provider) {
      providerMatchedTarget = block
    }
  }

  target = target ?? providerMatchedTarget
  if (target) {
    target.encryptedContent = encryptedContent
    target.encryptedContentProvider = provider
    if (assistant) bumpMessageRevision(assistant)
    return
  }

  blocks.push({
    type: 'thinking',
    thinking: '',
    encryptedContent,
    encryptedContentProvider: provider
  })
  if (assistant) bumpMessageRevision(assistant)
}

export function appendTextToSubAgent(sa: SubAgentState, text: string): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks) return
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
  const last = blocks[blocks.length - 1]
  if (last?.type === 'text') {
    last.text += text
    if (assistant) bumpMessageRevision(assistant)
    return
  }
  blocks.push({ type: 'text', text })
  if (assistant) bumpMessageRevision(assistant)
}

export function appendBlockToSubAgent(sa: SubAgentState, block: ContentBlock): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks) return
  blocks.push(block)
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
  if (assistant) bumpMessageRevision(assistant)
}

export function upsertToolUseBlockInSubAgent(
  sa: SubAgentState,
  block: Extract<ContentBlock, { type: 'tool_use' }>
): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks) return
  const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
  const existing = blocks.findIndex((item) => item.type === 'tool_use' && item.id === block.id)
  if (existing !== -1) {
    blocks[existing] = block
    if (assistant) bumpMessageRevision(assistant)
    return
  }
  blocks.push(block)
  if (assistant) bumpMessageRevision(assistant)
}

export function updateToolUseInputInSubAgent(
  sa: SubAgentState,
  toolCallId: string,
  partialInput: Record<string, unknown>
): void {
  const blocks = getCurrentAssistantBlocks(sa)
  if (!blocks) return
  const toolUseBlock = blocks.find(
    (item): item is Extract<ContentBlock, { type: 'tool_use' }> =>
      item.type === 'tool_use' && item.id === toolCallId
  )
  if (toolUseBlock) {
    toolUseBlock.input = partialInput
    const assistant = sa.transcript.find((message) => message.id === sa.currentAssistantMessageId)
    if (assistant) bumpMessageRevision(assistant)
  }
}

export function rebuildRunningSubAgentDerived(state: {
  activeSubAgents: Record<string, SubAgentState>
  sessionSubAgentSummaries: Record<string, SubAgentState[]>
  runningSubAgentNamesSig: string
  runningSubAgentSessionIdsSig: string
}): void {
  const runningNames: string[] = []
  const runningSessionIds = new Set<string>()

  for (const subAgent of Object.values(state.activeSubAgents)) {
    if (!subAgent.isRunning) continue
    runningNames.push(subAgent.name)
    if (subAgent.sessionId) runningSessionIds.add(subAgent.sessionId)
  }

  for (const [sessionId, summaries] of Object.entries(state.sessionSubAgentSummaries)) {
    if (summaries.some((subAgent) => subAgent.isRunning)) {
      runningSessionIds.add(sessionId)
    }
  }

  state.runningSubAgentNamesSig = runningNames.join('\u0000')
  state.runningSubAgentSessionIdsSig = Array.from(runningSessionIds).sort().join('\u0000')
}

export function buildSubAgentSummary(agent: SubAgentState): SubAgentState {
  return cloneSubAgentStateSnapshot(agent)
}

export function upsertSessionSubAgentSummary(
  state: { sessionSubAgentSummaries: Record<string, SubAgentState[]> },
  agent: SubAgentState,
  fallbackSessionId?: string
): void {
  const sessionId = agent.sessionId ?? fallbackSessionId
  if (!sessionId) return
  const previous = state.sessionSubAgentSummaries[sessionId] ?? []
  state.sessionSubAgentSummaries[sessionId] = [
    buildSubAgentSummary(agent),
    ...previous.filter((item) => item.toolUseId !== agent.toolUseId)
  ]
}

export function buildPersistedSubAgentSnapshot(agent: SubAgentState): SubAgentState {
  const snapshot = buildSubAgentSummary(agent)
  // S-178: a queued card is live state, not history. Once the snapshot is restored its run
  // no longer exists, so it must never come back as a permanently "Queued" ghost card —
  // a snapshot is by definition not alive.
  if (snapshot.isQueued) {
    return {
      ...snapshot,
      isQueued: false,
      completedAt: snapshot.completedAt ?? snapshot.startedAt,
      reportStatus: snapshot.report.trim() ? snapshot.reportStatus : 'missing'
    }
  }
  if (!snapshot.isRunning) return snapshot

  return {
    ...snapshot,
    isRunning: false,
    currentAssistantMessageId: null,
    completedAt: snapshot.completedAt ?? snapshot.startedAt,
    reportStatus: snapshot.report.trim() ? snapshot.reportStatus : 'missing'
  }
}

export function compactSubAgentListForPersistence(items: SubAgentState[]): SubAgentState[] {
  return items.map(buildPersistedSubAgentSnapshot)
}

export function compactSessionSubAgentSummariesForPersistence(
  summariesBySession: Record<string, SubAgentState[]>
): Record<string, SubAgentState[]> {
  return Object.fromEntries(
    Object.entries(summariesBySession).map(([sessionId, summaries]) => [
      sessionId,
      compactSubAgentListForPersistence(summaries)
    ])
  )
}

export function cloneSubAgentMap(source: Record<string, SubAgentState>): Record<string, SubAgentState> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, cloneSubAgentStateSnapshot(value)])
  )
}

export function ensureSessionSubAgentLiveState(
  state: { sessionSubAgentLiveCache: Record<string, SessionSubAgentLiveState> },
  sessionId: string
): SessionSubAgentLiveState {
  const existing = state.sessionSubAgentLiveCache[sessionId]
  if (existing) return existing
  const created: SessionSubAgentLiveState = { active: {}, completed: {} }
  state.sessionSubAgentLiveCache[sessionId] = created
  return created
}

export function syncSessionSubAgentState(
  state: { sessionSubAgentLiveCache: Record<string, SessionSubAgentLiveState> },
  sessionId: string | undefined,
  id: string,
  subAgent: SubAgentState
): void {
  if (!sessionId) return
  const liveState = ensureSessionSubAgentLiveState(state, sessionId)
  if (subAgent.isRunning) {
    liveState.active[id] = subAgent
    delete liveState.completed[id]
    return
  }

  delete liveState.active[id]
  liveState.completed[id] = subAgent
  trimCompletedSubAgentsMap(liveState.completed)
}

export function findSubAgentState(
  state: {
    activeSubAgents: Record<string, SubAgentState>
    completedSubAgents: Record<string, SubAgentState>
    sessionSubAgentLiveCache: Record<string, SessionSubAgentLiveState>
  },
  id: string,
  sessionId?: string
): SubAgentState | null {
  const direct = state.activeSubAgents[id] ?? state.completedSubAgents[id]
  if (direct && (!sessionId || direct.sessionId === sessionId)) {
    syncSessionSubAgentState(state, sessionId, id, direct)
    return direct
  }

  if (!sessionId) return null
  const liveState = ensureSessionSubAgentLiveState(state, sessionId)
  return liveState.active[id] ?? liveState.completed[id] ?? null
}
