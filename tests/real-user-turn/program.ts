// iter-v3-4 S-276 —— 「最近 N 轮」把压缩摘要卡当成用户轮。
//
// 病症（dev 库实测）：会话 141 条消息全在库里，但首次加载只取最近 5 轮，而最后
// 5 个 role='user' 全是压缩摘要卡 —— 窗口里 10 条消息、5 张卡、**真实用户消息 0 条**，
// 打开会话满屏「任务暂告一段落」。
//
// 判据拆成两半，两半都得钉：
//   1. `isRealUserTurn` —— 单条消息是不是「真实用户轮」；
//   2. `trimMessagesToRecentTurns` —— 切片之后，真实消息有没有真的留在窗口里。
//      只测 1 的话，判据对了但切片起点算错仍然看不到人话，S-276 白修。
//
// worker 侧同口径是 DbMessageToolsQueries.cs 的 RealUserTurnPredicate（SQL 常量），
// 跨语言共用不了函数，那边由 C# 侧测试钉。

import assert from 'node:assert/strict'
import { isRealUserTurn } from '../../src/renderer/src/lib/agent/context-compression-display'
import { trimMessagesToRecentTurns } from '../../src/renderer/src/lib/agent/turn-window'
import type { TurnCountableMessage } from '../../src/renderer/src/lib/agent/turn-window'

/** 老会话摘要卡的正文前缀（取自 LEGACY_SUMMARY_PREFIXES，这里只取一个代表）。 */
const LEGACY_PREFIX = '[Context Memory Compressed Summary]'

function user(text: string, extra: Partial<TurnCountableMessage> = {}): TurnCountableMessage {
  return { role: 'user', content: text, ...extra }
}

/** 压缩摘要卡：role 是 'user'，靠 meta.compactSummary 区分。 */
function summaryCard(body = '<compaction-summary>摘要</compaction-summary>'): TurnCountableMessage {
  return { role: 'user', content: body, meta: { compactSummary: {} } }
}

function assistant(text: string): TurnCountableMessage {
  return { role: 'assistant', content: text }
}

/** 压缩边界：role 是 'system'、内容为空 —— 本来就不该被当成用户轮。 */
function boundary(): TurnCountableMessage {
  return { role: 'system', content: '', meta: { compactBoundary: {} } }
}

const cases: Array<[string, () => void]> = [
  [
    'isRealUserTurn：真实用户消息算一轮',
    () => {
      assert.equal(isRealUserTurn(user('帮我改一下这个文件')), true)
    }
  ],
  [
    'isRealUserTurn：带 meta.compactSummary 的摘要卡不算',
    () => {
      assert.equal(isRealUserTurn(summaryCard()), false)
    }
  ],
  [
    'isRealUserTurn：老会话摘要卡（无 meta，只有正文前缀）也不算',
    () => {
      assert.equal(isRealUserTurn(user(`${LEGACY_PREFIX}\n早前的对话已被压缩，摘要如下：…`)), false)
    }
  ],
  [
    'isRealUserTurn：assistant / system 一律不算',
    () => {
      assert.equal(isRealUserTurn(assistant('好的')), false)
      assert.equal(isRealUserTurn(boundary()), false)
    }
  ],
  [
    'isRealUserTurn：正文为空但 role=user 仍算真实轮（用户可能只发了张图）',
    () => {
      assert.equal(isRealUserTurn({ role: 'user' }), true)
      assert.equal(isRealUserTurn({ role: 'user', content: '' }), true)
    }
  ],
  [
    'S-276 主症：尾部 5 张摘要卡不能把真实消息挤出 turns=5 窗口',
    () => {
      // 复刻 dev 库最后 8 条 role='user' 的真实分布：
      //   真实 / 摘要 / 摘要 / 摘要 / 摘要 / 摘要（前 2 条摘要属于更早的轮）
      const history: TurnCountableMessage[] = []
      for (let turn = 1; turn <= 6; turn += 1) {
        history.push(user(`第 ${turn} 轮用户消息`))
        history.push(assistant(`第 ${turn} 轮回复`))
        if (turn >= 2) history.push(summaryCard(), boundary())
      }
      // 末尾再压 3 次（真实用户一句话都不说，纯压缩）
      history.push(summaryCard(), boundary(), summaryCard(), boundary(), summaryCard(), boundary())

      const trimmed = trimMessagesToRecentTurns(history, 5)
      const realUsers = trimmed.messages.filter((m) => isRealUserTurn(m))
      assert.equal(realUsers.length, 5, '窗口里必须凑够 5 轮真实用户消息')
      assert.equal(
        (realUsers[0] as { content?: unknown }).content,
        '第 2 轮用户消息',
        '窗口起点应落在倒数第 5 条真实用户消息上'
      )
      assert.equal(trimmed.removed, history.indexOf(realUsers[0] as TurnCountableMessage))
    }
  ],
  [
    '摘要卡本身不被过滤：仍在切片里，用户看得见「任务暂告一段落」',
    () => {
      const history: TurnCountableMessage[] = [
        user('第一轮'),
        assistant('回复一'),
        summaryCard(),
        boundary(),
        user('第二轮'),
        assistant('回复二')
      ]
      const trimmed = trimMessagesToRecentTurns(history, 2)
      assert.equal(trimmed.removed, 0, '两轮真实用户消息，不该裁')
      assert.equal(trimmed.messages.length, history.length, '摘要卡不能被顺手删掉')
      assert.equal(
        trimmed.messages.filter((m) => m.meta?.compactSummary).length,
        1,
        '摘要卡不能被顺手删掉'
      )
      assert.equal(trimmed.messages.filter((m) => !isRealUserTurn(m)).length, 4)
    }
  ],
  [
    '只有 1 轮真实用户消息 + 一堆卡：不足 maxTurns，原样返回（不能把窗口清空）',
    () => {
      const history: TurnCountableMessage[] = [
        user('唯一的一轮'),
        assistant('回复'),
        summaryCard(),
        boundary(),
        summaryCard(),
        boundary()
      ]
      const trimmed = trimMessagesToRecentTurns(history, 5)
      assert.equal(trimmed.removed, 0)
      assert.equal(trimmed.messages.length, history.length)
    }
  ],
  [
    '起点恰是第 0 条：removed 报 0，避免「加载更早」游标被顶到 0 以外',
    () => {
      const history: TurnCountableMessage[] = [user('一'), assistant('a'), user('二'), assistant('b')]
      const trimmed = trimMessagesToRecentTurns(history, 2)
      assert.equal(trimmed.removed, 0)
      assert.equal(trimmed.messages, history)
    }
  ],
  [
    '空会话 / 全是卡：不炸，原样返回',
    () => {
      assert.deepEqual(trimMessagesToRecentTurns([], 5), { messages: [], removed: 0 })
      const cards: TurnCountableMessage[] = [summaryCard(), boundary()]
      const trimmed = trimMessagesToRecentTurns(cards, 5)
      assert.equal(trimmed.removed, 0)
      assert.equal(trimmed.messages.length, 2)
    }
  ]
]

function main(): void {
  let checks = 0
  for (const [name, run] of cases) {
    run()
    checks += 1
    console.log(`PASS: ${name}`)
  }
  console.log(`real-user-turn: ${checks} cases passed`)
}

main()
