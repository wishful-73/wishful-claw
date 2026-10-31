// 500 行豁免（2026-10-28，行数以实际为准）：同质纯函数与类型声明集合（行构建、距离与阈值判定），无状态无副作用，属「同质数据」一类，拆开只剩碎片 import。
// 豁免依据：AGENTS.md 大文件拆分 第 5 条第 1 类（单一数据对象）。

// Pure utility functions and types extracted from MessageList.tsx

import type { ContentBlock, ToolResultContent, UnifiedMessage } from '@renderer/lib/api/types'
import type { RenderableChatItem } from '../renderable-chat-items'
import type { ActiveTeam } from '@renderer/stores/team-store'
import type { useChatStore } from '@renderer/stores/chat-store'
import type { useTeamStore } from '@renderer/stores/team-store'
import type { RequestRetryState } from '@renderer/lib/agent/types'
import type { EditableUserMessageDraft } from '@renderer/lib/image-attachments'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { buildChatMessageContent } from '@renderer/lib/agent/chat-message-blocks'


export interface MessageListProps {
  sessionId?: string | null
  onEditUserMessage?: (messageId: string, draft: EditableUserMessageDraft) => void
  exportAll?: boolean
  fullWidth?: boolean
}

export type RenderableMessage = RenderableChatItem

export type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

export type MessageListRow = { type: 'message'; key: string; data: RenderableChatItem }

export type AutoScrollMode = 'off' | 'user' | 'stream'

export interface AskUserQuestionPresence {
  assistantMessageId: string
  toolUseId: string
}

export function getMessageToolUseIds(message: UnifiedMessage): string[] {
  if (!Array.isArray(message.content)) return []
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => {
      return block.type === 'tool_use'
    })
    .map((block) => block.id)
    .filter(Boolean)
}

export function toolResultContentToText(content: ToolResultContent | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

export function getPlanReviewPlanId(content: ToolResultContent | undefined): string | null {
  const text = toolResultContentToText(content)
  if (!text.trim()) return null
  const parsed = decodeStructuredToolResult(text)
  if (!parsed || Array.isArray(parsed)) return null
  const planId = typeof parsed.plan_id === 'string' ? parsed.plan_id.trim() : ''
  return planId || null
}

export function collectDuplicatePlanReviewToolUseIds(
  messages: UnifiedMessage[],
  toolResultsLookup: Map<string, ToolResultsLookup>
): Set<string> {
  const latestByPlanId = new Map<string, { toolUseId: string; order: number }>()
  const occurrences: Array<{ planId: string; toolUseId: string; order: number }> = []
  let order = 0

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      order += 1
      continue
    }

    const toolResults = toolResultsLookup.get(message.id)
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue
      if (block.name !== 'SubmitPlanReview') continue

      const planId = getPlanReviewPlanId(toolResults?.get(block.id)?.content)
      if (!planId) {
        order += 1
        continue
      }

      const occurrence = { planId, toolUseId: block.id, order }
      occurrences.push(occurrence)
      const previous = latestByPlanId.get(planId)
      if (!previous || occurrence.order > previous.order) {
        latestByPlanId.set(planId, occurrence)
      }
      order += 1
    }
  }

  const hidden = new Set<string>()
  for (const occurrence of occurrences) {
    const latest = latestByPlanId.get(occurrence.planId)
    if (latest && latest.toolUseId !== occurrence.toolUseId) {
      hidden.add(occurrence.toolUseId)
    }
  }
  return hidden
}

export function mergeHiddenToolUseIds(first?: Set<string>, second?: Set<string>): Set<string> | undefined {
  if (!first || first.size === 0) return second && second.size > 0 ? second : undefined
  if (!second || second.size === 0) return first
  return new Set([...first, ...second])
}

export function hasEmptyAssistantContent(message: UnifiedMessage): boolean {
  if (message.role !== 'assistant') return false
  if (typeof message.content === 'string') return message.content.length === 0
  return Array.isArray(message.content) && message.content.length === 0
}

export interface MessageLocatorIndexRow {
  id: string
  session_id: string
  role: string
  content: string
  meta: string | null
  created_at: number
  sort_order: number
}

