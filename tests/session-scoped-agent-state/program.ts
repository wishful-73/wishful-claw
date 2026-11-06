/*
 * S-350 回归：`selectSessionScopedAgentState` 的缓存契约。
 *
 * 这个选择器被丢进 `useAgentStore(selector)`，zustand 用 `Object.is` 比对返回值。
 * 每次调用造新对象 ⇒ 订阅方无限重渲染（就是老大反复骂的「聊几轮内存上 G、列表卡死」）。
 * 守这条线的只有 CacheEntry 里那 6 个 `===`，一个都不能写错，所以这里逐个钉。
 *
 * 纯数据 + 纯函数，不碰 DOM / Electron。
 */

import assert from 'node:assert/strict'

import {
  findSubAgentInSelection,
  resetSessionScopedAgentStateCache,
  selectSessionScopedAgentState
} from '../../src/renderer/src/lib/agent/session-scoped-agent-state'
import type { AgentStore } from '../../src/renderer/src/stores/agent-store/types'
import type { ToolCallState } from '../../src/renderer/src/lib/agent/types'

const tests: Array<[string, () => void]> = []

function test(name: string, run: () => void): void {
  tests.push([name, run])
}

type SubAgent = Record<string, unknown>

function subAgent(sessionId: string, toolUseId: string): SubAgent {
  return { sessionId, toolUseId, name: `agent-${toolUseId}`, status: 'completed' }
}

function toolCall(id: string, status: string): ToolCallState {
  return { id, name: 'Edit', status, input: {} } as unknown as ToolCallState
}

/** 造一个只带本选择器会读的字段的最小 store。 */
function makeStore(overrides: Record<string, unknown> = {}): AgentStore {
  return {
    activeSubAgents: {},
    completedSubAgents: {},
    subAgentHistory: [],
    runningSessions: {},
    liveSessionId: null,
    pendingToolCalls: [],
    executedToolCalls: [],
    sessionToolCallsCache: {},
    ...overrides
  } as unknown as AgentStore
}

// 每个用例都从干净缓存起手：缓存是模块级单例，串味会让断言假通过。
function fresh<T>(run: () => T): T {
  resetSessionScopedAgentStateCache()
  return run()
}

test('sessionId 为空 ⇒ 返回同一个 EMPTY_SELECTION 引用', () => {
  fresh(() => {
    const store = makeStore()
    const a = selectSessionScopedAgentState(store, null)
    const b = selectSessionScopedAgentState(store, undefined)
    assert.strictEqual(a, b, '空会话必须返回同一个共享常量，否则每次都是新引用')
    assert.equal(a.hasOrchestrationData, false)
    assert.equal(a.signature, 'empty')
  })
})

test('两个会话的 sub-agent 各自可见，不互相串味', () => {
  fresh(() => {
    const store = makeStore({
      activeSubAgents: {
        t1: subAgent('session-a', 't1'),
        t2: subAgent('session-b', 't2')
      }
    })
    const a = selectSessionScopedAgentState(store, 'session-a')
    const b = selectSessionScopedAgentState(store, 'session-b')
    assert.deepEqual(Object.keys(a.activeSubAgents), ['t1'])
    assert.deepEqual(Object.keys(b.activeSubAgents), ['t2'])
    assert.equal(a.hasOrchestrationData, true)
    assert.equal(b.hasOrchestrationData, true)
  })
})

test('同 state 连调两次 ⇒ 返回同一对象引用（缓存命中）', () => {
  fresh(() => {
    const store = makeStore({ activeSubAgents: { t1: subAgent('session-a', 't1') } })
    const a = selectSessionScopedAgentState(store, 'session-a')
    const b = selectSessionScopedAgentState(store, 'session-a')
    assert.strictEqual(a, b, '源引用没变就必须返回同一引用，否则 zustand 无限重渲染')
  })
})

test('只换 activeSubAgents 的引用 ⇒ 缓存失效，返回新对象', () => {
  fresh(() => {
    const first = makeStore({ activeSubAgents: { t1: subAgent('session-a', 't1') } })
    const a = selectSessionScopedAgentState(first, 'session-a')
    // 内容完全相同、只是新对象 —— 这正是 immer copy-on-write 的产物形态
    const second = makeStore({ activeSubAgents: { t1: subAgent('session-a', 't1') } })
    const b = selectSessionScopedAgentState(second, 'session-a')
    assert.notStrictEqual(a, b, '引用变了必须重算，不能靠内容猜')
    assert.deepEqual(Object.keys(b.activeSubAgents), ['t1'])
  })
})

test('只换 runningSessions[sessionId] ⇒ 缓存失效，isSessionRunning 跟着变', () => {
  fresh(() => {
    const running = makeStore({
      activeSubAgents: { t1: subAgent('session-a', 't1') },
      runningSessions: { 'session-a': 'running' }
    })
    const a = selectSessionScopedAgentState(running, 'session-a')
    assert.equal(a.isSessionRunning, true)

    const done = makeStore({
      activeSubAgents: { t1: subAgent('session-a', 't1') },
      runningSessions: { 'session-a': 'completed' }
    })
    const b = selectSessionScopedAgentState(done, 'session-a')
    assert.notStrictEqual(a, b)
    assert.equal(b.isSessionRunning, false)
  })
})

