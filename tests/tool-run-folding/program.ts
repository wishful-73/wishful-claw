/*
 * S-271 回归：失败的工具调用必须留在折叠块里。
 *
 * 老大的现场是「连续工具调用折成一个块，中间某次失败就单独跳出来」，
 * 他以为偶发。实际是 S-225 §8 的口径（hasError ⇒ attention ⇒ force ⇒ 渲染在面板外）
 * 加上三处判据不同步叠出来的。这里钉死改动后的行为：
 *
 *   1. 失败项归类仍走「按工具名」的 ordinary 通道 —— 不再被 hasError 抢走；
 *   2. 失败信号改由 run.failedCount 承载，折叠头据此出徽章；
 *   3. 「用户此刻必须做点什么」的两类（待审批 / 需要批准）仍然露在面板外；
 *   4. 卡片型工具（子 agent / 生成图 / 桌面截图 / 交互类）仍然露在面板外；
 *   5. 失败与取消表现一致，不再按工具种类分流；
 *   6. 三档渲染档位下 run 结构一致（失败不许因换档而改变是否折叠进去）。
 *
 * 纯函数测试：只喂 blocks + toolResults，不碰 React。
 */

import assert from 'node:assert/strict'
import type { ContentBlock } from '../../src/renderer/src/lib/api/types'
import type { ToolResultContent } from '../../src/renderer/src/lib/api/types'
import {
  buildToolExecutionOutline,
  INTERACTIVE_TOOL_NAMES,
  type ToolExecutionOutline
} from '../../src/renderer/src/components/chat/execution-outline'
import { TASK_TOOL_NAME } from '../../src/renderer/src/lib/agent/sub-agents/create-tool'
import { IMAGE_GENERATE_TOOL_NAME, DESKTOP_SCREENSHOT_TOOL_NAME } from '../../src/renderer/src/lib/app-plugin/types'
import {
  deriveProcessRenderForm,
  shouldPinOutsideCollapsedRun
} from '../../src/renderer/src/components/chat/render-density'
import type { ChatRenderDensity } from '../../src/renderer/src/stores/settings-store-types'

const tests: Array<[string, () => void]> = []
function test(name: string, run: () => void): void {
  tests.push([name, run])
}

/** 只用到 defaultValue 的极简 t —— 真实 i18n 由 i18n-coverage 套件看管。 */
const t = ((key: string, opts?: Record<string, unknown>) => {
  const dflt = opts?.defaultValue
  return typeof dflt === 'string' ? dflt : key
}) as never

type ToolUseBlock = Extract<ContentBlock, { type: 'tool_use' }>

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id, name, input } as ToolUseBlock
}

function okOutput(text = 'ok'): { content: ToolResultContent; isError?: boolean } {
  return { content: [{ type: 'text', text }] as unknown as ToolResultContent }
}

function errOutput(text = 'File not found'): { content: ToolResultContent; isError?: boolean } {
  return {
    content: [{ type: 'text', text }] as unknown as ToolResultContent,
    isError: true
  }
}

interface BuildArgs {
  blocks: ToolUseBlock[]
  results?: Map<string, { content: ToolResultContent; isError?: boolean }>
  density?: ChatRenderDensity
  liveToolCallMap?: Map<string, never>
}

function build({ blocks, results, density = 'compact', liveToolCallMap }: BuildArgs): ToolExecutionOutline {
  return buildToolExecutionOutline({
    blocks: blocks as unknown as ContentBlock[],
    isStreaming: false,
    toolResults: results,
    liveToolCallMap,
    boundaryAfterBlockIndices: undefined,
    boundaryAfterToolUseIds: undefined,
    hiddenToolUseIds: undefined,
    density,
    t
  })
}

/** 与 `tool-block-renderer.tsx` 的 PROCESS_LINE_CARD_ONLY_TOOL_NAMES 同构（那边是 .tsx，拖 React，不能直接 import）。 */
const CARD_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...INTERACTIVE_TOOL_NAMES,
  TASK_TOOL_NAME,
  IMAGE_GENERATE_TOOL_NAME,
  'visualize_show_widget',
  DESKTOP_SCREENSHOT_TOOL_NAME
])

