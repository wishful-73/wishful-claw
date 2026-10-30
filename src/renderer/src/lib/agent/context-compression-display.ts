// 压缩摘要的「识别 + 显示」链路 —— 纯函数，不碰 IPC / electron。
//
// 从 context-compression.ts 拆出来的理由有两条：
//   1. **可测**：原文件顶层 import 了 `agent-bridge-streaming`（连带 `ipc-client`），
//      node 里静态 import 就会炸，导致 `getCompactSummaryDisplayText` 一直是零覆盖的。
//      这段逻辑全是字符串处理，跟 IPC 毫无关系，拆出来直接 `import` 就能断言。
//   2. **有 bug 需要锁**：S-208 的快照剥离第一版是「按空行切块 + 逐块看前缀」，
//      用户原话里一有空行就会漏字（见 stripLatestUserSnapshot 注释）。
import type { SummarizerFailureReason, UnifiedMessage } from '../api/types'
import { LEGACY_SUMMARY_PREFIXES } from './context-compression-config'

// ── 摘要消息识别 ──

export function isCompactBoundaryMessage(message: UnifiedMessage): boolean {
  return message.role === 'system' && !!message.meta?.compactBoundary
}

export function isCompactSummaryMessage(message: UnifiedMessage): boolean {
  return message.role === 'user' && !!message.meta?.compactSummary
}

/**
 * 老会话里的摘要卡没有 `meta.compactSummary`，只有正文前缀。
 *
 * 参数收窄到「role + content 两个字段」，是因为 S-276 的 `isRealUserTurn` 要拿它判
 * `ChatMessage`（`stores/chat-store/types.ts`，正文在 `content`，可能为 undefined），
 * 而 `UnifiedMessage` 只是它的一种形态。两处必须同一套前缀判据。
 */