export interface MessageLocatorSource {
  id: string
  role: UnifiedMessage['role']
  content: UnifiedMessage['content']
  meta?: UnifiedMessage['meta']
  createdAt: number
  sortOrder: number
  source?: UnifiedMessage['source']
}

export type AssistantRailMarkerKind = 'assistant' | 'streaming' | 'summary' | 'user'

export interface AssistantRailLayoutRow extends MessageLocatorSource {
  estimatedTop: number
  estimatedHeight: number
  markerKind: AssistantRailMarkerKind | null
}

export interface AssistantReplyRailItem {
  id: string
  index: number
  preview: string
  time: string
  position: number
  sortOrder: number
  createdAt: number
  estimatedTop: number
  estimatedHeight: number
  kind: AssistantRailMarkerKind
}

export interface AssistantRailLayout {
  rows: AssistantRailLayoutRow[]
  items: AssistantReplyRailItem[]
  totalEstimatedHeight: number
}

export type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
export type TeamStoreSnapshot = ReturnType<typeof useTeamStore.getState>

export interface MessageRowProps {
  item: RenderableChatItem
  sessionId?: string | null
  sessionAssistantMessageIds?: readonly string[]
  sessionToolUseIds?: readonly string[]
  isStreaming: boolean
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  disableAnimation: boolean
  toolResults?: ToolResultsLookup
  orchestrationRun?: import('@renderer/lib/orchestration/types').OrchestrationRun | null
  hiddenToolUseIds?: Set<string>
  anchorMessageId?: string | null
  highlightMessageId?: string | null
  requestRetryState?: RequestRetryState | null
  renderMode?: 'default' | 'transcript' | 'static'
  showChangeSummary?: boolean
  fullWidth?: boolean
  onEditUserMessage?: (messageId: string, draft: EditableUserMessageDraft) => void
}

export const EMPTY_MESSAGES: UnifiedMessage[] = []
export const EMPTY_MESSAGES_RAW: readonly unknown[] = []
export const EMPTY_TEAM_HISTORY: ActiveTeam[] = []
export const AUTO_SCROLL_BOTTOM_THRESHOLD = 24
export const STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD = 80
export const STREAMING_AUTO_SCROLL_STOP_THRESHOLD = 240
export const TAIL_STATIC_MESSAGE_COUNT = 4
export const TAIL_LIVE_MESSAGE_COUNT = 6
export const FOLLOW_BOTTOM_SETTLE_FRAMES = 3
export const BOTTOM_SCROLL_CORRECTION_EPSILON = 2
export const AUTO_SCROLL_MIN_DELTA = 24
export const PROGRAMMATIC_SCROLL_GUARD_MS = 160
export const STREAMING_AUTO_SCROLL_POLL_MS = 500
/**
 * iter-30 S-31/S-32 余量基准：视口底边停在内容底下方多远（px），**同时就是可见留白的上限**。
 *
 * 管的是**可见留白**。S-176 起两端都在 `scrollToBottomImmediate` 里做：
 * 余量小于 `STREAMING_BOTTOM_FOLLOW_REFILL_AT` 就补到本值，大于 `gapTarget + ε` 就回收到本值
 * （`shouldReclaim`，`gapTarget = resolveGapTarget(CHUNK, 视口高, WATERMARK_CONFIG.maxGap)`）。
 * 补方向只移 `scrollTop`；**回收方向先对齐 `scrollTop`、再压水位线** —— 落位之后
 * `maxScrollTop == scrollTop`，浏览器没有可 clamp 的余量，压水位线不产生回跳。
 * 「绝不压 min-height」是 iter-30 的结论，那条结论的前提是**不对齐就压**，现已被 S-176 取代。
 *
 * 语义改过三轮，前两轮都错，记在这儿免得再走回去：
 * - 旧值 `STREAMING_BOTTOM_FOLLOW_GAP = 80`：目标写成「当前内容底 + GAP」，每帧跟着内容走
 *   ⇒ 滚动条每帧推 1px，余量恒等于 GAP、**从未被真正消耗过**，等于没有缓冲。
 * - 「阶梯式」：补满一整块后不再动，等余量见底再补。解决了每帧推，但**只补不收** ——
 *   视口会漂进收缩后的留白深处（老大报的「正常消息被顶上去、聊天窗只有空白」）。
 * - 「超半屏就收 min-height」+ 节流：**跳得更凶**。收 min-height 本身就是制造
 *   `scrollHeight` 骤减 ⇒ 必然 clamp ⇒ 必然跳；节流只是把攒下的位移合并成一次更大的跳。
 *   （S-176 把它救回来的唯一改动是**顺序**：先对齐 scrollTop，再压水位线。）
 *
 * 取值权衡：太小撑不住工具卡片展开那类阶跃；太大就是 T-9 那次「全是留白」。
 * 实际生效值会被夹到半屏和 `WATERMARK_CONFIG.maxGap` 以内。
 */
