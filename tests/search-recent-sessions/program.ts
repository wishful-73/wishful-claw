// iter-v3-5 S-297 —— 搜索框「最近会话」派生回归。
//
// 背景：`SearchDialog` 常驻应用壳，原来直订 `useChatStore((s) => s.sessions)`，
// 流式每帧换数组引用 ⇒ 每帧重渲 + 每帧对全部会话 filter/sort/slice。
// S-247 §21.3 实测：dev 下这一处占残量 58%（0.38 → 0.16 MB/s）。
//
// 改成「top-5 签名 + 关闭态直接返回常量」之后，代价变成：
// **签名漏字段 = 最近会话列表显示陈旧数据**（改名不刷新、时间不动，最难查的那类）。
//
// 所以这里钉死两件事：
//   1. 渲染口径：倒序、排除当前会话、limit、同值确定性。
//   2. 签名口径（双向）：top-5 内变了签名必须变；**top-5 之外 churn 签名必须不变**
//      —— 后者就是这次性能修复本身，写错就等于修复白做。
//
// ⚠️ 改了 `recent-sessions.ts` 的签名口径，必须同步改这个文件，否则下次漏字段照样绿。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRecentSessionsSignature,
  selectRecentSessions,
  RECENT_SESSIONS_LIMIT
} from '../../src/renderer/src/components/layout/search-dialog/recent-sessions'
import type { Session } from '../../src/renderer/src/stores/chat-store/types'

/** 只造派生逻辑真正读的字段（id / title / updatedAt），其余无关。 */
function sess(id: string, updatedAt: number, title = `会话-${id}`): Session {
  return { id, title, updatedAt } as unknown as Session
}

/** 10 条，updatedAt 乱序，便于验证「倒序取前 5」。 */
function tenSessions(): Session[] {
  return [
    sess('s3', 300),
    sess('s9', 900),
    sess('s1', 100),
    sess('s7', 700),
    sess('s5', 500),
    sess('s2', 200),
    sess('s10', 1000),
    sess('s4', 400),
    sess('s8', 800),
    sess('s6', 600)
  ]
}

const idsOf = (list: Array<{ id: string }>): string[] => list.map((s) => s.id)