test('retrying 也算运行中', () => {
  fresh(() => {
    const store = makeStore({ runningSessions: { 'session-a': 'retrying' } })
    assert.equal(selectSessionScopedAgentState(store, 'session-a').isSessionRunning, true)
  })
})

test('liveSessionId 命中 ⇒ 取顶层 toolCalls；否则取会话缓存', () => {
  fresh(() => {
    const live = makeStore({
      liveSessionId: 'session-a',
      pendingToolCalls: [toolCall('p1', 'running')],
      executedToolCalls: [toolCall('e1', 'completed')]
    })
    const a = selectSessionScopedAgentState(live, 'session-a')
    assert.deepEqual(a.toolCalls.map((c) => c.id), ['e1', 'p1'], '顺序是 executed 在前、pending 在后')
    assert.equal(a.hasActiveToolCallOutput, true, 'pending 里有 running ⇒ 算正在输出')

    const cached = makeStore({
      liveSessionId: 'session-a',
      sessionToolCallsCache: {
        'session-b': { pending: [toolCall('b1', 'streaming')], executed: [] }
      }
    })
    const b = selectSessionScopedAgentState(cached, 'session-b')
    assert.deepEqual(b.toolCalls.map((c) => c.id), ['b1'])
    assert.equal(b.hasActiveToolCallOutput, true)
  })
})

test('会话既不是 live 也没有缓存桶 ⇒ toolCalls 是共享空数组', () => {
  fresh(() => {
    const store = makeStore({ liveSessionId: 'session-a' })
    const a = selectSessionScopedAgentState(store, 'session-b')
    assert.deepEqual(a.toolCalls, [])
    assert.strictEqual(a.toolCalls, selectSessionScopedAgentState(store, 'session-c').toolCalls)
  })
})

test('会话数超过上限 32 ⇒ 缓存整表清空后仍返回正确值', () => {
  fresh(() => {
    const store = makeStore({
      activeSubAgents: Object.fromEntries(
        Array.from({ length: 40 }, (_v, i) => [`t${i}`, subAgent(`s${i}`, `t${i}`)])
      )
    })
    for (let i = 0; i < 40; i += 1) {
      const sel = selectSessionScopedAgentState(store, `s${i}`)
      assert.deepEqual(Object.keys(sel.activeSubAgents), [`t${i}`], `会话 s${i} 的视图错了`)
    }
    // 清表之后旧会话重新进缓存，值必须一致（不能残留旧对象）
    const again = selectSessionScopedAgentState(store, 's0')
    assert.deepEqual(Object.keys(again.activeSubAgents), ['t0'])
  })
})

test('findSubAgentInSelection：活 → 死 → 历史，找不到返回 null', () => {
  fresh(() => {
    const store = makeStore({
      activeSubAgents: { t1: subAgent('session-a', 't1') },
      completedSubAgents: { t2: subAgent('session-a', 't2') },
      subAgentHistory: [subAgent('session-a', 't3')] as never
    })
    const sel = selectSessionScopedAgentState(store, 'session-a')
    assert.equal(findSubAgentInSelection(sel, 't1')?.toolUseId, 't1')
    assert.equal(findSubAgentInSelection(sel, 't2')?.toolUseId, 't2')
    assert.equal(findSubAgentInSelection(sel, 't3')?.toolUseId, 't3')
    assert.equal(findSubAgentInSelection(sel, 'nope'), null)
    assert.equal(findSubAgentInSelection(null, 't1'), null)
    assert.equal(findSubAgentInSelection(sel, null), null)
  })
})

test('resetSessionScopedAgentStateCache ⇒ 下次调用返回新引用（缓存真被清）', () => {
  fresh(() => {
    const store = makeStore({ activeSubAgents: { t1: subAgent('session-a', 't1') } })
    const a = selectSessionScopedAgentState(store, 'session-a')
    resetSessionScopedAgentStateCache()
    const b = selectSessionScopedAgentState(store, 'session-a')
    assert.notStrictEqual(a, b, '清了缓存还返回同一引用，说明 reset 是空操作')
    assert.deepEqual(Object.keys(b.activeSubAgents), ['t1'])
  })
})

test('signature 只在计数/运行状态变化时变（用于下游粗比对）', () => {
  fresh(() => {
    const one = selectSessionScopedAgentState(
      makeStore({ activeSubAgents: { t1: subAgent('session-a', 't1') } }),
      'session-a'
    )
    assert.equal(one.signature, 'a1/c0/h0/idle')
    const two = selectSessionScopedAgentState(
      makeStore({
        activeSubAgents: { t1: subAgent('session-a', 't1'), t2: subAgent('session-a', 't2') },
        runningSessions: { 'session-a': 'running' }
      }),
      'session-a'
    )
    assert.equal(two.signature, 'a2/c0/h0/running')
  })
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
