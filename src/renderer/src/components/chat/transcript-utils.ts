import type {
  ContentBlock,
  ToolResultContent,
  ToolUseBlock,
  UnifiedMessage
} from '@renderer/lib/api/types'
import { resolveActiveCompactArtifacts } from '@renderer/lib/agent/context-compression'

export interface RenderableMessageMeta {
  messageId: string
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
}

export interface ChatRenderableMessageMeta extends RenderableMessageMeta {
  showContinue: boolean
}

export interface TailToolExecutionState {
  assistantIndex: number
  assistantMessageId: string
  toolUseBlocks: ToolUseBlock[]
  toolResultMap: Map<string, { content: ToolResultContent; isError?: boolean }>
  trailingToolResultMessageCount: number
}

const messageLookupCache = new WeakMap<UnifiedMessage[], Map<string, UnifiedMessage>>()
const transcriptStaticAnalysisCache = new WeakMap<UnifiedMessage[], TranscriptStaticAnalysis>()
export const HIDDEN_MESSAGE_LIST_TOOL_NAMES = new Set(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'])

// --- Signature-based fast cache for transcriptStaticAnalysis ---
// The WeakMap above is keyed by array reference, which misses on every Immer state update.
// This signature keeps the fast path, but also invalidates when message contents are revised.
let _lastStructuralSignature = ''
let _lastAnalysisResult: TranscriptStaticAnalysis | null = null

function buildStructuralSignature(messages: UnifiedMessage[]): string {
  const len = messages.length
  if (len === 0) return '0'
  return messages.map((message) => `${message.id}:${message._revision ?? 0}`).join('|')
}

type ToolResultsInnerMap = Map<string, { content: ToolResultContent; isError?: boolean }>

interface AssistantToolResultsCacheEntry {
  contributors: UnifiedMessage[]
  innerMap: ToolResultsInnerMap
}

const assistantToolResultsCache = new WeakMap<UnifiedMessage, AssistantToolResultsCacheEntry>()
const orchestrationBindingEntryCache = new WeakMap<UnifiedMessage, string>()

function contributorsEqual(a: UnifiedMessage[], b: UnifiedMessage[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function getStableAssistantToolResults(
  assistantMessage: UnifiedMessage,
  contributors: UnifiedMessage[]
): ToolResultsInnerMap {
  const cached = assistantToolResultsCache.get(assistantMessage)
  if (cached && contributorsEqual(cached.contributors, contributors)) {
    return cached.innerMap
  }
  const innerMap: ToolResultsInnerMap = new Map()
  // Collect inline tool_result blocks from the assistant message itself
  // (wishful-claw stores tool results inline, not as separate user messages)
  if (Array.isArray(assistantMessage.content)) {
    collectToolResults(assistantMessage.content as ContentBlock[], innerMap)
  }
  // Also collect from contributor messages (WishfulClaw-style separate user messages)
  for (const contributor of contributors) {
    collectToolResults(contributor.content as ContentBlock[], innerMap)
  }
  assistantToolResultsCache.set(assistantMessage, {
    contributors: contributors.slice(),
    innerMap
  })
  return innerMap
}

export interface TranscriptStaticAnalysis {
  messageLookup: Map<string, UnifiedMessage>
  toolResultsLookup: Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>>
  renderableMessageIds: string[]
  lastRealUserMessageId: string | null
  lastAssistantMessageId: string | null
  tailToolExecutionState: TailToolExecutionState | null
  orchestrationBindingSignature: string
}


import { isToolResultOnlyUserMessage, isRealUserMessage, shouldRenderInMessageList, isTransparentSystemMessage, collectToolResults, buildOrchestrationMessageBindingEntry, buildTailToolExecutionState } from './transcript-filters'

export function buildTranscriptStaticAnalysis(
  messages: UnifiedMessage[]
): TranscriptStaticAnalysis {
  const cached = transcriptStaticAnalysisCache.get(messages)
  if (cached) {
    _lastStructuralSignature = buildStructuralSignature(messages)
    _lastAnalysisResult = cached
    return cached
  }

  // Fast path: when the message list structure hasn't changed (no add/remove),
  // reuse the expensive structural parts and only rebuild messageLookup + binding hash.
  const structSig = buildStructuralSignature(messages)
  if (structSig === _lastStructuralSignature && _lastAnalysisResult) {
    const prev = _lastAnalysisResult

    const messageLookup = new Map<string, UnifiedMessage>()
    let bindingHash = 0x811c9dc5
    for (const message of messages) {
      messageLookup.set(message.id, message)

      let entry = orchestrationBindingEntryCache.get(message)
      if (entry === undefined) {
        entry = buildOrchestrationMessageBindingEntry(message)
        orchestrationBindingEntryCache.set(message, entry)
      }
      for (let i = 0; i < entry.length; i += 1) {
        bindingHash ^= entry.charCodeAt(i)
        bindingHash =
          (bindingHash +
            ((bindingHash << 1) +
              (bindingHash << 4) +
              (bindingHash << 7) +
              (bindingHash << 8) +
              (bindingHash << 24))) >>>
          0
      }
      bindingHash ^= 0x7c
      bindingHash =
        (bindingHash +
          ((bindingHash << 1) +
            (bindingHash << 4) +
            (bindingHash << 7) +
            (bindingHash << 8) +
            (bindingHash << 24))) >>>
        0
    }

    const bindingSig = bindingHash.toString(36)

    const fastResult: TranscriptStaticAnalysis = {
      messageLookup,
      toolResultsLookup: prev.toolResultsLookup,
      renderableMessageIds: prev.renderableMessageIds,
      lastRealUserMessageId: prev.lastRealUserMessageId,
      lastAssistantMessageId: prev.lastAssistantMessageId,
      tailToolExecutionState: prev.tailToolExecutionState,
      orchestrationBindingSignature: bindingSig
    }
    transcriptStaticAnalysisCache.set(messages, fastResult)
    _lastAnalysisResult = fastResult
    return fastResult
  }

  // Full rebuild — message list structure changed.
  const messageLookup = new Map<string, UnifiedMessage>()
  const toolResultsLookup = new Map<string, ToolResultsInnerMap>()
  const renderableMessageIds: string[] = []
  const assistantContributors = new Map<
    string,
    { assistant: UnifiedMessage; contributors: UnifiedMessage[] }
  >()
  const activeCompact = resolveActiveCompactArtifacts(messages)
  const activeCompactSummaryId = activeCompact?.summaryId ?? null
  const compressionStatusSummaryIds = new Set(
    messages
      .map((message) => message.meta?.compressionStatus?.summaryMessageId)
      .filter((id): id is string => Boolean(id))
  )
  let currentAssistantMessageId: string | null = null
  let lastRealUserMessageId: string | null = null
  let lastAssistantMessageId: string | null = null
  let bindingHash = 0x811c9dc5

  for (const message of messages) {
    messageLookup.set(message.id, message)

    let entry = orchestrationBindingEntryCache.get(message)
    if (entry === undefined) {
      entry = buildOrchestrationMessageBindingEntry(message)
      orchestrationBindingEntryCache.set(message, entry)
    }
    for (let i = 0; i < entry.length; i += 1) {
      bindingHash ^= entry.charCodeAt(i)
      bindingHash =
        (bindingHash +
          ((bindingHash << 1) +
            (bindingHash << 4) +
            (bindingHash << 7) +
            (bindingHash << 8) +
            (bindingHash << 24))) >>>
        0
    }
    bindingHash ^= 0x7c
    bindingHash =
      (bindingHash +
        ((bindingHash << 1) +
          (bindingHash << 4) +
          (bindingHash << 7) +
          (bindingHash << 8) +
          (bindingHash << 24))) >>>
      0

    if (message.role === 'assistant') {
      currentAssistantMessageId = message.id
      assistantContributors.set(message.id, { assistant: message, contributors: [] })
    } else if (isToolResultOnlyUserMessage(message) && currentAssistantMessageId) {
      const bucket = assistantContributors.get(currentAssistantMessageId)
      if (bucket) bucket.contributors.push(message)
    } else if (isTransparentSystemMessage(message)) {
      // Hidden system reminders are metadata injected into the transcript. They should
      // not sever the assistant tool_use -> user tool_result association used by cards.
    } else {
      currentAssistantMessageId = null
    }

    if (!shouldRenderInMessageList(message, activeCompactSummaryId, compressionStatusSummaryIds)) continue

    renderableMessageIds.push(message.id)
    if (isRealUserMessage(message)) {
      lastRealUserMessageId = message.id
    }
    if (message.role === 'assistant') {
      lastAssistantMessageId = message.id
    }
  }

  for (const [assistantId, { assistant, contributors }] of assistantContributors) {
    const results = getStableAssistantToolResults(assistant, contributors)
    if (results.size > 0) {
      toolResultsLookup.set(assistantId, results)
    }
  }

  const nextAnalysis: TranscriptStaticAnalysis = {
    messageLookup,
    toolResultsLookup,
    renderableMessageIds,
    lastRealUserMessageId,
    lastAssistantMessageId,
    tailToolExecutionState: buildTailToolExecutionState(messages),
    orchestrationBindingSignature: bindingHash.toString(36)
  }

  transcriptStaticAnalysisCache.set(messages, nextAnalysis)
  _lastStructuralSignature = structSig
  _lastAnalysisResult = nextAnalysis
  return nextAnalysis
}

export function buildRenderableMessageMetaFromAnalysis(
  analysis: TranscriptStaticAnalysis,
  streamingMessageId: string | null
): RenderableMessageMeta[] {
  const lastRealUserMessageId = streamingMessageId ? null : analysis.lastRealUserMessageId
  const renderableMessageIds = [...analysis.renderableMessageIds]
  if (
    streamingMessageId &&
    !renderableMessageIds.includes(streamingMessageId) &&
    analysis.messageLookup.get(streamingMessageId)?.role === 'assistant'
  ) {
    renderableMessageIds.push(streamingMessageId)
  }

  return renderableMessageIds.map((messageId) => ({
    messageId,
    isLastUserMessage: messageId === lastRealUserMessageId,
    isLastAssistantMessage:
      messageId === analysis.lastAssistantMessageId || messageId === streamingMessageId
  }))
}

export function buildChatRenderableMessageMetaFromAnalysis(
  analysis: TranscriptStaticAnalysis,
  streamingMessageId: string | null,
  continueAssistantMessageId: string | null
): ChatRenderableMessageMeta[] {
  return buildRenderableMessageMetaFromAnalysis(analysis, streamingMessageId).map((message) => ({
    ...message,
    showContinue: message.messageId === continueAssistantMessageId
  }))
}

export function getToolResultsLookup(
  messages: UnifiedMessage[]
): Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>> {
  const next = new Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>>()
  let currentAssistantMessageId: string | null = null

  for (const message of messages) {
    if (message.role === 'assistant') {
      currentAssistantMessageId = message.id
      continue
    }

    if (isToolResultOnlyUserMessage(message) && currentAssistantMessageId) {
      let results = next.get(currentAssistantMessageId)
      if (!results) {
        results = new Map()
        next.set(currentAssistantMessageId, results)
      }
      collectToolResults(message.content as ContentBlock[], results)
      continue
    }

    if (isTransparentSystemMessage(message)) {
      continue
    }

    currentAssistantMessageId = null
  }

  return next
}

export function getMessageLookup(messages: UnifiedMessage[]): Map<string, UnifiedMessage> {
  const cached = messageLookupCache.get(messages)
  if (cached) return cached

  const next = new Map<string, UnifiedMessage>()
  for (const message of messages) {
    next.set(message.id, message)
  }

  messageLookupCache.set(messages, next)
  return next
}

export function getTailToolExecutionState(
  messages: UnifiedMessage[]
): TailToolExecutionState | null {
  return buildTailToolExecutionState(messages)
}

export function buildRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null
): RenderableMessageMeta[] {
  return buildRenderableMessageMetaFromAnalysis(
    buildTranscriptStaticAnalysis(messages),
    streamingMessageId
  )
}

export function buildChatRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null,
  continueAssistantMessageId: string | null
): ChatRenderableMessageMeta[] {
  return buildChatRenderableMessageMetaFromAnalysis(
    buildTranscriptStaticAnalysis(messages),
    streamingMessageId,
    continueAssistantMessageId
  )
}