export const STREAMING_BOTTOM_FOLLOW_CHUNK = 240

/** 余量低于这个值就补回基准（px）。留点提前量，别等内容底都越过视口底了才补。 */
export const STREAMING_BOTTOM_FOLLOW_REFILL_AT = 24
export const USER_LOCATOR_HIGHLIGHT_MS = 1400
export const ASSISTANT_RAIL_PREVIEW_LIMIT = 120
export const ASSISTANT_RAIL_SCROLL_OFFSET = 28
export const ASSISTANT_RAIL_DENSE_THRESHOLD = 80
export const MIN_RENDERABLE_HISTORY_ROWS = 3
export const VIRTUAL_ROW_ESTIMATED_HEIGHT = 180
export const VIRTUAL_ROW_OVERSCAN = 8
export const INITIAL_TAIL_RENDER_COUNT = 32
export const EMPTY_ORCHESTRATION_STATE = { runs: [], byId: new Map(), byMessageId: new Map() }
export const MESSAGE_COLUMN_CLASS = 'mx-auto w-full max-w-[820px] px-5'
export const MESSAGE_COLUMN_COMPACT_CLASS = 'mx-auto w-full max-w-[720px] px-5'
export const MESSAGE_COLUMN_FULL_WIDTH_CLASS = 'mx-auto w-full max-w-none px-5'
export const EMPTY_MESSAGE_LOCATOR_ROWS: MessageLocatorIndexRow[] = []
export const EMPTY_ASSISTANT_RAIL_LAYOUT: AssistantRailLayout = {
  rows: [],
  items: [],
  totalEstimatedHeight: 0
}

export function getMessageColumnClass(fullWidth: boolean): string {
  return fullWidth ? MESSAGE_COLUMN_FULL_WIDTH_CLASS : MESSAGE_COLUMN_CLASS
}

export function getMessageColumnCompactClass(fullWidth: boolean): string {
  return fullWidth ? MESSAGE_COLUMN_FULL_WIDTH_CLASS : MESSAGE_COLUMN_COMPACT_CLASS
}

export interface MessageListSessionSelection {
  messages: UnifiedMessage[]
  messagesLoaded: boolean
  messageCount: number
  workingFolder?: string
  loadedRangeStart: number
  totalTurns: number
  projectId?: string
}

export interface SessionScopedTeamSelection {
  activeTeam: ActiveTeam | null
  teamHistory: ActiveTeam[]
  isTeamRunning: boolean
  hasOrchestrationData: boolean
  signature: string
}

export const EMPTY_MESSAGE_LIST_SESSION_SELECTION: MessageListSessionSelection = {
  messages: EMPTY_MESSAGES,
  messagesLoaded: false,
  messageCount: 0,
  loadedRangeStart: 0,
  totalTurns: 0,
  projectId: undefined,
  workingFolder: undefined
}

export const EMPTY_SESSION_TEAM_SELECTION: SessionScopedTeamSelection = {
  activeTeam: null,
  teamHistory: EMPTY_TEAM_HISTORY,
  isTeamRunning: false,
  hasOrchestrationData: false,
  signature: 'empty'
}

export const sessionScopedTeamSelectionCache = new Map<string, SessionScopedTeamSelection>()

export function areToolResultsEqual(a?: ToolResultsLookup, b?: ToolResultsLookup): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false

  for (const [id, value] of a) {
    const other = b.get(id)
    if (!other) return false
    if (other.isError !== value.isError) return false
    if (other.content !== value.content) return false
  }

  return true
}

