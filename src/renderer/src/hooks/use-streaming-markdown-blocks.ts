/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useMemo, useRef } from 'react'

export interface StreamingMarkdownBlocks {
  settled: string[]
  tail: string
}

interface ScanState {
  prevText: string
  settled: string[]
  tailStart: number
  scanPos: number
  inFence: boolean
  fenceChar: string
  fenceLen: number
  inMath: boolean
  pendingBlankStart: number
  tailHasContent: boolean
}

const NO_SETTLED: string[] = []
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const BACKTICK_CLOSE_RE = /^`+$/
const TILDE_CLOSE_RE = /^~+$/
const INDENTED_LINE_RE = /^[ \t]/

/**
 * S-256：tail 允许的最大长度（字符）。超过就硬切一段进 settled。
 *
 * 空行切块只在「空行 + 下一行顶格」时才成立，所以两种情况下一个块都切不出来：
 * ①模型连续输出没有空行的长段落（老大 2026-10-28 给的样本正是这种）；②未闭合的
 * ``` / $$ 块。这时 tail = 全文累积，`MarkdownContent` 每帧全量重解析 + 重建整棵树。
 *
 * 8000 字符是「一屏多一点」的量级 —— 比它小的 tail 全量重解析还撑得住，比它大的就必须切。
 */
export const MAX_TAIL_CHARS = 8_000

/** 硬切时至少保留这么多字符给下一段，避免在尾部反复切出碎片块。 */
const MIN_HARD_CUT = 400

/** 行内标记字符 —— 切在它旁边会把 `**粗体**` 切成 `**粗` + `体**`。 */
const INLINE_MARKER_RE = /[*_~`[\]()$<>|\\]/

/**
 * 找出一个安全的硬切点：`[from, limit]` 区间内，尽量切在空行、其次行边界，
 * 最后才在行中切（并让开行内标记字符）。返回切点下标，切不动返回 -1。
 */
export function resolveTailHardCut(text: string, from: number, limit: number): number {
  const hardLimit = Math.min(text.length, limit)
  if (hardLimit - from < MIN_HARD_CUT) return -1

  const blank = text.lastIndexOf('\n\n', hardLimit)
  if (blank >= from + MIN_HARD_CUT) return blank + 2

  const lineEnd = text.lastIndexOf('\n', hardLimit)
  if (lineEnd >= from + MIN_HARD_CUT) return lineEnd + 1

  // 一行几万字符的长段落：只能行内切。往左让开标记字符（最多让 64 个），
  // 让不开就按原位切 —— 宁可闪一帧，也不能整页静止。
  let cut = hardLimit
  const floor = Math.max(from + MIN_HARD_CUT, hardLimit - 64)
  while (cut > floor && INLINE_MARKER_RE.test(text[cut - 1])) cut -= 1
  return cut > from ? cut : hardLimit
}


function createScanState(): ScanState {
  return {
    prevText: '',
    settled: [],
    tailStart: 0,
    scanPos: 0,
    inFence: false,
    fenceChar: '',
    fenceLen: 0,
    inMath: false,
    pendingBlankStart: -1,
    tailHasContent: false
  }
}

/**
 * Splits streaming markdown into settled blocks plus an unsettled tail so the
 * remark/rehype pipeline only ever re-parses the tail. Re-parsing the full
 * accumulated text on every render-pool tick is O(n²) over the response and
 * saturates the main thread on long answers.
 *
 * Blocks settle at blank lines outside code fences / $$ math blocks, and only
 * when the following line starts flush left (indented lines may continue the
 * previous construct). Splitting can subtly change list/reference-link
 * rendering while streaming; the final non-streaming render always parses the
 * complete text in one pass, so the settled result is unaffected.
 */
export function useStreamingMarkdownBlocks(
  text: string,
  isStreaming: boolean
): StreamingMarkdownBlocks {
  const stateRef = useRef<ScanState | null>(null)

  return useMemo(() => {
    if (!isStreaming) {
      stateRef.current = null
      return { settled: NO_SETTLED, tail: text }
    }

    let state = stateRef.current
    if (!state || text.length < state.prevText.length || !text.startsWith(state.prevText)) {
      state = createScanState()
      stateRef.current = state
    }
    if (text === state.prevText) {
      return { settled: state.settled, tail: text.slice(state.tailStart) }
    }

    let pos = state.scanPos
    while (true) {
      const newlineIndex = text.indexOf('\n', pos)
      if (newlineIndex === -1) break
      const lineStart = pos
      const line = text.slice(lineStart, newlineIndex)
      pos = newlineIndex + 1
      const trimmed = line.trim()

      if (state.inFence) {
        if (
          trimmed.length >= state.fenceLen &&
          (state.fenceChar === '`' ? BACKTICK_CLOSE_RE : TILDE_CLOSE_RE).test(trimmed)
        ) {
          state.inFence = false
        }
        continue
      }

      if (state.inMath) {
        if (trimmed.endsWith('$$')) {
          state.inMath = false
        }
        continue
      }

      if (trimmed === '') {
        if (state.pendingBlankStart === -1 && state.tailHasContent) {
          state.pendingBlankStart = lineStart
        }
        continue
      }

      if (state.pendingBlankStart !== -1) {
        if (!INDENTED_LINE_RE.test(line)) {
          state.settled = [...state.settled, text.slice(state.tailStart, state.pendingBlankStart)]
          state.tailStart = lineStart
        }
        state.pendingBlankStart = -1
      }
      state.tailHasContent = true

      const fenceMatch = FENCE_OPEN_RE.exec(line)
      if (fenceMatch) {
        state.inFence = true
        state.fenceChar = fenceMatch[1][0]
        state.fenceLen = fenceMatch[1].length
      } else if (trimmed.startsWith('$$') && !(trimmed.length > 2 && trimmed.endsWith('$$'))) {
        state.inMath = true
      }
    }

    state.scanPos = pos
    state.prevText = text

    // S-256：空行切不出东西（无空行长段落 / 未闭合 fence）时 tail 会长到吃满主线程，
    // 这里兜底硬切。fence / math 内部绝不切 —— 切开会让代码块渲染错乱。
    while (
      !state.inFence &&
      !state.inMath &&
      text.length - state.tailStart > MAX_TAIL_CHARS
    ) {
      const cut = resolveTailHardCut(text, state.tailStart, state.tailStart + MAX_TAIL_CHARS)
      if (cut <= state.tailStart) break
      state.settled = [...state.settled, text.slice(state.tailStart, cut)]
      state.tailStart = cut
    }

    return { settled: state.settled, tail: text.slice(state.tailStart) }
  }, [text, isStreaming])
}
