// 右侧面板 tab 的会话作用域收口。
//
// rightPanelActiveTabIds 是 per-scope map。改造前它的写入面散落在 ui-store /
// ui-store-tab-slice / preview-panel-slice 三处共 20 个落点，逐处手改必漏，
// 漏掉的那一处就是下一次「切会话 tab 串了」的来源。所有写入统一走本文件的
// activateRightPanelTab / closeRightPanelScope，slice 只负责 set 它们返回的 patch。

import type { UIStore } from './ui-store-interface'
import type { RightPanelTabInstance } from './ui-types'
import { useChatStore } from '@renderer/stores/chat-store'

export const GLOBAL_TAB_SCOPE_ID = 'global'

type ScopeState = Pick<UIStore, 'activeScopedSessionId' | 'rightPanelActiveTabIds'>
type ActiveTabPatch = Pick<UIStore, 'rightPanelActiveTabIds'>

/**
 * tab 归属的作用域桶。无会话即全局桶——注意 `'global'` 只用于 id 前缀和 map
 * 键，不得写进 `tab.sessionId` 字段，否则 removeRightPanelTabsForSession 按
 * 字段筛选时会静默漏清。
 */
export function rightPanelTabScopeId(sessionId: string | null | undefined): string {
  return sessionId ?? GLOBAL_TAB_SCOPE_ID
}

export function rightPanelTabScope(tab: RightPanelTabInstance): string {
  return rightPanelTabScopeId(tab.sessionId ?? null)
}

/**
 * 解析写入方该落到哪个会话。`|| null` 这步归一不能省：纯空白串经 `?.trim()`
 * 得到 `''` 而非 nullish，作用域桶会变成空前缀。
 */
export function resolveRightPanelSessionId(
  state: Pick<UIStore, 'activeScopedSessionId'>,
  requestedSessionId?: string | null
): string | null {
  return (
    (requestedSessionId?.trim() || null) ??
    state.activeScopedSessionId ??
    useChatStore.getState().activeSessionId ??
    null
  )
}

export function scopedRightPanelTabId(kind: string, sessionId: string | null): string {
  return `${kind}:${rightPanelTabScopeId(sessionId)}`
}

export function readActiveRightPanelTabId(state: ScopeState, sessionId: string | null): string {
  return state.rightPanelActiveTabIds[rightPanelTabScopeId(sessionId)] ?? ''
}

export function activateRightPanelTab(
  state: ScopeState,
  sessionId: string | null,
  tabId: string
): ActiveTabPatch {
  const scopeId = rightPanelTabScopeId(sessionId)
  if (state.rightPanelActiveTabIds[scopeId] === tabId) {
    return { rightPanelActiveTabIds: state.rightPanelActiveTabIds }
  }
  return { rightPanelActiveTabIds: { ...state.rightPanelActiveTabIds, [scopeId]: tabId } }
}

/**
 * 关掉一个 tab 后重算它所属作用域的激活项：相邻优先（被关闭项的后一项，无后
 * 项取前一项）；作用域内没有 tab 了就摘掉这个键。
 *
 * `tabsBeforeClose` 必须是**关闭前**的完整数组——相邻落位要靠被关闭项的原位置。
 */
export function closeRightPanelScope(
  state: ScopeState,
  sessionId: string | null,
  closedTabId: string,
  tabsBeforeClose: RightPanelTabInstance[]
): ActiveTabPatch {
  const scopeId = rightPanelTabScopeId(sessionId)
  if (state.rightPanelActiveTabIds[scopeId] !== closedTabId) {
    return { rightPanelActiveTabIds: state.rightPanelActiveTabIds }
  }
  const scoped = tabsBeforeClose.filter((tab) => rightPanelTabScope(tab) === scopeId)
  const closedIndex = scoped.findIndex((tab) => tab.id === closedTabId)
  const survivors = scoped.filter((tab) => tab.id !== closedTabId)
  const next = { ...state.rightPanelActiveTabIds }
  if (survivors.length === 0) {
    delete next[scopeId]
  } else {
    next[scopeId] = survivors[Math.min(Math.max(closedIndex, 0), survivors.length - 1)].id
  }
  return { rightPanelActiveTabIds: next }
}

/** 当前作用域是否还有 tab —— 面板收起判据，替代原先的「全局数组为空」。 */
export function hasRightPanelTabsInScope(
  tabs: RightPanelTabInstance[],
  sessionId: string | null
): boolean {
  const scopeId = rightPanelTabScopeId(sessionId)
  return tabs.some((tab) => rightPanelTabScope(tab) === scopeId)
}