/** 「这个 item 会不会被拎到折叠面板外」—— 与 content-renderer 的 pinnedTools 同一条判据。 */
function pinsOutOfCollapsedRun(
  outline: ToolExecutionOutline,
  toolUseId: string,
  density: ChatRenderDensity
): boolean {
  const item = outline.itemByToolUseId.get(toolUseId)
  if (!item) throw new Error('item not found: ' + toolUseId)
  const form = deriveProcessRenderForm(density)
  // 纯文本档只浮出「存在形式就是卡片」的工具，其余留在面板里当红行。
  return (
    shouldPinOutsideCollapsedRun(true, item.visibility) &&
    (form === 'card' ||
      CARD_ONLY_TOOL_NAMES.has(item.name) ||
      item.category === 'desktop' ||
      item.category === 'interactive')
  )
}

// ── 判据 1：连续调用不断裂 ──

test('连续 5 次 Read、第 3 次失败 ⇒ 仍是一个 run，failedCount 为 1', () => {
  const blocks = [
    toolUse('t1', 'Read', { file_path: 'a.txt' }),
    toolUse('t2', 'Read', { file_path: 'b.txt' }),
    toolUse('t3', 'Read', { file_path: 'missing.txt' }),
    toolUse('t4', 'Read', { file_path: 'c.txt' }),
    toolUse('t5', 'Read', { file_path: 'd.txt' })
  ]
  const results = new Map([
    ['t1', okOutput()],
    ['t2', okOutput()],
    ['t3', errOutput()],
    ['t4', okOutput()],
    ['t5', okOutput()]
  ])
  const outline = build({ blocks, results })

  assert.equal(outline.runs.length, 1, '5 次连续调用只能有一个 run')
  const run = outline.runs[0]
  assert.equal(run.totalItemCount, 5)
  assert.equal(run.failedCount, 1)
  assert.deepEqual(run.forceVisibleItemIds, [], '失败项不许进 force 列表')
  assert.equal(run.showToggle, true, '有 ordinary 项就该能折叠')
})

test('失败的 Read 本身仍是 ordinary —— 不再被 hasError 抢成 attention', () => {
  const outline = build({
    blocks: [toolUse('t1', 'Read', { file_path: 'x' }), toolUse('t2', 'Read', { file_path: 'y' })],
    results: new Map([['t1', okOutput()], ['t2', errOutput()]])
  })
  const failed = outline.itemByToolUseId.get('t2')
  assert.equal(failed?.hasError, true, '错误态本身要保留')
  assert.equal(failed?.status, 'error')
  assert.equal(failed?.category, 'context', '归类按工具名走，不按成败')
  assert.equal(failed?.visibility, 'ordinary')
})

// ── 判据 2：失败有信号，但不再多出一张卡 ──

test('折叠态下失败项不 pin 出去（这才是老大要的「正常折叠进去」）', () => {
  for (const density of ['text', 'compact', 'detail'] as ChatRenderDensity[]) {
    const outline = build({
      blocks: [
        toolUse('t1', 'Edit', { file_path: 'a' }),
        toolUse('t2', 'Edit', { file_path: 'b' }),
        toolUse('t3', 'Edit', { file_path: 'c' })
      ],
      results: new Map([['t1', okOutput()], ['t2', errOutput()], ['t3', okOutput()]]),
      density
    })
    assert.equal(pinsOutOfCollapsedRun(outline, 't2', density), false, density)
    assert.equal(outline.runs[0].failedCount, 1, density)
  }
})

test('全成功的 run 不显示失败徽章（failedCount 为 0）', () => {
  const outline = build({
    blocks: [toolUse('t1', 'Read'), toolUse('t2', 'Read')],
    results: new Map([['t1', okOutput()], ['t2', okOutput()]])
  })
  assert.equal(outline.runs[0].failedCount, 0)
})

test('纯文本结构化失败（success:false）也计入 failedCount', () => {
  const outline = build({
    blocks: [toolUse('t1', 'Read'), toolUse('t2', 'Read')],
    results: new Map([
      ['t1', okOutput()],
      ['t2', { content: [{ type: 'text', text: '{"success":false,"error":"boom"}' }] as unknown as ToolResultContent }]
    ])
  })
  assert.equal(outline.runs[0].failedCount, 1)
})

test('hidden 的失败项不计入 failedCount（用户本来也看不见）', () => {
  const outline = buildToolExecutionOutline({
    blocks: [
      toolUse('t1', 'Read'),
      toolUse('t2', 'Grep')
    ] as unknown as ContentBlock[],
    isStreaming: false,
    toolResults: new Map([
      ['t1', okOutput()],
      ['t2', errOutput()]
    ]),
    hiddenToolUseIds: new Set(['t2']),
    density: 'compact',
    t
  })
  assert.equal(outline.itemByToolUseId.get('t2')?.visibility, 'hidden')
  assert.equal(outline.runs[0].failedCount, 0)
})

// ── 判据 4：真交互不许藏 ──

