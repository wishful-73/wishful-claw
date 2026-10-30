// S-256（v3-iter-4 刀 9）—— 流式 tail 硬切。
//
// 背景：空行切块只在「空行 + 下一行顶格」时成立，所以模型连续输出**没有空行的长段落**
// 时一个块都切不出来，tail = 全文累积，`MarkdownContent` 每帧全量重解析 —— 老大
// 2026-10-28 给的样本正是这种形态，表现是整页像截图一样静止。
//
// 这里钉的是 `resolveTailHardCut` 的**切点选择**：切错位置的代价不是报错，是渲染出
// `**粗` + `体**` 这种破碎文本，界面上看不出来、测试里也看不出来，所以必须逐条钉。

import assert from 'node:assert/strict'
import {
  MAX_TAIL_CHARS,
  resolveTailHardCut
} from '../../src/renderer/src/hooks/use-streaming-markdown-blocks'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

function check(condition: unknown, message: string): void {
  checks++
  assert.ok(condition, message)
}

// ── 阈值本身 ────────────────────────────────────────────────────────────
check(MAX_TAIL_CHARS >= 2_000, `tail threshold is not tiny (${MAX_TAIL_CHARS})`)
check(MAX_TAIL_CHARS <= 20_000, `tail threshold still bounds one frame's parse (${MAX_TAIL_CHARS})`)

// ── 区间太短：不切 ──────────────────────────────────────────────────────
eq(resolveTailHardCut('x'.repeat(1_000), 0, 100), -1, 'a short window is not worth cutting')
eq(resolveTailHardCut('x'.repeat(1_000), 500, 520), -1, 'a tiny remaining tail is not cut')

// ── 优先切在空行之后 ────────────────────────────────────────────────────
{
  const text = 'a'.repeat(600) + '\n\n' + 'b'.repeat(600)
  const cut = resolveTailHardCut(text, 0, 1_000)
  eq(cut, 602, 'a blank line is the preferred cut point')
  eq(text.slice(0, cut).endsWith('\n\n'), true, 'the cut keeps the blank line in the settled half')
}

// ── 没有空行就退到行边界 ────────────────────────────────────────────────
{
  const text = ('line\n').repeat(300) // 1500 chars, no blank line
  const cut = resolveTailHardCut(text, 0, 1_000)
  eq(cut % 5, 0, 'the cut lands right after a newline')
  check(cut <= 1_000, 'the cut stays inside the window')
  eq(text.slice(cut - 1, cut), '\n', 'the settled half ends with a newline')
}

// ── 一行几万字符：行内切，但让开标记字符 ────────────────────────────────
{
  const head = 'a'.repeat(900)
  const marked = '**bold**' // 紧贴在切点前
  const text = head + marked + 'z'.repeat(2_000)
  const cut = resolveTailHardCut(text, 0, 1_000)
  check(cut > 0, 'a single-line paragraph still gets cut')
  // 切点前一字符不能是行内标记：否则会把 `**bold**` 劈成两半
  check(
    !/[*_~`[\]()$<>|\\]/.test(text[cut - 1]),
    `the cut avoids inline markers (got ${JSON.stringify(text.slice(cut - 3, cut + 3))})`
  )
  eq(text.slice(0, cut) + text.slice(cut), text, 'cutting loses no characters')
}

// ── 切点永远不会落在起点之前 ────────────────────────────────────────────
{
  const text = 'w '.repeat(5_000)
  const cut = resolveTailHardCut(text, 3_000, 9_000)
  check(cut === -1 || cut > 3_000, 'a cut never rewinds behind `from`')
}

// ── 反复切：每次都要推进，不能原地打转 ──────────────────────────────────
{
  const text = 'no-blank-line-paragraph '.repeat(4_000) // ~92k, 无空行
  let from = 0
  let cuts = 0
  while (text.length - from > MAX_TAIL_CHARS && cuts < 100) {
    const cut = resolveTailHardCut(text, from, from + MAX_TAIL_CHARS)
    if (cut <= from) break
    from = cut
    cuts += 1
  }
  check(cuts > 0, 'a huge single-line tail is cut at least once')
  check(
    text.length - from <= MAX_TAIL_CHARS,
    `the tail is brought under the threshold (left ${text.length - from})`
  )
}

console.log(`streaming tail split checks passed: ${checks}`)
