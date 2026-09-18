/**
 * 后台子 agent 唤醒消息的格式契约。
 *
 * 这些断言不是「代码现在输出什么」，而是**生产端与消费端之间的约定**：唤醒 hook 用
 * buildBackgroundWakeMessage 构造，MessageItem 的 AgentWakeNotification 用正则解析前缀。
 * 任何一侧改了形状，这里必须先炸 —— 否则表现是消息又变回用户气泡，很难往这里查。
 */

import type { UnifiedMessage } from '@renderer/lib/api/types'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`  FAIL: ${label}`)
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    passed += 1
  } else {
    failed += 1
    console.error(
      `  FAIL: ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    )
  }
}

function userMessage(content: unknown): UnifiedMessage {
  return { id: 'm1', role: 'user', content, createdAt: 0 } as UnifiedMessage
}

async function main(): Promise<void> {
  // 静态依赖链会经 context-compression 拉进 Electron IPC client，node 下没有 window。
  // 照 tests/renderable-chat-items 的做法垫一个空壳，只为让模块图能加载。
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async () => undefined,
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined
      }
    }
  }

  const {
    buildBackgroundWakeMessage,
    isBackgroundWakeMessage,
    resolveBackgroundWakeTitle,
    stripBackgroundWakeTrailer,
    extractWorkerReportAgentName
  } = await import('@renderer/lib/agent/sub-agents/background-wake-message')

  // ── 构造 ──
  const built = buildBackgroundWakeMessage('code-reviewer', '## Findings\nall good')
  assert(
    built.startsWith('[Background sub-agent code-reviewer]:\n'),
    '前缀在行首且以换行结束'
  )
  assert(built.includes('## Findings'), '报告正文保留')
  assert(
    built.trimEnd().endsWith('如有需要可向用户总结结果。'),
    '尾部指令仍在（模型靠它知道该继续干活）'
  )

  // 名字异常时兜底，保证前缀永远可解析 —— 解析不出名字卡片就退化成通用标题。
  assert(
    buildBackgroundWakeMessage('   ', 'x').startsWith('[Background sub-agent sub-agent]:'),
    '空白名字用兜底名'
  )
  assert(
    buildBackgroundWakeMessage('  reviewer  ', 'x').startsWith('[Background sub-agent reviewer]:'),
    '名字两端去空格'
  )

  // ── 跨模块契约：渲染端的解析正则 ──
  // 与 MessageItem.tsx 的 AgentWakeNotification 保持一致。
  const rendererPattern = /^\[Background sub-agent (.+?)\]:\n?/
  assertEqual(rendererPattern.exec(built)?.[1], 'code-reviewer', '渲染端正则解析出名字')

  // ── 识别 ──
  assert(isBackgroundWakeMessage(userMessage(built)), '构造出来的消息被识别')
  assert(isBackgroundWakeMessage(userMessage(built)), 'content 是块数组时识别')
  assert(isBackgroundWakeMessage(userMessage('[Background sub-agent x]: 无换行')), '前缀无换行也识别')
  assert(!isBackgroundWakeMessage(userMessage('帮我看看这个文件')), '普通用户消息不识别')
  assert(!isBackgroundWakeMessage(userMessage('[系统] 你好')), '其它方括号开头不识别')
  assert(!isBackgroundWakeMessage(userMessage('background sub-agent x')), '缺方括号不识别')
  assert(!isBackgroundWakeMessage(null), 'null 不识别')
  assert(!isBackgroundWakeMessage(undefined), 'undefined 不识别')
  assert(
    !isBackgroundWakeMessage({ ...userMessage(built), role: 'assistant' } as UnifiedMessage),
    'role 不是 user 不识别'
  )

  // content 是纯字符串（非块数组）时也要识别 —— 落库读回的两条路都走得到这里。
  const asString = { id: 'm2', role: 'user', content: built, createdAt: 0 } as UnifiedMessage
  assert(isBackgroundWakeMessage(asString), 'content 为字符串时也识别')

  // ── 显示用剥离 ──
  // 调用方（MessageItem）传进来的是**已去掉前缀**的 body，所以这里也按 body 测。
  const prefixLength = '[Background sub-agent code-reviewer]:\n'.length
  const wakeBody = built.slice(prefixLength)
  assert(wakeBody.startsWith('## Findings\nall good'), '剥离前缀后正文完整')
  assertEqual(stripBackgroundWakeTrailer(wakeBody), '## Findings\nall good', '剥掉尾部指令还原纯正文')
  assertEqual(stripBackgroundWakeTrailer('just text'), 'just text', '没有尾部指令时原样返回')
  assertEqual(stripBackgroundWakeTrailer(''), '', '空串返回空串')

  // 误伤保护：该句出现在中间（报告正文自己提到）时不能剥。
  const midSentence = '正文\n如有需要可向用户总结结果。\n还有后续内容'
  assertEqual(stripBackgroundWakeTrailer(midSentence), midSentence, '该句不在结尾时不剥')

  // ── Worker 信封取名字 ──
  const envelope = [
    '[Background Sub-Agent Completed]',
    '  ID: wc_bg_complete_toolu_1',
    '  Agent: code-reviewer',
    '  Description: review the diff',
    '  Tool calls: 3',
    '  Iterations: 12',
    '',
    'Report:',
    'body'
  ].join('\n')
  assertEqual(extractWorkerReportAgentName(envelope), 'code-reviewer', '从 Worker 信封取名字')
  assertEqual(
    extractWorkerReportAgentName(envelope.replace('code-reviewer', 'code reviewer')),
    'code reviewer',
    '名字含空格也完整取到'
  )
  assertEqual(extractWorkerReportAgentName('没有信封'), '', '取不到时返回空串')
  assertEqual(extractWorkerReportAgentName(''), '', '空输入返回空串')

  // 行首锚定：Description 里提到 "Agent: xxx" 不能抢走匹配。
  const tricky = ['  Description: mentions Agent: decoy', '  Agent: real-name'].join('\n')
  assertEqual(extractWorkerReportAgentName(tricky), 'real-name', '行首锚定，不被 Description 干扰')

  // ── 卡片标题：口径与右侧面板 SubAgentsPanel 的子 agent tab 一致（任务描述优先）──
  assertEqual(resolveBackgroundWakeTitle(envelope, 'custom'), 'review the diff', '描述优先于名字')
  assertEqual(resolveBackgroundWakeTitle('没有信封', 'custom'), 'custom', '取不到描述时回落名字')
  assertEqual(
    resolveBackgroundWakeTitle(
      ['[Background Sub-Agent Completed]', '  Description:   ', '  Agent: custom'].join('\n'),
      'custom'
    ),
    'custom',
    '描述为空时回落名字'
  )
  // 报告正文里若恰好也有 "Description:"，不能抢走信封里那条。
  const decoy = [
    '[Background Sub-Agent Completed]',
    '  Description: real task',
    '',
    'Report:',
    'Description: decoy in body'
  ].join('\n')
  assertEqual(resolveBackgroundWakeTitle(decoy, 'x'), 'real task', '取信封里那条，不被正文抢')

  console.log(`background-wake-message: ${passed} assertions passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