export function areStringSetsEqual(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false

  for (const value of a) {
    if (!b.has(value)) return false
  }

  return true
}

export function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }

  return true
}

export function areRequestRetryStatesEqual(
  a?: RequestRetryState | null,
  b?: RequestRetryState | null
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b

  return (
    a.attempt === b.attempt &&
    a.maxAttempts === b.maxAttempts &&
    a.delayMs === b.delayMs &&
    a.statusCode === b.statusCode &&
    a.reason === b.reason
  )
}

export function buildTeamMemberRenderSignature(team: ActiveTeam): string {
  return team.members
    .map((member) =>
      [
        member.id,
        member.name,
        member.agentName ?? '',
        member.role ?? '',
        member.status,
        String(member.iteration),
        String(member.currentTaskId ?? ''),
        String(member.startedAt),
        String(member.completedAt ?? ''),
        member.streamingText ?? '',
        String(member.toolCalls?.length ?? 0)
      ].join(':')
    )
    .join('|')
}

export function buildTeamTaskRenderSignature(team: ActiveTeam): string {
  return team.tasks
    .map((task) =>
      [
        task.id,
        task.subject,
        task.status,
        task.owner ?? '',
        task.description ?? '',
        task.report ?? ''
      ].join(':')
    )
    .join('|')
}

export function buildTeamMessageRenderSignature(team: ActiveTeam): string {
  const lastMessage = team.messages[team.messages.length - 1]
  return [
    String(team.messages.length),
    lastMessage?.id ?? '',
    lastMessage?.summary ?? '',
    lastMessage?.timestamp ?? ''
  ].join(':')
}

export function buildTeamRenderSignature(team: ActiveTeam): string {
  return [
    team.name,
    team.description,
    team.sessionId ?? '',
    String(team.createdAt),
    String(team.lastRuntimeSyncAt ?? ''),
    buildTeamMemberRenderSignature(team),
    buildTeamTaskRenderSignature(team),
    buildTeamMessageRenderSignature(team)
  ].join('::')
}

export function isActiveTeamRunning(team: ActiveTeam): boolean {
  return (
    team.tasks.some((task) => task.status !== 'completed') ||
    team.members.some((member) => member.status === 'working' || member.status === 'waiting')
  )
}

// Cache: ChatMessage[] reference → content signature and conversion result.
// Store updates may mutate message objects in place, so the signature must be
// checked before reusing the stable converted array reference.
type ChatMessageConversionCacheEntry = {
  signature: string
  converted: UnifiedMessage[]
}

export const chatMessageConversionCache = new WeakMap<readonly unknown[], ChatMessageConversionCacheEntry>()

// S-247：单条 ChatMessage → 它转换出的 UnifiedMessage。key 用原始对象（WeakMap，
// 消息被移除时自动释放）。store 原地改字段不换引用，所以命中后还要比 signature。
const perMessageConversionCache = new WeakMap<object, { signature: string; converted: UnifiedMessage }>()

/**
 * S-247（2026-10-31）：流式期间**每个 token** 都会走到这里。原来的实现是
 * `JSON.stringify(messages)` —— 把整个消息数组序列化一遍，12 条消息每帧产出
 * 几十 KB 临时字符串，分配完立刻丢弃。实测 24 秒内 JS 堆从 142MB 涨到 858MB
 * （`renderer probe heap`），主要就是它。
 *
 * 改成逐条轻量签名：只取决定 `convertChatMessagesToUnified` 输出的那几个字段。
 * 流式是追加，`text.length` 必变；历史加载会换 `id`；工具结果改 `toolCalls`
 * 或 `error` 的长度；`updatedAt` 在轮次收尾时盖章。
 *
 * 已知盲区：**等长替换**（长度相同）会漏判。当前所有写入路径都不产生这种变更 ——
 * 真出现时加内容 hash，别退回 stringify。
 *
 * ⚠️ 不要为了缩小盲区在这里读文本内容（`charCodeAt` / `slice` / `includes`）。
 * `text` 是流式拼接出来的 ConsString，`length` 是 O(1)，但任何读字符的操作都会
 * 强制 V8 把整条 rope flatten 成连续字符串 —— 长回复下每帧复制上百 KB，
 * 实测 32 秒堆涨 425MB 就是这么来的（S-247 §17）。
 */
