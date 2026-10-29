/*
 * S-225 回归：聊天窗渲染详细度三档的派生矩阵。
 *
 * 这里只测纯函数。组件侧的「切档立即生效」靠 `use-density-override` 的条件表达式
 * （override.density !== 当前档位 ⇒ 回落到 derive()），那部分没法在 node 里跑，
 * 但矩阵本身必须钉死 —— 改一个 true 会直接改变线上观感，没有回归网太危险。
 *
 * 其中「compact 必须与 1.0.1 旧行为等价」那一组是硬约束：老用户升级后不该察觉
 * 任何变化，所以把旧公式逐条抄进来对拍。
 */

import assert from 'node:assert/strict'
import {
  CHAT_RENDER_DENSITIES,
  DEFAULT_CHAT_RENDER_DENSITY,
  deriveFileChangeCollapsed,
  deriveSubAgentExpanded,
  deriveThinkingCollapsed,
  deriveToolOutputOpen,
  deriveToolRunCollapsed,
  deriveProcessRenderForm,
  getDensityPolicy,
  isChatRenderDensity,
  normalizeChatRenderDensity,
  shouldPinOutsideCollapsedRun,
  shouldRenderToolAsLine
} from '../../src/renderer/src/components/chat/render-density'

const tests: Array<[string, () => void]> = []

function test(name: string, run: () => void): void {
  tests.push([name, run])
}

test('三档顺序与默认档固定', () => {
  assert.deepEqual([...CHAT_RENDER_DENSITIES], ['text', 'compact', 'detail'])
  assert.equal(DEFAULT_CHAT_RENDER_DENSITY, 'compact')
})

test('normalizeChatRenderDensity 把来路不明的值压回 compact', () => {
  assert.equal(normalizeChatRenderDensity('text'), 'text')
  assert.equal(normalizeChatRenderDensity('compact'), 'compact')
  assert.equal(normalizeChatRenderDensity('detail'), 'detail')
  for (const bad of [undefined, null, '', 'quiet', 'verbose', 0, 3, {}, []]) {
    assert.equal(normalizeChatRenderDensity(bad), 'compact')
  }
  assert.equal(isChatRenderDensity('detail'), true)
  assert.equal(isChatRenderDensity('everything'), false)
})

test('三档矩阵逐字段快照', () => {
  assert.deepEqual(getDensityPolicy('text'), {
    runCollapseWhileActive: true,
    runCollapseWhenDone: true,
    toolOutputOpen: false,
    thinkingOpenWhileActive: false,
    thinkingCollapseWhenDone: true,
    subAgentOpenWhileActive: false,
    subAgentCollapseWhenDone: true,
    fileChangeOpen: false
  })
  assert.deepEqual(getDensityPolicy('compact'), {
    runCollapseWhileActive: false,
    runCollapseWhenDone: true,
    toolOutputOpen: false,
    thinkingOpenWhileActive: true,
    thinkingCollapseWhenDone: true,
    subAgentOpenWhileActive: true,
    subAgentCollapseWhenDone: true,
    fileChangeOpen: false
  })
  assert.deepEqual(getDensityPolicy('detail'), {
    runCollapseWhileActive: false,
    runCollapseWhenDone: false,
    toolOutputOpen: true,
    thinkingOpenWhileActive: true,
    thinkingCollapseWhenDone: false,
    subAgentOpenWhileActive: true,
    subAgentCollapseWhenDone: false,
    fileChangeOpen: true
  })
})

test('工具 run：没有可折叠的 ordinary 项时恒不折叠', () => {
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(deriveToolRunCollapsed(density, 0, 0), false, density)
    assert.equal(deriveToolRunCollapsed(density, 0, 1), false, density)
  }
})

test('工具 run：三档 × 执行中/已结束', () => {
  // 纯文本：执行中也收
  assert.equal(deriveToolRunCollapsed('text', 2, 1), true)
  assert.equal(deriveToolRunCollapsed('text', 2, 0), true)
  // 紧凑：执行中摊开、结束收起
  assert.equal(deriveToolRunCollapsed('compact', 2, 1), false)
  assert.equal(deriveToolRunCollapsed('compact', 2, 0), true)
  // 详情：全程摊开
  assert.equal(deriveToolRunCollapsed('detail', 2, 1), false)
  assert.equal(deriveToolRunCollapsed('detail', 2, 0), false)
})

