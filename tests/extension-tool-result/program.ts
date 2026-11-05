/*
 * 插件工具结果的渲染端总闸（iter-40 S-305）。
 *
 * 存在理由：`parseExtensionToolResult` 此前是 `return null` 的空桩，6 种渲染器 + iframe 沙箱
 * 全沉在代码里一张卡片都出不来。这函数唯一的职责就是「认不认这份包装」，认错了比不认更糟：
 * 认错 → 调用方把一段业务 JSON 当渲染指令去喂 SchemaRenderer，出来的卡片是空的。
 *
 * 钉死五条：
 *   ① 只有 `__wishfulClawExtensionResult === true` 才认，其余一律 null；
 *   ② 缺 extensionId 也不认（渲染器要靠它去插件清单里找 renderers / components）；
 *   ③ ui 必须带认识的 kind，认不出就丢掉 ui、保留其余字段 —— 退化成纯文本，不要空白卡片；
 *   ④ 包装 JSON 被切成多个 text block 时也要能拼回来；
 *   ⑤ data 原样透传，不丢字段。
 */

import assert from 'node:assert/strict'
import { parseExtensionToolResult } from '../../src/renderer/src/lib/extensions/extension-result'

let checks = 0

function check<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.deepEqual(actual, expected, `${description}（期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}）`)
}

function payload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ __wishfulClawExtensionResult: true, extensionId: 'demo.ext', ...extra })
}

// ─── 1. 合法包装：字段逐个过一遍 ───

const full = parseExtensionToolResult(
  payload({
    toolName: 'query',
    text: 'HTTP 200 OK',
    data: { ok: true, status: 200, body: { rows: [1, 2] } },
    ui: { kind: 'table', rows: [{ a: 1 }], columns: ['a'] }
  })
)

check(full?.extensionId, 'demo.ext', 'extensionId 取到')
check(full?.toolName, 'query', 'toolName 透传')
check(full?.text, 'HTTP 200 OK', 'text 透传')
check(full?.data, { ok: true, status: 200, body: { rows: [1, 2] } }, 'data 原样透传，不丢字段')
check(full?.ui?.kind, 'table', 'ui.kind 取到')

// ─── 2. 六种 kind 全认 ───

for (const kind of ['card', 'table', 'form', 'chart', 'html', 'component'] as const) {
  const parsed = parseExtensionToolResult(payload({ ui: { kind } }))
  check(parsed?.ui?.kind, kind, `kind=${kind} 认得出`)
}

// ─── 3. 该拒的必须拒 ───

check(parseExtensionToolResult(''), null, '空串不认')
check(parseExtensionToolResult('not json at all'), null, '非 JSON 不认')
check(parseExtensionToolResult('{"extensionId":"demo.ext"}'), null, '缺 __wishfulClawExtensionResult 不认')
check(
  parseExtensionToolResult(JSON.stringify({ __wishfulClawExtensionResult: false, extensionId: 'demo.ext' })),
  null,
  '标记是 false 不认'
)
check(parseExtensionToolResult(payload({ extensionId: '' })), null, 'extensionId 为空不认')
check(
  parseExtensionToolResult(JSON.stringify({ __wishfulClawExtensionResult: true })),
  null,
  '缺 extensionId 不认'
)
check(parseExtensionToolResult('[1,2,3]'), null, '顶层是数组不认')
check(parseExtensionToolResult(undefined), null, 'undefined 不认')

// ─── 4. ui 认不出就丢掉 ui，但别的字段照用 ───

const unknownKind = parseExtensionToolResult(payload({ ui: { kind: 'hologram' }, text: 'kept' }))
check(unknownKind?.extensionId, 'demo.ext', '未知 kind 不影响 extensionId')
check(unknownKind?.text, 'kept', '未知 kind 不影响 text')
check(unknownKind?.ui, undefined, '未知 kind 的 ui 被丢掉')

const noUi = parseExtensionToolResult(payload({ text: 'plain' }))
check(noUi?.ui, undefined, '没有 ui 就是 undefined')
check(noUi?.text, 'plain', '没有 ui 时 text 照常')

// ─── 5. 被切成多个 text block 也能拼回来 ───

const whole = payload({ text: 'HTTP 200 OK', ui: { kind: 'card', title: 'T' } })
const cut = Math.floor(whole.length / 2)
const blocks = [
  { type: 'text' as const, text: whole.slice(0, cut) },
  { type: 'text' as const, text: whole.slice(cut) }
]
check(parseExtensionToolResult(blocks)?.extensionId, 'demo.ext', '多 text block 拼回整份包装')
check(parseExtensionToolResult(blocks)?.ui?.kind, 'card', '拼回来之后 ui 也在')

console.log(`extension-tool-result: ${checks} checks passed`)
