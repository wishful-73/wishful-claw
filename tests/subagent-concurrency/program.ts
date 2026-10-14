/**
 * S-191：并发后台子 agent 的卡片状态收敛契约。
 *
 * 这里钉的是**状态机契约**，不是「代码现在返回什么」：
 *  1. 起新一轮（子1 完成 → 唤醒 hook 给空闲主会话 sendMessage）时，
 *     resetLiveSessionExecution 只能清**已经结束**的子 agent；仍在跑 / 排队的兄弟必须
 *     原地保留，且保留集要写回 live 缓存 —— 否则紧随其后的 switchToolCallSession
 *     会从刚被清空的缓存恢复出一个空表，兄弟们的 sub_agent_end 就找不到收敛目标。
 *  2. sub_agent_end 必须幂等：找不到卡片就用事件自带的信息补一条终态记录，绝不静默丢弃。
 *  3. Worker 断连时仍在跑 / 排队的卡片必须收敛为 aborted，不能永挂「工作中」。
 *
 * 三条里任何一条被改回去，表现都是「同时跑多个子 agent，只有一个能正常收尾」——
 * 从现象回溯到 store 很贵，所以在这里钉死。
 */

import type { UnifiedMessage } from '../../src/renderer/src/lib/api/types'
import type { SubAgentEvent } from '../../src/renderer/src/lib/agent/sub-agents/types'

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

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed += 1
  } else {
    failed += 1
    console.error(
      `  FAIL: ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    )
  }
}

function userMessage(toolUseId: string): UnifiedMessage {
  return {
    id: `msg-${toolUseId}`,
    role: 'user',
    content: `run ${toolUseId}`,
    createdAt: 0
  } as UnifiedMessage
}

function startEvent(toolUseId: string, name = 'code-reviewer'): SubAgentEvent {
  return {
    type: 'sub_agent_start',
    subAgentName: name,
    toolUseId,
    input: { description: `task ${toolUseId}`, prompt: `run ${toolUseId}`, background: true },
    promptMessage: userMessage(toolUseId)
  }
}

function queuedEvent(toolUseId: string, name = 'code-reviewer'): SubAgentEvent {
  return {
    type: 'sub_agent_queued',
    subAgentName: name,
    toolUseId,
    input: { description: `task ${toolUseId}`, prompt: `run ${toolUseId}`, background: true }
  }
}

function endEvent(toolUseId: string, name = 'code-reviewer'): SubAgentEvent {
  return {
    type: 'sub_agent_end',
    subAgentName: name,
    toolUseId,
    result: {
      success: true,
      output: `report for ${toolUseId}`,
      reportSubmitted: true,
      toolCallCount: 2,
      iterations: 3,
      endReason: 'completed',
      usage: { inputTokens: 10, outputTokens: 20 }
    }
  }
}

async function main(): Promise<void> {
  // store 的静态依赖链会经 ipc-client / agent-runtime-sync 拿 window.electron，
  // node 下没有；persist 中间件要 localStorage。垫空壳只为让模块图能加载。
  const g = globalThis as typeof globalThis & {
    window: unknown
    localStorage: unknown
  }
  g.window = {
    electron: {
      ipcRenderer: {
        invoke: async () => undefined,
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined
      }
    }
  }
  g.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined
  }

  const { useAgentStore } = await import('../../src/renderer/src/stores/agent-store')

  const resetStore = (liveSessionId: string | null): void => {
    useAgentStore.setState({
      liveSessionId,
      activeSubAgents: {},
      completedSubAgents: {},
      subAgentHistory: [],
      sessionSubAgentLiveCache: {},
      sessionSubAgentSummaries: {},
      sessionToolCallsCache: {}
    })
  }

  // ── 场景 1：并发三个后台子 agent，子1 返回后起新一轮 ──
  // 对应故障现场：唤醒 hook 收到子1 的完成回调 → 给空闲主会话 sendMessage →
  // chat-store 起 run 前调 resetLiveSessionExecution + switchToolCallSession。
  resetStore('s1')
  useAgentStore.getState().handleSubAgentEvent(startEvent('toolu_1'), 's1')
  useAgentStore.getState().handleSubAgentEvent(startEvent('toolu_2'), 's1')
  useAgentStore.getState().handleSubAgentEvent(startEvent('toolu_3'), 's1')
  assert(
    Boolean(useAgentStore.getState().activeSubAgents['toolu_2']?.isRunning),
    '并发三个后台子 agent 全部处于运行中'
  )

  useAgentStore.getState().handleSubAgentEvent(endEvent('toolu_1'), 's1')
  const afterEnd1 = useAgentStore.getState()
  assert(!afterEnd1.activeSubAgents['toolu_1'], '子1 结束后离开 active 表')
  assert(Boolean(afterEnd1.activeSubAgents['toolu_2']?.isRunning), '子1 结束不影响子2 的运行态')

  useAgentStore.getState().resetLiveSessionExecution('s1')
  const afterReset = useAgentStore.getState()
  assert(!afterReset.activeSubAgents['toolu_1'], '起新一轮仍清掉已结束的子1（原语义保持）')
  assert(Boolean(afterReset.activeSubAgents['toolu_2']), '起新一轮不得清掉仍在跑的子2')
  assert(Boolean(afterReset.activeSubAgents['toolu_3']), '起新一轮不得清掉仍在跑的子3')
  assert(
    Boolean(afterReset.sessionSubAgentLiveCache['s1']?.active['toolu_2']),
    'live 缓存里写回的是保留集，而不是空表'
  )

  useAgentStore.getState().switchToolCallSession(null, 's1')
  const afterSwitch = useAgentStore.getState()
  assert(Boolean(afterSwitch.activeSubAgents['toolu_2']), 'switchToolCallSession 恢复保留集而非空表')
  assert(Boolean(afterSwitch.activeSubAgents['toolu_3']), 'switchToolCallSession 恢复保留集（子3）')

  useAgentStore.getState().handleSubAgentEvent(endEvent('toolu_2', 'reviewer-a'), 's1')
  useAgentStore.getState().handleSubAgentEvent(endEvent('toolu_3', 'reviewer-b'), 's1')
  const settled = useAgentStore.getState()
  assertEqual(settled.completedSubAgents['toolu_2']?.endReason, 'completed', '子2 正常收敛')
  assertEqual(settled.completedSubAgents['toolu_3']?.endReason, 'completed', '子3 正常收敛')
  assertEqual(settled.completedSubAgents['toolu_2']?.isRunning, false, '子2 卡片不再停在「工作中」')
  assertEqual(settled.completedSubAgents['toolu_3']?.isRunning, false, '子3 卡片不再停在「工作中」')
  assertEqual(
    settled.subAgentHistory.find((h) => h.toolUseId === 'toolu_3')?.isRunning,
    false,
    '历史快照里的子3 同步收敛'
  )

  // ── 场景 2：终态事件到达时 live map 里没有对应卡片 ──
  // 覆盖「状态被清 / 刷新 / 重连后 activeSubAgents 为空」。
  resetStore('s2')
  useAgentStore.getState().handleSubAgentEvent(endEvent('toolu_9', 'background-reviewer'), 's2')
  const orphan = useAgentStore.getState()
  assertEqual(orphan.completedSubAgents['toolu_9']?.isRunning, false, '无 start 的终态事件不丢弃')
  assertEqual(
    orphan.completedSubAgents['toolu_9']?.name,
    'background-reviewer',
    '用事件自带的子 agent 名补出卡片'
  )
  assertEqual(orphan.completedSubAgents['toolu_9']?.reportStatus, 'submitted', '报告状态取自事件')
  assert(
    Boolean(orphan.subAgentHistory.find((h) => h.toolUseId === 'toolu_9')),
    '补出的终态记录同时落进历史'
  )

  // ── 场景 3：Worker 断连，仍在跑 / 排队的卡片收敛 ──
  resetStore('s3')
  useAgentStore.getState().handleSubAgentEvent(startEvent('c0'), 's3')
  useAgentStore.getState().handleSubAgentEvent(endEvent('c0'), 's3')
  useAgentStore.getState().handleSubAgentEvent(startEvent('c1'), 's3')
  useAgentStore.getState().handleSubAgentEvent(startEvent('c2'), 's3')
  useAgentStore.getState().handleSubAgentEvent(queuedEvent('c3'), 's3')

  useAgentStore.getState().abortOrphanedSubAgents()
  const aborted = useAgentStore.getState()
  assertEqual(aborted.completedSubAgents['c1']?.endReason, 'aborted', '运行中的卡片收敛为 aborted')
  assertEqual(aborted.completedSubAgents['c2']?.endReason, 'aborted', '运行中的卡片收敛为 aborted（子2）')
  assertEqual(aborted.completedSubAgents['c3']?.endReason, 'aborted', '排队中的卡片同样收敛')
  assertEqual(aborted.completedSubAgents['c1']?.isRunning, false, '收敛后不再显示「工作中」')
  assert(!aborted.activeSubAgents['c1'], '收敛后离开 active 表')
  assert(!aborted.activeSubAgents['c3'], '排队项收敛后也离开 active 表')
  assertEqual(aborted.completedSubAgents['c0']?.endReason, 'completed', '已正常结束的卡片不被改写')

  console.log(`subagent-concurrency: ${passed} 断言通过, ${failed} 失败`)
  // 依赖图里有常驻定时器（ipc 重连 / runtime-sync 看门狗），不显式退出会吊住事件循环。
  process.exit(failed > 0 ? 1 : 0)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
