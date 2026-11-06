/*
 * S-348 回归：浏览器工具卡摘要的兜底不许回显工具名。
 *
 * 病根是 `buildSummary` 末行的 `return name` —— `BrowserToolCard.tsx:105` 是
 * `primary: summary || title`，一旦 summary 拿到裸 camelCase，`||` 就短路，
 * 已本地化的 title 永远用不上，用户看到的是 `BrowserSetDevice`。
 *
 * S-270 修过 title 侧的同一个病（`fallbackTitle` 末行 `return name`），
 * 这里钉对称的另一侧，并且**按工具名常量逐个过**，防止加第 9 个浏览器工具时再漏。
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { buildSummary, getResultRows } from '../../src/renderer/src/components/chat/BrowserToolCard/summary'
import {
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_GET_CONTENT_TOOL_NAME,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_SET_DEVICE_TOOL_NAME,
  BROWSER_SNAPSHOT_TOOL_NAME,
  BROWSER_TYPE_TOOL_NAME
} from '../../src/renderer/src/lib/app-plugin/types'

const tests: Array<[string, () => void]> = []

function test(name: string, run: () => void): void {
  tests.push([name, run])
}

const localesRoot = path.resolve(__dirname, '../../../src/renderer/src/locales')
const zhChat = JSON.parse(
  fs.readFileSync(path.join(localesRoot, 'zh/chat.json'), 'utf8').replace(/^\uFEFF/, '')
) as Record<string, unknown>

function lookup(key: string): string | null {
  let node: unknown = zhChat
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : null
}

/** `t` 的替身：先查 zh 表，再走 defaultValue，都做插值；落空返回 key（同 i18next）。 */
function t(key: string, options?: Record<string, unknown>): string {
  const template = lookup(key) ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : null)
  if (template == null) return key
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options?.[k] ?? ''))
}

const ALL_BROWSER_TOOL_NAMES = [
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_GET_CONTENT_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SNAPSHOT_TOOL_NAME,
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_TYPE_TOOL_NAME,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_SET_DEVICE_TOOL_NAME
]

test('未知工具名 ⇒ buildSummary 返回空串（不许回显工具名）', () => {
  assert.equal(buildSummary('TotallyUnknownBrowserTool', {}, null, [], t), '')
  assert.equal(buildSummary('BrowserEvaluate', { script: '1+1' }, null, [], t), '')
})

test('未知工具名 ⇒ summary 为空后 primary 会回落到 title（模拟 || 短路）', () => {
  const summary = buildSummary('BrowserEvaluate', {}, null, [], t)
  const title = '工具 · BrowserEvaluate'
  assert.equal(summary || title, title)
})

test('8 个浏览器工具逐个：摘要非空且不含工具名', () => {
  const inputs: Record<string, Record<string, unknown>> = {
    [BROWSER_NAVIGATE_TOOL_NAME]: { action: 'goto', url: 'https://example.com/a' },
    [BROWSER_GET_CONTENT_TOOL_NAME]: {},
    [BROWSER_SCREENSHOT_TOOL_NAME]: {},
    [BROWSER_SNAPSHOT_TOOL_NAME]: {},
    [BROWSER_CLICK_TOOL_NAME]: { selector: '#submit' },
    [BROWSER_TYPE_TOOL_NAME]: { selector: '#name' },
    [BROWSER_SCROLL_TOOL_NAME]: { direction: 'down', amount: 400 },
    [BROWSER_SET_DEVICE_TOOL_NAME]: { device: 'iphone' }
  }
  for (const name of ALL_BROWSER_TOOL_NAMES) {
    const summary = buildSummary(name, inputs[name] ?? {}, null, [], t)
    assert.ok(summary.length > 0, `${name} 摘要为空 —— 主行会回落到 title，但本工具应当有摘要`)
    assert.ok(!summary.includes(name), `${name} 的摘要里出现了裸工具名：${summary}`)
  }
})

test('BrowserSetDevice：pc / iphone / pixel / ipad 各自的中文摘要', () => {
  const fallbackViewport = { width: 390, height: 844 }
  assert.equal(
    buildSummary(BROWSER_SET_DEVICE_TOOL_NAME, { device: 'pc' }, { device: 'pc' }, [], t),
    '桌面形态'
  )
  assert.equal(
    buildSummary(BROWSER_SET_DEVICE_TOOL_NAME, { device: 'iphone' }, { device: 'iphone' }, [], t),
    'iPhone'
  )
  assert.equal(
    buildSummary(BROWSER_SET_DEVICE_TOOL_NAME, { device: 'pixel' }, { device: 'pixel' }, [], t),
    'Pixel'
  )
  assert.equal(
    buildSummary(BROWSER_SET_DEVICE_TOOL_NAME, { device: 'ipad' }, { device: 'ipad' }, [], t),
    'iPad'
  )
  // 面板没挂载时工具返回 viewport:null，用 input 的请求值兜底
  assert.equal(
    buildSummary(
      BROWSER_SET_DEVICE_TOOL_NAME,
      { device: 'custom', ...fallbackViewport },
      { device: 'custom', viewport: null },
      [],
      t
    ),
    '自定义 390 × 844'
  )
})

test('BrowserSetDevice：custom 有真实 viewport 时以生效值为准', () => {
  assert.equal(
    buildSummary(
      BROWSER_SET_DEVICE_TOOL_NAME,
      { device: 'custom', width: 99999, height: 99999 },
      { device: 'custom', viewport: { width: 2560, height: 1440 } },
      [],
      t
    ),
    '自定义 2560 × 1440'
  )
})

test('BrowserSetDevice：未知设备 ⇒ 空串交给 title，不吐裸英文', () => {
  assert.equal(
    buildSummary(BROWSER_SET_DEVICE_TOOL_NAME, { device: 'nokia-3310' }, null, [], t),
    ''
  )
})

test('BrowserSetDevice：结果行有「设备 / 视口」两行', () => {
  const rows = getResultRows(BROWSER_SET_DEVICE_TOOL_NAME, {
    success: true,
    device: 'ipad',
    viewport: { width: 820, height: 1180 }
  })
  assert.deepEqual(
    rows.map((r) => [r.labelKey, r.value]),
    [
      ['toolCall.browser.fields.device', 'ipad'],
      ['toolCall.browser.fields.viewport', '820 × 1180']
    ]
  )
})

test('BrowserSetDevice：viewport 为 null 时只出「设备」一行', () => {
  const rows = getResultRows(BROWSER_SET_DEVICE_TOOL_NAME, {
    success: true,
    device: 'iphone',
    viewport: null
  })
  assert.deepEqual(
    rows.map((r) => r.labelKey),
    ['toolCall.browser.fields.device']
  )
})

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}`)
    console.log(`       ${(error as Error).message}`)
  }
}

console.log(`\n== 汇总 ==\n  ${tests.length - failed}/${tests.length} 通过`)
if (failed > 0) process.exit(1)