/** 源码守卫要先剥注释：说明性注释里会写出「原来那行」，直接正则匹配会误报。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const cases: Array<[string, () => void]> = [
  [
    '按 updatedAt 倒序取前 5，排除当前会话',
    () => {
      const picked = selectRecentSessions(tenSessions(), 's10')
      assert.deepEqual(idsOf(picked), ['s9', 's8', 's7', 's6', 's5'])
    }
  ],
  [
    'limit 生效（传 2 只出 2 条，且是最新那两条）',
    () => {
      assert.deepEqual(idsOf(selectRecentSessions(tenSessions(), null, 2)), ['s10', 's9'])
    }
  ],
  [
    '默认 limit 就是 RECENT_SESSIONS_LIMIT，不会多给',
    () => {
      assert.equal(RECENT_SESSIONS_LIMIT, 5)
      assert.equal(selectRecentSessions(tenSessions(), null).length, 5)
    }
  ],
  [
    'updatedAt 相同 ⇒ 按 id 升序（顺序确定，不会两帧之间抖）',
    () => {
      const picked = selectRecentSessions([sess('b', 500), sess('a', 500), sess('c', 500)], null)
      assert.deepEqual(idsOf(picked), ['a', 'b', 'c'])
    }
  ],
  [
    '会话数少于 limit ⇒ 全部返回，不补空位',
    () => {
      assert.deepEqual(idsOf(selectRecentSessions([sess('only', 1)], null)), ['only'])
    }
  ],
  [
    '空会话 / 全是当前会话 ⇒ 空列表、空签名',
    () => {
      assert.deepEqual(selectRecentSessions([], null), [])
      assert.deepEqual(selectRecentSessions([sess('a', 1)], 'a'), [])
      assert.equal(buildRecentSessionsSignature([], null), '')
      assert.equal(buildRecentSessionsSignature([sess('a', 1)], 'a'), '')
    }
  ],
  [
    '【性能核心】top-5 之外的会话在流式 churn ⇒ 签名必须不变',
    () => {
      const before = buildRecentSessionsSignature(tenSessions(), 's10')
      const churned = tenSessions().map((s) =>
        s.id === 's1' || s.id === 's2'
          ? ({ ...s, title: `${s.title}-流式中`, updatedAt: s.updatedAt + 1 } as Session)
          : s
      )
      assert.equal(
        buildRecentSessionsSignature(churned, 's10'),
        before,
        'top-5 之外的会话变了，签名跟着变 ⇒ 搜索框每帧重算，S-297 的修复被抵消'
      )
    }
  ],
  [
    'top-5 之外的会话被删掉（top-5 不变）⇒ 签名必须不变',
    () => {
      const before = buildRecentSessionsSignature(tenSessions(), 's10')
      const trimmed = tenSessions().filter((s) => s.id !== 's1' && s.id !== 's2')
      assert.equal(buildRecentSessionsSignature(trimmed, 's10'), before)
    }
  ],
  [
    'top-5 内的 updatedAt 变了 ⇒ 签名必须变（否则列表顺序陈旧）',
    () => {
      const before = buildRecentSessionsSignature(tenSessions(), 's10')
      const changed = tenSessions().map((s) => (s.id === 's5' ? { ...s, updatedAt: 99999 } : s))
      assert.notEqual(buildRecentSessionsSignature(changed, 's10'), before)
    }
  ],
  [
    'top-5 内的 title 变了 ⇒ 签名必须变（否则改名后列表还显示旧标题）',
    () => {
      const before = buildRecentSessionsSignature(tenSessions(), 's10')
      const renamed = tenSessions().map((s) => (s.id === 's9' ? { ...s, title: '改过的标题' } : s))
      assert.notEqual(buildRecentSessionsSignature(renamed, 's10'), before)
    }
  ],
  [
    'activeSessionId 换了 ⇒ 被排除的那条变了，签名必须变',
    () => {
      assert.notEqual(
        buildRecentSessionsSignature(tenSessions(), 's10'),
        buildRecentSessionsSignature(tenSessions(), 's9')
      )
    }
  ],
  [
    'title 里带冒号 / 竖线 / 逗号不会撞车（分隔符是不可打印字符）',
    () => {
      const a = [sess('x', 100, 'a:b|c,d'), sess('y', 200, 'plain')]
      const b = [sess('x', 100, 'a'), sess('y', 200, 'b|c,d:plain')]
      assert.notEqual(buildRecentSessionsSignature(a, null), buildRecentSessionsSignature(b, null))
    }
  ],
  [
    '同值不同对象引用 ⇒ 签名相同（签名字符串不掺引用）',
    () => {
      assert.equal(
        buildRecentSessionsSignature(tenSessions(), 's10'),
        buildRecentSessionsSignature(tenSessions(), 's10')
      )
    }
  ],
  [
    '源码守卫：search-dialog 不许再直订 s.sessions，必须走签名',
    () => {
      const source = stripComments(
        readFileSync(
          join(process.cwd(), 'src/renderer/src/components/layout/search-dialog.tsx'),
          'utf8'
        )
      )
      assert.doesNotMatch(
        source,
        /useChatStore\(\s*\(\s*s\s*\)\s*=>\s*s\.sessions\s*\)/,
        'search-dialog 又直接订了 s.sessions 数组 —— 每帧重算会回来（S-297）'
      )
      assert.match(
        source,
        /buildRecentSessionsSignature\(/,
        'search-dialog 没有用 buildRecentSessionsSignature'
      )
      assert.match(source, /if \(!open\) return/, '关闭态必须直接短路，不算最近会话')
    }
  ]
]

let passed = 0
const failures: string[] = []
for (const [name, fn] of cases) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`  FAIL ${name}`)
    console.error(`       ${(error as Error).message}`)
  }
}

console.log(`\n== 汇总 ==\n  ${passed}/${cases.length} 通过`)
if (failures.length > 0) {
  console.error(`\n失败项：\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