test('待审批 / 需要批准仍然 pin 在折叠外', () => {
  const outline = build({
    blocks: [
      toolUse('t1', 'Read'),
      toolUse('t2', 'Bash', { command: 'rm -rf /' }),
      toolUse('t3', 'Read')
    ],
    results: new Map([['t1', okOutput()], ['t3', okOutput()]]),
    liveToolCallMap: new Map([
      ['t2', { status: 'pending_approval', requiresApproval: true } as never]
    ])
  })
  const pending = outline.itemByToolUseId.get('t2')
  assert.equal(pending?.category, 'attention')
  assert.equal(pending?.visibility, 'force')
  assert.equal(pinsOutOfCollapsedRun(outline, 't2', 'compact'), true)
})

test('交互类工具（答题 / 计划审批）仍然 pin', () => {
  const outline = build({
    blocks: [toolUse('t1', 'Read'), toolUse('t2', 'AskUserQuestion'), toolUse('t3', 'Read')],
    results: new Map([['t1', okOutput()], ['t3', okOutput()]])
  })
  const ask = outline.itemByToolUseId.get('t2')
  assert.equal(ask?.visibility, 'force')
  assert.equal(pinsOutOfCollapsedRun(outline, 't2', 'compact'), true)
})

// ── 判据 5：卡片型工具照旧 ──

test('子 agent / 生成图 / 桌面截图仍是 force', () => {
  const cases: Array<[string, string]> = [
    ['Task', 't2'],
    ['ImageGenerate', 't3'],
    ['DesktopScreenshot', 't4']
  ]
  const outline = build({
    blocks: [
      toolUse('t1', 'Read'),
      toolUse('t2', 'Task', { prompt: 'x' }),
      toolUse('t3', 'ImageGenerate', { prompt: 'x' }),
      toolUse('t4', 'DesktopScreenshot'),
      toolUse('t5', 'Read')
    ],
    results: new Map([['t1', okOutput()], ['t5', okOutput()]])
  })
  for (const [name, id] of cases) {
    const item = outline.itemByToolUseId.get(id)
    assert.equal(item?.visibility, 'force', name)
  }
})

// ── 判据 6：失败与取消一致 ──

test('白名单工具：失败与取消归类相同（都留在折叠里）', () => {
  const failedOutline = build({
    blocks: [toolUse('t1', 'Bash', { command: 'npm test' })],
    results: new Map([['t1', errOutput()]])
  })
  const canceledOutline = build({
    blocks: [toolUse('t1', 'Bash', { command: 'npm test' })],
    liveToolCallMap: new Map([['t1', { status: 'canceled' } as never]])
  })
  const failed = failedOutline.itemByToolUseId.get('t1')
  const canceled = canceledOutline.itemByToolUseId.get('t1')
  assert.equal(failed?.category, 'command')
  assert.equal(canceled?.category, 'command')
  assert.equal(failed?.visibility, 'ordinary')
  assert.equal(canceled?.visibility, 'ordinary')
})

// ── 判据 3 / 7：换档不改变「是否折进去」 ──

test('三档 render form 下 run 结构一致：失败改变的是徽章，不是折叠归属', () => {
  const blocks = [
    toolUse('t1', 'Read'),
    toolUse('t2', 'Read'),
    toolUse('t3', 'Read')
  ]
  const results = new Map([['t1', okOutput()], ['t2', errOutput()], ['t3', okOutput()]])
  const snapshots = (['text', 'compact', 'detail'] as ChatRenderDensity[]).map((density) => {
    const outline = build({ blocks, results, density })
    return {
      runs: outline.runs.length,
      total: outline.runs[0].totalItemCount,
      failed: outline.runs[0].failedCount,
      force: outline.runs[0].forceVisibleItemIds.length,
      pinned: ['t1', 't2', 't3'].map((id) => pinsOutOfCollapsedRun(outline, id, density))
    }
  })
  for (const snap of snapshots) {
    assert.deepEqual(snap, { runs: 1, total: 3, failed: 1, force: 0, pinned: [false, false, false] })
  }
})

test('普通成功的 run 也不 pin（回归：别把 force 判据改松）', () => {
  const outline = build({
    blocks: [toolUse('t1', 'Read'), toolUse('t2', 'Read')],
    results: new Map([['t1', okOutput()], ['t2', okOutput()]])
  })
  assert.equal(pinsOutOfCollapsedRun(outline, 't1', 'compact'), false)
})

function main(): void {
  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }
  console.log(`Tool run folding tests passed: ${tests.length}`)
}

main()