function getMessageSignature(msg: Record<string, unknown>): string {
  const text = (msg.text as string) ?? ''
  const thinking = msg.thinking as string | undefined
  const toolCalls = msg.toolCalls as unknown[] | undefined
  const error = typeof msg.error === 'string' ? msg.error : ''
  return `${msg.id as string}:${text.length}:${thinking?.length ?? 0}:${toolCalls?.length ?? 0}:${error.length}:${(msg.updatedAt as number) ?? 0}`
}

function getChatMessageConversionSignature(messages: readonly unknown[]): string {
  const parts: string[] = []
  for (const raw of messages) {
    parts.push(getMessageSignature(raw as Record<string, unknown>))
  }
  return parts.join('|')
}

export function convertChatMessagesToUnified(messages: readonly unknown[]): UnifiedMessage[] {
  const signature = getChatMessageConversionSignature(messages)
  const cached = chatMessageConversionCache.get(messages)
  if (cached?.signature === signature) return cached.converted

  const converted = messages.map((raw) => {
    const msg = raw as Record<string, unknown>
    // S-247：逐条复用。store 是原地改 `msg.text`，对象引用不变，所以必须靠
    // getMessageSignature 判断内容有没有变，变了才重跑 buildChatMessageContent。
    // 没有这层缓存时，12 条消息每帧全量重建 content blocks（含每个工具卡片
    // 的 block 对象），是堆里第二个大头。
    const sig = getMessageSignature(msg)
    const hit = perMessageConversionCache.get(msg as object)
    if (hit && hit.signature === sig) return hit.converted
    const result = convertOneMessage(msg)
    perMessageConversionCache.set(msg as object, { signature: sig, converted: result })
    return result
  })

  chatMessageConversionCache.set(messages, { signature, converted })
  return converted
}

function convertOneMessage(msg: Record<string, unknown>): UnifiedMessage {
  const role = msg.role as UnifiedMessage['role']
  const text = (msg.text as string) ?? ''
  const thinking = msg.thinking as string | undefined
  const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined
  const blocks = buildChatMessageContent(msg)

  const result: UnifiedMessage = {
    id: msg.id as string,
    role,
    content: blocks,
    createdAt: (msg.createdAt as number) ?? Date.now()
  }

  if (msg.usage) result.usage = msg.usage as UnifiedMessage['usage']
  if (msg.debugInfo) result.debugInfo = msg.debugInfo as UnifiedMessage['debugInfo']
  if (msg.meta) result.meta = msg.meta as UnifiedMessage['meta']
  if (msg.preToolPhase) result.preToolPhase = true
  if (msg.memoryRecall) result.memoryRecall = msg.memoryRecall as UnifiedMessage['memoryRecall']
  // updatedAt 是「这一轮跑完」的时刻（live 走 loop_end 回写，历史走 Worker 盖章的
  // updated_at）。这里不搬它，消费方就只能回落 createdAt，看到的是开始时间。
  if (typeof msg.updatedAt === 'number') result.updatedAt = msg.updatedAt
  // Use text length as revision so structural signature changes when
  // streaming text grows (buildStructuralSignature uses _revision).
  // This ensures renderableMessageIds is rebuilt when assistant text
  // goes from empty to non-empty. The recall outcome is included so the
  // memoized row re-renders the moment the recall banner data arrives.
  const recallFingerprint = msg.memoryRecall
    ? 1 + ((msg.memoryRecall as { hits?: string[] }).hits?.length ?? 0)
    : 0
  const errorText = typeof msg.error === 'string' ? msg.error : ''
  result._revision = (text.length) + (thinking?.length ?? 0) + (toolCalls?.length ?? 0) + recallFingerprint + errorText.length
  if (errorText) {
    const errorBlock: ContentBlock = {
      type: 'agent_error',
      code: 'runtime_error',
      message: errorText
    }
    if (Array.isArray(result.content)) {
      const existingErrorIndex = result.content.findIndex((block) => block.type === 'agent_error')
      if (existingErrorIndex >= 0) {
        result.content = result.content.map((block, index) =>
          index === existingErrorIndex ? errorBlock : block
        )
      } else {
        result.content = [...result.content, errorBlock]
      }
    } else if (result.content) {
      result.content = [{ type: 'text', text: result.content }, errorBlock]
    } else {
      result.content = [errorBlock]
    }
  }

  return result
}

