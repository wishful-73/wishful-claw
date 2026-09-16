// S-40 (iter-30) — 免费对话页的选项卡规则。
//
// 页面的核心诉求是「切换选项卡不能重载页面」（否则登录态与页面状态都会丢），
// 因此 webview 常驻、只有开关选项卡才增删。这里锁住增删与激活的规则，
// 顺便锁住「持久化内容不可信」——恢复时要能吞掉旧版本残留和已删站点的脏 id。

import assert from 'node:assert/strict'
import {
  closeFreeChatTab,
  openFreeChatTab,
  reconcileFreeChatTabs,
  restoreFreeChatTabs,
  type FreeChatTabs
} from '../../src/renderer/src/components/free-chat/free-chat-tabs'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, message)
}

function tabs(openIds: string[], activeId: string): FreeChatTabs {
  return { openIds, activeId }
}

// ── 打开 ───────────────────────────────────────────────────────────────────

{
  eq(
    openFreeChatTab(tabs([], ''), 'a'),
    tabs(['a'], 'a'),
    '空状态下打开一个站点：它成为唯一选项卡并激活'
  )
  eq(
    openFreeChatTab(tabs(['a'], 'a'), 'b'),
    tabs(['a', 'b'], 'b'),
    '追加新站点到末尾并激活它'
  )
  eq(
    openFreeChatTab(tabs(['a', 'b'], 'a'), 'b'),
    tabs(['a', 'b'], 'b'),
    '打开已存在的站点只切换激活，不重复追加'
  )
}

{
  const state = tabs(['a'], 'a')
  check(openFreeChatTab(state, 'a') === state, '重复打开当前站点应返回原对象（避免无谓重渲染）')
  check(openFreeChatTab(state, '') === state, '空 id 应被忽略')
}

// ── 关闭 ───────────────────────────────────────────────────────────────────

{
  eq(
    closeFreeChatTab(tabs(['a', 'b', 'c'], 'b'), 'b'),
    tabs(['a', 'c'], 'c'),
    '关掉当前选项卡：顶替成它右边那个'
  )
  eq(
    closeFreeChatTab(tabs(['a', 'b', 'c'], 'c'), 'c'),
    tabs(['a', 'b'], 'b'),
    '关掉最右的当前选项卡：顶替成左边的'
  )
  eq(
    closeFreeChatTab(tabs(['a', 'b', 'c'], 'a'), 'a'),
    tabs(['b', 'c'], 'b'),
    '关掉最左的当前选项卡：顶替成右边的'
  )
  eq(
    closeFreeChatTab(tabs(['a'], 'a'), 'a'),
    tabs([], ''),
    '关掉最后一个选项卡：激活位归空串'
  )
  eq(
    closeFreeChatTab(tabs(['a', 'b'], 'a'), 'b'),
    tabs(['a'], 'a'),
    '关掉非当前选项卡：当前激活位不变'
  )
}

{
  const state = tabs(['a'], 'a')
  check(closeFreeChatTab(state, 'nope') === state, '关闭不存在的选项卡应返回原对象')
}

// ── 站点清单变化后收敛 ─────────────────────────────────────────────────────

{
  eq(
    reconcileFreeChatTabs(tabs(['a', 'b', 'c'], 'b'), ['a', 'c']),
    tabs(['a', 'c'], 'c'),
    '站点被删：其选项卡消失，当前若正是它则就近顶替（与手动关闭同规则）'
  )
  eq(
    reconcileFreeChatTabs(tabs(['a', 'b'], 'a'), ['a', 'b', 'c']),
    tabs(['a', 'b'], 'a'),
    '新增站点不应擅自打开选项卡（只多一个按钮）'
  )
  eq(
    reconcileFreeChatTabs(tabs(['a'], 'a'), []),
    tabs([], ''),
    '站点全被清空：选项卡也全清'
  )
}

{
  const state = tabs(['a', 'b'], 'b')
  check(reconcileFreeChatTabs(state, ['a', 'b']) === state, '无变化时应返回原对象')
}

// ── 恢复（持久化内容不可信）────────────────────────────────────────────────

{
  eq(
    restoreFreeChatTabs(['a', 'b'], 'b', ['a', 'b', 'c']),
    tabs(['a', 'b'], 'b'),
    '正常恢复：保持顺序与当前选项卡'
  )
  eq(
    restoreFreeChatTabs(['a', 'gone', 'b'], 'gone', ['a', 'b']),
    tabs(['a', 'b'], 'a'),
    '已删站点的脏 id 被剔除；当前选项卡失效时回落第一个'
  )
  eq(
    restoreFreeChatTabs(['a', 'a', 'b'], 'a', ['a', 'b']),
    tabs(['a', 'b'], 'a'),
    '重复 id 去重'
  )
  eq(restoreFreeChatTabs(undefined, undefined, ['a', 'b']), tabs([], ''), '无持久化值：空状态')
  eq(restoreFreeChatTabs('a,b', 42, ['a', 'b']), tabs([], ''), '非数组输入：当作空')
  eq(
    restoreFreeChatTabs([1, null, 'a'], 'a', ['a']),
    tabs(['a'], 'a'),
    '数组里的非字符串项被忽略'
  )
  eq(
    restoreFreeChatTabs(['a'], 'not-open', ['a', 'b']),
    tabs(['a'], 'a'),
    '当前选项卡不在打开列表里：回落第一个'
  )
}

console.log(`free-chat-tabs: ${checks} 项断言通过`)