function matchesLegacySummaryPrefix(role: string, content: unknown): boolean {
  if (role !== 'user' || typeof content !== 'string') return false
  const trimmed = content.trim()
  return LEGACY_SUMMARY_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

export function isLegacyCompactSummaryMessage(message: UnifiedMessage): boolean {
  return matchesLegacySummaryPrefix(message.role, message.content)
}

export function isCompactSummaryLikeMessage(message: UnifiedMessage): boolean {
  return isCompactSummaryMessage(message) || isLegacyCompactSummaryMessage(message)
}

/**
 * 「真实用户轮」的唯一判据 —— 数轮次的地方一律走它，不要直接比 `role === 'user'`。
 *
 * 压缩摘要卡写库时 `role` 也是 `'user'`（worker `CreateSummaryWireMessage` 刻意如此，
 * 让模型把摘要当用户陈述读），但它在语义上不是用户发的话。只看 `role` 的轮次计数
 * 会让摘要卡吃掉名额：一个压缩过 20 次的会话，「最近 5 轮」的 5 个名额全给卡，
 * 真实消息一条都进不了窗口（S-276 实测症状）。
 *
 * worker 侧同口径见 `DbMessageToolsQueries.cs` 的 `RealUserTurnPredicate`（SQL 常量，
 * 跨语言共用不了函数）。**改一处必须同步另一处**，两侧各有单测钉住。
 */
export function isRealUserTurn(message: {
  role: string
  content?: unknown
  meta?: { compactSummary?: unknown } | null
}): boolean {
  if (message.role !== 'user') return false
  if (message.meta?.compactSummary) return false
  return !matchesLegacySummaryPrefix(message.role, message.content)
}

export function isCompactArtifactMessage(message: UnifiedMessage): boolean {
  return isCompactBoundaryMessage(message) || isCompactSummaryLikeMessage(message)
}

// ── 正文提取与展示 ──

export function extractUnifiedMessageText(message?: UnifiedMessage | null): string {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content.trim()
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

function stripCompactionSummaryTags(text: string): string {
  return text
    .replace(/^\s*<compaction-summary>\s*/i, '')
    .replace(/\s*<\/compaction-summary>\s*$/i, '')
    // Legacy sessions still carry this English intro inside the durable conversation.
    // Current Worker output omits it, so the wrapper text can come from i18n instead.
    .replace(/^Summary of earlier conversation \(older messages were compacted to save context\):\s*/i, '')
    .trim()
}

function splitCompactSummaryBlocks(text: string): string[] {
  return stripCompactionSummaryTags(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function isCompactSummaryTitleBlock(block: string): boolean {
  const trimmed = block.trim()
  if (!trimmed) return false
  if (LEGACY_SUMMARY_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true
  }
  if (!/^\[[^\]\n]+]$/.test(trimmed)) {
    return false
  }
  return (
    /summary|compressed|compacted|memory/i.test(trimmed) ||
    /[\u4e0a\u4e0b\u6587\u6458\u8981\u538b\u7f29]/u.test(trimmed)
  )
}

function isCompactSummaryIntroBlock(block: string): boolean {
  const normalized = block.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > 320) {
    return false
  }
  return [
    /this session is being continued/i,
    /continued from a previous conversation/i,
    /the following summary covers/i,
    /recent messages are preserved/i,
    /\u672c\u6b21\u4f1a\u8bdd.*\u7ee7\u7eed/u,
    /\u4ee5\u4e0b\u6458\u8981.*\u6d88\u606f/u,
    /\u8fd1\u671f\u6d88\u606f.*\u4fdd\u7559/u
  ].some((pattern) => pattern.test(normalized))
}

// ── S-208：压缩时刻的用户消息快照 ──

/** 快照块的两个行首前缀（Worker 侧 `BuildLatestUserSnapshotBlock` 写死）。 */
const LATEST_USER_SNAPSHOT_PREFIXES = ['\u3010\u7528\u6237\u6d88\u606f', '\u3010\u538b\u7f29\u65f6\u523b'] as const

/**
 * 快照块的收束句，与 Worker 侧 `BuildLatestUserSnapshotBlock` 的末行逐字一致。
 *
 * 它是快照块**唯一可靠的结束锚点**。不能用「按空行切块 + 逐块看前缀」来剥：快照里装的是
 * 用户原话，而粘多段文本是最常见的输入形态。一条含空行的用户消息切出来是
 * `["【用户消息 · …】\n第 1 段", "第 2 段", "【压缩时刻 · …】\n<收束句>", "<摘要>"]`，
 * 第 2 块不以前缀开头 ⇒ 逐块循环当场停下，后半段和整块压缩时刻一起漏回卡片。
 */
const LATEST_USER_SNAPSHOT_TERMINATOR =
  '以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。'

function isLatestUserSnapshotBlock(block: string): boolean {
  const trimmed = block.trim()
  return LATEST_USER_SNAPSHOT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

/**
 * 把快照块整段剥掉，返回摘要正文 —— 与段落数、与用户原话里有没有空行都无关。
 *
 * 只认 Worker 写死的收束句，认不出就原样返回：旧摘要根本没有这一段，而猜一个位置去截断，
 * 代价是把用户真正想看的摘要正文吃掉。
 */
function stripLatestUserSnapshot(text: string): string {
  const head = text.trimStart()
  if (!isLatestUserSnapshotBlock(head)) {
    return text
  }
  const at = head.indexOf(LATEST_USER_SNAPSHOT_TERMINATOR)
  if (at < 0) {
    return text
  }
  return head.slice(at + LATEST_USER_SNAPSHOT_TERMINATOR.length).trim()
}

/**
 * S-269：摘要降级的文案分档。
 *
 * 「摘要生成不可用」在渠道限流时是**错误结论** —— 摘要器本身好好的，是上游用
 * 429 把我们挡回来了（实测原文 `retry shortly (after 29 s)`）。这里按 worker 带回
 * 来的 reason 选文案，认不出的才落回兜底那句。
 *
 * 返回 key + 英文 defaultValue，调用方直接丢给 `t()`，与项目里其它 i18n 文案同构。
 */
export function getSummarizerFallbackCopy(
  reason: SummarizerFailureReason | null | undefined
): { key: string; defaultValue: string } {
  switch (reason) {
    case 'rate_limited':
      return {
        key: 'contextCompression.summarizerRateLimited',
        defaultValue:
          'Provider is rate-limiting this channel; fallback summary used and the summarizer will retry later'
      }
    case 'server_error':
      return {
        key: 'contextCompression.summarizerServerError',
        defaultValue: 'Provider is temporarily unavailable; fallback summary used'
      }
    case 'timeout':
      return {
        key: 'contextCompression.summarizerTimeout',
        defaultValue: 'Summarizer timed out; fallback summary used'
      }
    case 'context_overflow':
      return {
        key: 'contextCompression.summarizerContextOverflow',
        defaultValue: 'Folded context exceeded the summarizer window; fallback summary used'
      }
    default:
      return {
        key: 'contextCompression.summarizerFailed',
        defaultValue: 'Fallback summary used (summarizer unavailable)'
      }
  }
}

/**
 * S-269：具体原因短句。只在能识别出原因时返回 —— 认不出就返回 null，让调用方
 * 不要再补一句「摘要不可用」与主警告重复。
 */
export function getSummarizerFailureReasonCopy(
  reason: SummarizerFailureReason | null | undefined
): { key: string; defaultValue: string } | null {
  switch (reason) {
    case 'rate_limited':
      return {
        key: 'contextCompression.summarizerReasonRateLimited',
        defaultValue: 'Cause: channel rate limit — the summarizer retries on its own'
      }
    case 'server_error':
      return {
        key: 'contextCompression.summarizerReasonServerError',
        defaultValue: 'Cause: provider temporarily unavailable'
      }
    case 'timeout':
      return {
        key: 'contextCompression.summarizerReasonTimeout',
        defaultValue: 'Cause: summarizer request timed out'
      }
    case 'context_overflow':
      return {
        key: 'contextCompression.summarizerReasonContextOverflow',
        defaultValue: 'Cause: folded context exceeded the summarizer window'
      }
    default:
      return null
  }
}

/**
 * 摘要正文的展示文本。
 *
 * `t` 由调用方注入而不是直接 `import i18n` —— 这样整个模块是纯函数、可单测；
 * `context-compression.ts` 里的同名导出会传入 `i18n.t` 并保持原签名，调用点零改动。
 */
export function getCompactSummaryDisplayTextWith(
  message: UnifiedMessage,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const meta = message.meta?.compactSummary
  if (meta?.summarizerFailed) {
    // A mechanical-fold digest is model-facing English prose baked into the durable
    // conversation. The UI shows the localized equivalent instead; the stored text
    // stays untouched, so the interface language never degrades what the model reads.
    return t('contextCompression.mechanicalFoldDigest', {
      ns: 'agent',
      messageCount: meta.messagesSummarized ?? 0,
      defaultValue:
        '{{messageCount}} earlier messages were folded here to free context, but the automatic summary was unavailable.'
    })
  }

  const text = stripLatestUserSnapshot(stripCompactionSummaryTags(extractUnifiedMessageText(message)))
  if (!text || !isCompactSummaryLikeMessage(message)) {
    return text
  }

  const blocks = splitCompactSummaryBlocks(text)
  if (blocks.length === 0) {
    return text
  }

  let startIndex = 0
  if (isCompactSummaryTitleBlock(blocks[startIndex]!)) {
    startIndex += 1
  }
  if (startIndex < blocks.length - 1 && isCompactSummaryIntroBlock(blocks[startIndex]!)) {
    startIndex += 1
  }

  return blocks.slice(startIndex).join('\n\n').trim() || text
}