test('思考块：三档 × 进行中/已结束/无内容', () => {
  // 纯文本：执行中也收
  assert.equal(deriveThinkingCollapsed('text', true, true), true)
  assert.equal(deriveThinkingCollapsed('text', false, true), true)
  // 紧凑：执行中展开、结束收起
  assert.equal(deriveThinkingCollapsed('compact', true, true), false)
  assert.equal(deriveThinkingCollapsed('compact', false, true), true)
  // 详情：全程展开
  assert.equal(deriveThinkingCollapsed('detail', true, true), false)
  assert.equal(deriveThinkingCollapsed('detail', false, true), false)
  // 没有思考内容时恒不折叠（组件此时本就返回 null）
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(deriveThinkingCollapsed(density, true, false), false, density)
    assert.equal(deriveThinkingCollapsed(density, false, false), false, density)
  }
})

test('子 Agent：后台项三档一律收起', () => {
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(deriveSubAgentExpanded(density, true, true), false, density)
    assert.equal(deriveSubAgentExpanded(density, false, true), false, density)
  }
})

test('子 Agent：前台项三档 × 进行中/已结束', () => {
  assert.equal(deriveSubAgentExpanded('text', true, false), false)
  assert.equal(deriveSubAgentExpanded('text', false, false), false)
  assert.equal(deriveSubAgentExpanded('compact', true, false), true)
  assert.equal(deriveSubAgentExpanded('compact', false, false), false)
  assert.equal(deriveSubAgentExpanded('detail', true, false), true)
  assert.equal(deriveSubAgentExpanded('detail', false, false), true)
})

test('工具卡输出：错误 / 待审批三档强制展开（安全底线）', () => {
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(
      deriveToolOutputOpen(density, {
        forceOpen: true,
        hasVisualOutput: false,
        isLiveCommand: false
      }),
      true,
      density
    )
  }
})

test('工具卡输出：可视输出与流式命令三档保持展开', () => {
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(
      deriveToolOutputOpen(density, {
        forceOpen: false,
        hasVisualOutput: true,
        isLiveCommand: false
      }),
      true,
      density
    )
    assert.equal(
      deriveToolOutputOpen(density, {
        forceOpen: false,
        hasVisualOutput: false,
        isLiveCommand: true
      }),
      true,
      density
    )
  }
})

test('工具卡输出：普通输出按档位', () => {
  const plain = { forceOpen: false, hasVisualOutput: false, isLiveCommand: false }
  assert.equal(deriveToolOutputOpen('text', plain), false)
  assert.equal(deriveToolOutputOpen('compact', plain), false)
  assert.equal(deriveToolOutputOpen('detail', plain), true)
})

test('文件变更卡：错误 / 待审批恒展开，其余按档位', () => {
  for (const density of CHAT_RENDER_DENSITIES) {
    assert.equal(deriveFileChangeCollapsed(density, true), false, density)
  }
  assert.equal(deriveFileChangeCollapsed('text', false), true)
  assert.equal(deriveFileChangeCollapsed('compact', false), true)
  assert.equal(deriveFileChangeCollapsed('detail', false), false)
})

test('折叠态下 force 项提到面板外，ordinary 项不外提', () => {
  assert.equal(shouldPinOutsideCollapsedRun(true, 'force'), true)
  assert.equal(shouldPinOutsideCollapsedRun(true, 'ordinary'), false)
  assert.equal(shouldPinOutsideCollapsedRun(false, 'force'), false)
  assert.equal(shouldPinOutsideCollapsedRun(false, 'ordinary'), false)
})

