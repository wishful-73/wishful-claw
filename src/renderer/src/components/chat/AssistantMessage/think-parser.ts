// Think tag parsing and structured block normalization

import type { ContentBlock } from '@renderer/lib/api/types'
import { THINK_OPEN_TAG_RE, type ThinkSegment } from './types'
// S-247：从纯模块取，别从 './utils' 取 —— 那个文件的值 import 链会把 store 拖进 node，
// 于是本文件就没法在 node 里单测 `normalizeStructuredBlocks` 的流式分支。
import { stripThinkTags, stripThinkTagMarkers } from '@renderer/lib/agent/think-tags'

// 对外 API 不变：`stripThinkTags` 原先定义在本文件，别处仍在 import。
export { stripThinkTags }

export function parseThinkTags(text: string): ThinkSegment[] {
  if (!THINK_OPEN_TAG_RE.test(text)) {
    return [{ type: 'text', content: stripThinkTagMarkers(text) }]
  }

  const segments: ThinkSegment[] = []
  const regex = /<\s*think\s*>([\s\S]*?)(<\s*\/\s*think\s*>|$)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = stripThinkTagMarkers(text.slice(lastIndex, match.index))
      if (before.trim()) segments.push({ type: 'text', content: before })
    }
    segments.push({ type: 'think', content: stripThinkTagMarkers(match[1]), closed: !!match[2] })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    const remaining = stripThinkTagMarkers(text.slice(lastIndex))
    if (remaining.trim()) segments.push({ type: 'text', content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: stripThinkTagMarkers(text) }]
}

export function normalizeStructuredBlocks(
  blocks: ContentBlock[],
  options: { preserveBoundaryAfterRawIndices?: Set<number>; streaming?: boolean } = {}
): ContentBlock[] {
  const hasStructuredThinkingBlocks = blocks.some((b) => b.type === 'thinking')
  const normalized: ContentBlock[] = []
  const toolUseIndices = new Map<string, number>()
  /**
   * S-247（2026-10-31）：流式期间跳过 strip / trim。
   *
   * 每帧都会拿新 `content` 重跑本函数，而 `block.text` / `block.thinking` 是
   * `+=` 拼出来的 ConsString —— `stripThinkTags`、`stripThinkTagMarkers`、
   * `trim()` 任一被调用，V8 都要先 flatten 整条 rope 再复制一遍。长回复时
   * 31fps × 上百 KB，就是堆峰值和 rss 冲高的主源。
   *
   * 跳过是安全的：走到 strip 的前提是「已有结构化 thinking block」，那时
   * think 内容已被分离进 thinking block，text 里不该再有标签；thinking 里
   * 也不该再嵌标签。`streaming` 翻回 false 时本函数会重跑一次全量清理，
   * 真有残留也只在流式过程中短暂可见。
   */
  const skipTextCleanup = !!options.streaming

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]
    const previousRawIndex = blockIndex - 1
    const preservePreviousBoundary = options.preserveBoundaryAfterRawIndices?.has(previousRawIndex)

    if (block.type === 'text') {
      const text =
        hasStructuredThinkingBlocks && !skipTextCleanup ? stripThinkTags(block.text) : block.text
      // 流式期间用长度判空（O(1)），非流式仍用 trim 判空，避免空白 block 占位。
      if (skipTextCleanup ? text.length === 0 : !text.trim()) continue
      const last = normalized[normalized.length - 1]
      if (last && last.type === 'text' && !preservePreviousBoundary) {
        normalized[normalized.length - 1] = { ...last, text: `${last.text}${text}` }
      } else {
        normalized.push({ ...block, text })
      }
      continue
    }

    if (block.type === 'thinking') {
      const cleanedThinking = skipTextCleanup
        ? block.thinking
        : stripThinkTagMarkers(block.thinking).trim()
      if (skipTextCleanup ? cleanedThinking.length === 0 : !cleanedThinking) continue
      const last = normalized[normalized.length - 1]
      if (last && last.type === 'thinking' && !preservePreviousBoundary) {
        const separator =
          last.thinking.endsWith('\n') || cleanedThinking.startsWith('\n') ? '' : '\n'
        normalized[normalized.length - 1] = {
          ...last,
          thinking: `${last.thinking}${separator}${cleanedThinking}`,
          startedAt: last.startedAt ?? block.startedAt,
          completedAt: block.completedAt ?? last.completedAt
        }
      } else {
        normalized.push({ ...block, thinking: cleanedThinking })
      }
      continue
    }

    if (block.type === 'tool_use' && block.id) {
      const existingIndex = toolUseIndices.get(block.id)
      if (existingIndex !== undefined) {
        normalized[existingIndex] = {
          ...(normalized[existingIndex] as Extract<ContentBlock, { type: 'tool_use' }>),
          ...block
        }
        continue
      }

      toolUseIndices.set(block.id, normalized.length)
    }

    normalized.push(block)
  }

  return normalized
}