export function selectMessageListSession(
  state: ChatStoreSnapshot,
  sessionId: string | null | undefined
): MessageListSessionSelection {
  if (!sessionId) return EMPTY_MESSAGE_LIST_SESSION_SELECTION

  const idx = state.sessionsById[sessionId]
  if (idx === undefined) return EMPTY_MESSAGE_LIST_SESSION_SELECTION

  const session = state.sessions[idx]
  const rawMessages = session.messages ?? EMPTY_MESSAGES_RAW
  const messages = rawMessages.length > 0
    ? convertChatMessagesToUnified(rawMessages)
    : EMPTY_MESSAGES

  return {
    messages,
    messagesLoaded: session.messagesLoaded ?? false,
    messageCount: session.messageCount ?? 0,
    workingFolder: session.workingFolder,
    loadedRangeStart: session.loadedRangeStart ?? 0,
    totalTurns: session.totalTurns ?? 0,
    projectId: session.projectId
  }
}

export function selectSessionScopedTeamState(
  state: TeamStoreSnapshot,
  sessionId: string | null | undefined
): SessionScopedTeamSelection {
  if (!sessionId) return EMPTY_SESSION_TEAM_SELECTION

  const activeTeam = state.activeTeam?.sessionId === sessionId ? state.activeTeam : null
  let teamHistory = EMPTY_TEAM_HISTORY
  const signatureParts: string[] = []

  if (activeTeam) {
    signatureParts.push(`active:${buildTeamRenderSignature(activeTeam)}`)
  }

  for (const team of state.teamHistory) {
    if (team.sessionId !== sessionId) continue
    if (teamHistory === EMPTY_TEAM_HISTORY) teamHistory = []
    teamHistory.push(team)
    signatureParts.push(`history:${buildTeamRenderSignature(team)}`)
  }

  const signature = signatureParts.join('\u0001')
  const cached = sessionScopedTeamSelectionCache.get(sessionId)
  if (cached?.signature === signature) return cached

  const nextSelection: SessionScopedTeamSelection = {
    activeTeam,
    teamHistory,
    isTeamRunning: activeTeam ? isActiveTeamRunning(activeTeam) : false,
    hasOrchestrationData: Boolean(activeTeam) || teamHistory !== EMPTY_TEAM_HISTORY,
    signature
  }

  sessionScopedTeamSelectionCache.set(sessionId, nextSelection)
  return nextSelection
}

export function getOrchestrationRunSignature(
  run?: import('@renderer/lib/orchestration/types').OrchestrationRun | null
): string {
  if (!run) return ''

  const memberSig = run.members
    .map(
      (member) =>
        `${member.id}:${member.status}:${member.iteration}:${member.progress}:${member.toolCallCount}:${member.completedAt ?? ''}:${member.latestAction}:${member.summary}`
    )
    .join('|')

  return [
    run.id,
    run.status,
    run.stageIndex,
    run.stageCount,
    run.selectedMemberId ?? '',
    run.completedAt ?? '',
    run.summary,
    run.latestAction,
    memberSig
  ].join('::')
}
void getOrchestrationRunSignature

/**
 * S-247（2026-10-31）：`renderableMessages` 每帧都被 `map` 成新对象，所以
 * `prev.item === next.item` 在流式期间恒为 false —— 12 行全部重渲染。
 * 改成按语义比较：转换层逐条复用后，没变的消息 `item.message` 引用相同，
 * 只让真正变化的那一行（通常是正在流式的 assistant）重渲染。
 */