test('compact 档必须与 1.0.1 旧行为逐条等价', () => {
  // 旧：run.defaultCollapsed = ordinary > 0 && active == 0
  for (const ordinary of [0, 1, 3]) {
    for (const active of [0, 1, 2]) {
      const legacy = ordinary > 0 && active === 0
      assert.equal(deriveToolRunCollapsed('compact', ordinary, active), legacy, `${ordinary}/${active}`)
    }
  }
  // 旧：thinking defaultCollapsed = !isThinking && hasContent
  for (const isThinking of [true, false]) {
    for (const hasContent of [true, false]) {
      const legacy = !isThinking && hasContent
      assert.equal(deriveThinkingCollapsed('compact', isThinking, hasContent), legacy)
    }
  }
  // 旧：子 Agent 初始展开 !isBackground，跑完自动折叠
  assert.equal(deriveSubAgentExpanded('compact', true, false), true)
  assert.equal(deriveSubAgentExpanded('compact', false, false), false)
  assert.equal(deriveSubAgentExpanded('compact', true, true), false)
  assert.equal(deriveSubAgentExpanded('compact', false, true), false)
  // 旧：文件变更卡 collapsed = !forceOpen
  assert.equal(deriveFileChangeCollapsed('compact', true), false)
  assert.equal(deriveFileChangeCollapsed('compact', false), true)
  // 旧：工具卡 open = forceOpen || isLiveCommand || hasVisualOutput
  for (const forceOpen of [true, false]) {
    for (const hasVisualOutput of [true, false]) {
      for (const isLiveCommand of [true, false]) {
        const legacy = forceOpen || isLiveCommand || hasVisualOutput
        assert.equal(
          deriveToolOutputOpen('compact', { forceOpen, hasVisualOutput, isLiveCommand }),
          legacy,
          `${forceOpen}/${hasVisualOutput}/${isLiveCommand}`
        )
      }
    }
  }
})

// ── S-248：形态轴（card / line） ──

test('只有 text 档换形态，compact / detail 一个像素不动', () => {
  assert.equal(deriveProcessRenderForm('text'), 'line')
  assert.equal(deriveProcessRenderForm('compact'), 'card')
  assert.equal(deriveProcessRenderForm('detail'), 'card')
})

test('text 档：普通工具降级成行', () => {
  for (const name of ['Read', 'Edit', 'Write', 'Bash', 'PowerShell', 'Grep', 'Glob', 'mcp__x__y']) {
    assert.equal(
      shouldRenderToolAsLine({
        density: 'text',
        toolName: name,
        status: 'completed',
        requiresApproval: false,
        hasVisualResult: false,
        keepAsCardToolNames: new Set<string>()
      }),
      true,
      name
    )
  }
})

test('compact / detail 档一律不降级', () => {
  for (const density of ['compact', 'detail'] as const) {
    assert.equal(
      shouldRenderToolAsLine({
        density,
        toolName: 'Read',
        status: 'completed',
        requiresApproval: false,
        hasVisualResult: false,
        keepAsCardToolNames: new Set<string>()
      }),
      false,
      density
    )
  }
})

test('text 档也不降级：交互类 / 输出即结果 / 待审批', () => {
  const keep = new Set(['AskUserQuestion', 'SubmitPlanReview', 'create_goal'])
  // 交互类 —— 一行字点不了
  for (const name of keep) {
    assert.equal(
      shouldRenderToolAsLine({
        density: 'text',
        toolName: name,
        status: 'completed',
        requiresApproval: false,
        hasVisualResult: false,
        keepAsCardToolNames: keep
      }),
      false,
      name
    )
  }
  // 输出即结果 —— 藏起来等于没做
  assert.equal(
    shouldRenderToolAsLine({
      density: 'text',
      toolName: 'Read',
      status: 'completed',
      requiresApproval: false,
      hasVisualResult: true,
      keepAsCardToolNames: keep
    }),
    false
  )
  // 待审批 —— 安全底线，不能只剩一行字
  assert.equal(
    shouldRenderToolAsLine({
      density: 'text',
      toolName: 'Bash',
      status: 'pending_approval',
      requiresApproval: true,
      hasVisualResult: false,
      keepAsCardToolNames: keep
    }),
    false
  )
  assert.equal(
    shouldRenderToolAsLine({
      density: 'text',
      toolName: 'Bash',
      status: 'running',
      requiresApproval: true,
      hasVisualResult: false,
      keepAsCardToolNames: keep
    }),
    false
  )
})

test('text 档错误照样降级（错误靠红字表达，不靠浮出卡片）', () => {
  assert.equal(
    shouldRenderToolAsLine({
      density: 'text',
      toolName: 'Edit',
      status: 'error',
      requiresApproval: false,
      hasVisualResult: false,
      keepAsCardToolNames: new Set<string>()
    }),
    true
  )
})

function main(): void {  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }
  console.log(`Render density tests passed: ${tests.length}`)
}

main()
