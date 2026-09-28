/*
 * 终端选项卡的生命周期（iter-36 S-154）。
 *
 * 存在理由：agent 起的终端（Terminal 工具的常驻 PTY）进程一死，渲染端只把 tab 状态改成
 * `exited` / `error`，tab 本身留着 —— 跑几轮下来用户看到一排点了没反应的死选项卡。
 *
 * 这一套钉死三件事：
 *   ① 哪些 tab 退出即关 —— 只有 `local-agent`；用户自开的 `local` 与 SSH 观察窗 `ssh-agent` 不动
 *      （它们的输出用户可能还要看）；
 *   ② 删 tab 之后选谁 —— 与 closeTab 原来内联的那段逐字一致：关掉的正是选中项才重挑
 *      （取剩余列表最后一项，空了则为 null），否则选中项原样不动；
 *   ③ 某会话还剩几个 tab —— 归零是「顺手收起停靠栏」的唯一触发条件。**这条不能漏**：空停靠栏
 *      会自动新建一个终端，只删 tab 不收栏会让用户看到「死 tab 消失 → 冒出个全新空白终端」。
 */

import assert from 'node:assert/strict'
import {
  AUTO_CLOSE_ON_EXIT_KINDS,
  countTabsForSession,
  removeTabAndPickActive,
  shouldCloseTabOnExit,
  type TerminalTabKind
} from '../../src/renderer/src/stores/terminal-tab-lifecycle'

let checks = 0

function check(condition: unknown, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function eq(actual: unknown, expected: unknown, description: string): void {
  checks += 1
  assert.strictEqual(actual, expected, description)
}

// ── ① 退出即关的判据 ────────────────────────────────────────────────────────

check(shouldCloseTabOnExit('local-agent'), 'agent 起的终端：退出即关')
check(!shouldCloseTabOnExit('local'), '用户自己开的终端：退出后保留（还要看输出）')
check(!shouldCloseTabOnExit('ssh-agent'), 'SSH 观察窗：不参与（它根本不接 terminal:exit）')
eq(AUTO_CLOSE_ON_EXIT_KINDS.size, 1, '集合里只有 local-agent 一项')
eq(Array.from(AUTO_CLOSE_ON_EXIT_KINDS)[0], 'local-agent', '集合内容就是 local-agent')

const allKinds: TerminalTabKind[] = ['local', 'local-agent', 'ssh-agent']
eq(
  allKinds.filter((kind) => shouldCloseTabOnExit(kind)).length,
  1,
  '三种 tab 类型里恰好只有一种会被自动关掉'
)

// ── ② 删 tab 之后的选中项 ──────────────────────────────────────────────────

const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

const closedActive = removeTabAndPickActive(tabs, 'c', 'c')
eq(closedActive.tabs.length, 2, '删掉一个后剩两个')
eq(closedActive.activeTabId, 'b', '删掉当前选中项时，顶上来的取剩余列表最后一项')

const closedInactive = removeTabAndPickActive(tabs, 'a', 'c')
eq(closedInactive.activeTabId, 'c', '删掉的不是选中项时，选中项原样不动')

const closedLast = removeTabAndPickActive([{ id: 'only' }], 'only', 'only')
eq(closedLast.tabs.length, 0, '删光了就是空列表')
eq(closedLast.activeTabId, null, '空列表时选中项归 null')

const closedMiddle = removeTabAndPickActive(tabs, 'b', 'c')
eq(
  closedMiddle.tabs.map((tab) => tab.id).join(','),
  'a,c',
  '只摘掉目标那一项，其余顺序不变'
)

const untouched = removeTabAndPickActive(tabs, 'missing', 'b')
eq(untouched.tabs.length, 3, '删一个不存在的 id：列表不动（同 closeTab 的旧行为）')
eq(untouched.activeTabId, 'b', '删一个不存在的 id：选中项不动')

// 入参不可变：renderer 的 set() 拿到的是新数组，旧引用不该被就地改
const source: { id: string }[] = [{ id: 'x' }, { id: 'y' }]
const derived = removeTabAndPickActive(source, 'x', 'y')
eq(source.length, 2, '原数组不被就地修改')
check(derived.tabs !== source, '返回的是新数组（引用不同）')

// ── ③ 某会话还剩几个 tab ──────────────────────────────────────────────────

const mixed = [
  { id: 't1', sessionId: 's1' },
  { id: 't2', sessionId: 's2' },
  { id: 't3', sessionId: 's1' },
  { id: 't4', sessionId: null },
  { id: 't5' }
]

eq(countTabsForSession(mixed, 's1'), 2, 's1 名下两个 tab')
eq(countTabsForSession(mixed, 's2'), 1, 's2 名下一个 tab')
eq(countTabsForSession(mixed, 's3'), 0, '不存在的会话：0（= 该收停靠栏了）')
eq(countTabsForSession(mixed, null), 0, 'null 会话：0（无从判归属，不能瞎收）')
eq(countTabsForSession(mixed, undefined), 0, 'undefined 会话：0（同上）')
eq(countTabsForSession([], 's1'), 0, '空列表：0')

// 核心契约：摘掉某会话最后一个 agent tab 后计数归零 ⇒ renderer 收起该会话停靠栏；
// 若该会话还有别的 tab，就绝不能收（用户开着别的东西）。
const beforeClose = [
  { id: 'ag1', kind: 'local-agent' as const, sessionId: 's1' },
  { id: 'u1', kind: 'local' as const, sessionId: 's1' }
]
eq(countTabsForSession(beforeClose, 's1'), 2, '同会话下 agent tab + 用户 tab 各一个')
const afterCloseWithSibling = removeTabAndPickActive(beforeClose, 'ag1', 'ag1')
eq(
  countTabsForSession(afterCloseWithSibling.tabs, 's1'),
  1,
  '还有用户自己的 tab ⇒ 不归零 ⇒ 停靠栏不收'
)

const onlyAgent = [{ id: 'ag2', kind: 'local-agent' as const, sessionId: 's1' }]
const afterCloseAlone = removeTabAndPickActive(onlyAgent, 'ag2', 'ag2')
eq(
  countTabsForSession(afterCloseAlone.tabs, 's1'),
  0,
  'agent tab 是该会话最后一个 ⇒ 归零 ⇒ 停靠栏收起'
)

console.log(`terminal tab lifecycle checks passed: ${checks}`)
