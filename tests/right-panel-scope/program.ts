/*
 * `isRightPanelScopeActive` — S-259 的判据。
 *
 * 为什么单独钉这一个函数：内置浏览器的每会话进程早就各自独立（RightPanel 把
 * 所有 scope 的 webview 都挂着，只切 opacity/z-index），真正缺的是「谁来掀开
 * 面板」这一判断。后台会话执行浏览器工具时 `openBrowserTab` 无条件把
 * rightPanelOpen 置 true，于是用户面前的面板被掀开——而内容层按 scope 过滤，
 * 当前 scope 里没有那个 tab，看到的就是一片空白。
 *
 * 判据收口在 `isRightPanelScopeActive` 一处（browser-native-ui / team register /
 * team-native-ui / ui-store 各调一次），所以这里只要守住它，四个调用点都不会
 * 长回同一个 bug。chat-store 被 stub：真实模块拉 IPC 与数据库层，Electron 外
 * 跑不起来（见 ./stubs/）。
 */

import assert from 'node:assert/strict'
import {
  GLOBAL_TAB_SCOPE_ID,
  hasRightPanelTabsInScope,
  isRightPanelScopeActive,
  rightPanelTabScopeId,
  resolveRightPanelSessionId
} from '../../src/renderer/src/stores/right-panel-scope'
import type { RightPanelTabInstance } from '../../src/renderer/src/stores/ui-types'
import { __setChatState } from './stubs/chat-store'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

/** 造一个只有作用域相关字段的 tab，其余字段被测代码不碰。 */
function tab(id: string, sessionId: string | null): RightPanelTabInstance {
  return { id, kind: 'browser', sessionId } as unknown as RightPanelTabInstance
}

function reset(): void {
  __setChatState({ activeSessionId: null })
}

// ── ① 作用域桶归一 ───────────────────────────────────────────────────────────
{
  reset()
  eq(rightPanelTabScopeId(null), GLOBAL_TAB_SCOPE_ID, 'null session falls into the global bucket')
  eq(rightPanelTabScopeId(undefined), GLOBAL_TAB_SCOPE_ID, 'undefined session falls into the global bucket')
  eq(rightPanelTabScopeId('s1'), 's1', 'a real session id is its own bucket')
  // 空串不在这里归一 —— 由 resolveRightPanelSessionId 的 `?.trim() || null` 前置处理。
  eq(rightPanelTabScopeId(''), '', 'the bucket helper itself does not trim (normalisation is upstream)')
}

// ── ② 前台会话自己开面板 → 允许 ──────────────────────────────────────────────
{
  reset()
  check(isRightPanelScopeActive({ activeScopedSessionId: 'A' }, 'A'), 'foreground session may open the panel')
}

// ── ③ 后台会话想开面板 → 拒绝（S-259 本尊）──────────────────────────────────
{
  reset()
  check(
    !isRightPanelScopeActive({ activeScopedSessionId: 'A' }, 'B'),
    'a background session must not open the panel the user is looking at'
  )
}

// ── ④ 没有归属信息的调用按前台处理 ──────────────────────────────────────────
{
  reset()
  check(
    isRightPanelScopeActive({ activeScopedSessionId: 'A' }, null),
    'a call without a session id is treated as foreground (explicit open beats silent failure)'
  )
  check(
    isRightPanelScopeActive({ activeScopedSessionId: 'A' }, undefined),
    'an omitted session id is treated as foreground'
  )
  check(
    isRightPanelScopeActive({ activeScopedSessionId: 'A' }, '   '),
    'a whitespace-only session id normalises to the current scope, not to the global bucket'
  )
}

// ── ⑤ 全局作用域（无会话）───────────────────────────────────────────────────
{
  reset()
  check(isRightPanelScopeActive({ activeScopedSessionId: null }, null), 'in the global scope, a global call passes')
  check(
    !isRightPanelScopeActive({ activeScopedSessionId: null }, 'B'),
    'in the global scope, a session call is not the scope the user is looking at'
  )
}

// ── ⑥ 回落链：state 拿不到时才读 chatStore ──────────────────────────────────
{
  reset()
  __setChatState({ activeSessionId: 'B' })
  eq(resolveRightPanelSessionId({ activeScopedSessionId: null }, 'B'), 'B', 'requested id wins over the fallback chain')
  check(
    isRightPanelScopeActive({ activeScopedSessionId: null }, 'B'),
    'chat-store activeSessionId is the last resort for the current scope'
  )
  check(
    !isRightPanelScopeActive({ activeScopedSessionId: null }, 'A'),
    'a session other than the chat-store active one is still background'
  )
  reset()
  eq(resolveRightPanelSessionId({ activeScopedSessionId: null }, null), null, 'no session anywhere resolves to null')
}

// ── ⑦ 面板收起判据按作用域过滤 ──────────────────────────────────────────────
{
  reset()
  const tabs = [tab('t1', 'A'), tab('t2', 'B'), tab('t3', null)]
  check(hasRightPanelTabsInScope(tabs, 'A'), 'scope A has a tab')
  check(hasRightPanelTabsInScope(tabs, 'B'), 'scope B has a tab')
  check(hasRightPanelTabsInScope(tabs, null), 'the global scope has a tab')
  check(!hasRightPanelTabsInScope(tabs, 'C'), 'scope C has none — its panel must stay collapsed')
}

console.log(`right-panel-scope: ${checks} checks passed`)
