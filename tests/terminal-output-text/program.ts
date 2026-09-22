// iter-34 S-134 — 终端输出的纯文本投影。
//
// agent 的 Terminal 工具读回的是 node-pty 写的原始字节（颜色、光标移动、`\r` 覆盖），而模型要的是
// 「屏幕上当时显示的字」。中间只经过 src/main/ipc/terminal-output-text.ts 这一个纯函数模块：
//   terminal-reverse-handler.start/read → renderTerminalBuffer() → 工具返回值
//
// 重点锁五条：
//   1. CSI（颜色、清行、隐藏光标）必须剥干净，不能把转义码喂给模型
//   2. OSC（窗口标题）必须整条剥掉 —— 标题里带空格，用字符类匹配会只吃掉 `ESC]0` 留半截垃圾
//   3. `\r` 按终端语义折叠成「最后一次重绘」；`\r\n` 的尾部 `\r` 是行尾，不能把整行吃空
//   4. 跨 chunk 的一行要拼回一行（一个逻辑行会被切成多个 chunk）
//   5. 只截尾、有上限，且截尾标记要带上被丢掉的字数

import assert from 'node:assert/strict'
import {
  collapseCarriageReturns,
  renderTerminalBuffer,
  stripAnsi,
  tailText,
  toPlainText,
  TERMINAL_TEXT_MAX_CHARS
} from '../../src/main/ipc/terminal-output-text'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

function ok(value: unknown, message: string): void {
  checks++
  assert.ok(value, message)
}

// ── 1. CSI ────────────────────────────────────────────────────────────────

eq(stripAnsi('\u001b[31merror\u001b[0m: boom'), 'error: boom', '颜色码被剥掉')
eq(stripAnsi('\u001b[1;32mdone\u001b[0m'), 'done', '多参 CSI 被剥掉')
eq(stripAnsi('\u001b[38;5;196mred\u001b[0m'), 'red', '256 色（冒号/分号序列）被剥掉')
eq(stripAnsi('\u001b[2K\u001b[1Gline'), 'line', '清行 + 回列的 CSI 被剥掉')
eq(stripAnsi('a\u001b[?25lb'), 'ab', '隐藏光标的私有 CSI 被剥掉')
eq(stripAnsi('\u001bXstill here'), '\u001bXstill here', '不认识的两字符 ESC 原样留着（宁可留字也不误吃）')
eq(stripAnsi('plain text'), 'plain text', '没有转义码的正文一字不动')

// ── 2. OSC ────────────────────────────────────────────────────────────────

eq(stripAnsi('\u001b]0;npm run dev\u0007output'), 'output', 'OSC 标题（BEL 结束）整条剥掉')
eq(stripAnsi('\u001b]2;my title here\u001b\\output'), 'output', 'OSC 标题（ESC \\ 结束）整条剥掉')
eq(stripAnsi('a\u001b]0;ti\u001b\\b'), 'ab', 'OSC 两侧的正文都留下')

// ── 3. \r 折叠 ────────────────────────────────────────────────────────────

eq(
  collapseCarriageReturns('10% done\r60% done\r100% done'),
  '100% done',
  '进度行只留最后一次重绘'
)
eq(collapseCarriageReturns('first\nsecond\rthird'), 'first\nthird', '行内覆盖只影响本行')
eq(collapseCarriageReturns('line1\r\nline2'), 'line1\nline2', 'CRLF 的尾部 \\r 是行尾，不能吃空整行')
eq(collapseCarriageReturns('line1\r\nline2\r\n'), 'line1\nline2\n', '末尾 CRLF 也照常归一')
eq(collapseCarriageReturns('abc\r'), 'abc', '行尾孤立的 \\r 不改变已有文字')

// ── 4. 跨 chunk 的一行 ────────────────────────────────────────────────────

eq(
  renderTerminalBuffer([{ data: '\u001b[32m' }, { data: 'hel' }, { data: 'lo\u001b[0m\n' }]),
  'hello\n',
  '被切成三块的一行（含颜色码）拼回一行'
)
eq(
  renderTerminalBuffer([{ data: 'a\r' }, { data: 'b' }]),
  'b',
  'chunk 边界落在 \\r 后面时，仍按同一行重绘'
)

// ── 5. 截尾 ───────────────────────────────────────────────────────────────

eq(tailText('short'), 'short', '没超上限就原样返回')
eq(toPlainText('\u001b[2J\u001b[H'), '', '整屏清屏序列剥完只剩空串')

const oversized = 'x'.repeat(TERMINAL_TEXT_MAX_CHARS + 10)
const tail = tailText(oversized)
ok(tail.startsWith('[... 10 earlier characters trimmed]\n'), '截尾时带上被丢掉的字数')
eq(
  tail.slice(-TERMINAL_TEXT_MAX_CHARS),
  oversized.slice(-TERMINAL_TEXT_MAX_CHARS),
  '保留的是尾部而不是头部'
)

const bounded = renderTerminalBuffer([{ data: 'a'.repeat(TERMINAL_TEXT_MAX_CHARS + 500) }])
ok(bounded.includes('earlier characters trimmed'), '超长缓冲同样会被截尾')
eq(
  bounded.slice(-TERMINAL_TEXT_MAX_CHARS),
  'a'.repeat(TERMINAL_TEXT_MAX_CHARS),
  '截尾后正文恰好留 12000 字'
)

console.log(`terminal output text checks passed (${checks} assertions).`)