function areRenderableItemsEqual(prev: RenderableChatItem, next: RenderableChatItem): boolean {
  if (prev === next) return true
  if (prev.kind !== next.kind) return false

  if (prev.kind === 'message' && next.kind === 'message') {
    return (
      prev.message === next.message &&
      prev.displayId === next.displayId &&
      prev.messageId === next.messageId &&
      prev.originMessageId === next.originMessageId &&
      prev.isLastUserMessage === next.isLastUserMessage &&
      prev.isLastAssistantMessage === next.isLastAssistantMessage &&
      prev.fragment?.position === next.fragment?.position &&
      prev.fragment?.operationId === next.fragment?.operationId &&
      prev.fragment?.totalElapsedMs === next.fragment?.totalElapsedMs
    )
  }

  if (prev.kind === 'context-compression' && next.kind === 'context-compression') {
    return (
      prev.id === next.id &&
      prev.messageId === next.messageId &&
      prev.summary === next.summary &&
      prev.boundary === next.boundary &&
      prev.operationId === next.operationId &&
      prev.trigger === next.trigger
    )
  }

  if (prev.kind === 'live-compression' && next.kind === 'live-compression') {
    return (
      prev.id === next.id &&
      prev.messageId === next.messageId &&
      prev.sessionId === next.sessionId &&
      prev.operationId === next.operationId &&
      prev.trigger === next.trigger &&
      prev.draft === next.draft &&
      prev.startedAt === next.startedAt &&
      prev.attempt === next.attempt &&
      prev.maxAttempts === next.maxAttempts
    )
  }

  return false
}

export function areMessageRowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    areRenderableItemsEqual(prev.item, next.item) &&
    prev.sessionId === next.sessionId &&
    areStringArraysEqual(prev.sessionAssistantMessageIds, next.sessionAssistantMessageIds) &&
    areStringArraysEqual(prev.sessionToolUseIds, next.sessionToolUseIds) &&
    prev.isStreaming === next.isStreaming &&
    prev.isLastUserMessage === next.isLastUserMessage &&
    prev.isLastAssistantMessage === next.isLastAssistantMessage &&
    prev.disableAnimation === next.disableAnimation &&
    prev.fullWidth === next.fullWidth &&
    (prev.toolResults === next.toolResults ||
      areToolResultsEqual(prev.toolResults, next.toolResults)) &&
    prev.orchestrationRun === next.orchestrationRun &&
    prev.hiddenToolUseIds === next.hiddenToolUseIds &&
    prev.anchorMessageId === next.anchorMessageId &&
    prev.highlightMessageId === next.highlightMessageId &&
    prev.renderMode === next.renderMode &&
    prev.showChangeSummary === next.showChangeSummary &&
    areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState) &&
    prev.onEditUserMessage === next.onEditUserMessage
  )
}

export function getDistanceToBottom(ref: HTMLDivElement): number {
  return Math.max(0, ref.scrollHeight - ref.scrollTop - ref.clientHeight)
}

export function findPendingAskUserQuestion(
  rows: MessageListRow[],
  toolResultsLookup: Map<string, ToolResultsLookup>,
  messageLookup: Map<string, UnifiedMessage>
): AskUserQuestionPresence | null {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex]
    if (row.type !== 'message') continue

    const message = messageLookup.get(row.data.messageId)
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const toolResults = toolResultsLookup.get(row.data.messageId)
    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue
      if (toolResults?.has(block.id)) continue
      return { assistantMessageId: row.data.messageId, toolUseId: block.id }
    }
  }

  return null
}


// Locator utilities extracted to locator-utils.ts
export {
  normalizeLocatorPreview,
  truncateAssistantRailPreview,
  isSystemPromptText,
  getUserMessageText,
  getAssistantVisibleText,
  countToolUseBlocks,
  countCodeFenceBlocks,
  isTeamLocatorSource,
  shouldShowAssistantRailMarker,
  getAssistantRailMarkerKind,
  buildAssistantRailPreview,
  estimateLocatorRowHeight,
  buildAssistantRailLayout,
  parseLocatorRowSource,
  countImageBlocks,
  getCompactRailGapPx,
  getCompactRailMarkerOffsetPx,
  getCompactRailMarkerTop,
  getCompactRailMarkerY,
  formatLocatorTime,
  splitLocatorPreview,
  parseLocatorContent,
  parseLocatorMeta,
} from './locator-utils'
