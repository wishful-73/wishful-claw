// Tab slice — extracted from ui-store.ts
// Contains right panel tab management methods to keep ui-store.ts under 500 lines
//
// 所有固定类 tab 的 id 都带会话作用域前缀（`${kind}:${tabScopeId}`）、去重按 id
// 而非 kind，激活项统一经 right-panel-scope.ts 的 helper 写入。范式来自本文件
// 的 ensureSubAgentTab（改造前就是正确形态）。

import type { UIStore } from './ui-store-interface'
import type { RightPanelTabInstance } from './ui-types'
import { useChatStore } from '@renderer/stores/chat-store'
import { ensureRightPanelTabs } from './right-panel-tab-factories'
import {
  activateRightPanelTab,
  resolveRightPanelSessionId,
  rightPanelTabScope,
  rightPanelTabScopeId,
  scopedRightPanelTabId
} from './right-panel-scope'

type SetFn = (partial: Partial<UIStore> | ((state: UIStore) => Partial<UIStore>)) => void
type GetFn = () => UIStore

export function createTabSlice(set: SetFn, get: GetFn) {
  return {
    ensureActivityTab: () =>
      set((state: any) => {
        const sessionId = resolveRightPanelSessionId(state)
        const tabId = scopedRightPanelTabId('activity', sessionId)
        const activation = activateRightPanelTab(state, sessionId, tabId)
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        if (existing) {
          return { ...activation, rightPanelOpen: true }
        }
        const tab: RightPanelTabInstance = {
          id: tabId,
          kind: 'activity',
          title: 'Activity',
          closable: true,
          sessionId,
          createdAt: Date.now()
        }
        return {
          rightPanelTabs: ensureRightPanelTabs([...state.rightPanelTabs, tab]),
          ...activation,
          rightPanelOpen: true
        }
      }),

    ensureSubAgentTab: (toolUseId: any, inlineText: any, title: any, requestedSessionId: any) =>
      set((state: any) => {
        const sessionId = resolveRightPanelSessionId(state, requestedSessionId)
        const tabScopeId = rightPanelTabScopeId(sessionId)
        // Each sub-agent gets its own tab so multiple agents can be inspected
        // side by side; toolUseId=null is the shared list (overview) tab.
        const tabId = toolUseId
          ? `subagent:${tabScopeId}:${toolUseId}`
          : `subagent:${tabScopeId}:overview`
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        const tab: RightPanelTabInstance = existing
          ? {
              ...existing,
              sessionId: sessionId ?? existing.sessionId ?? null,
              title: title?.trim() || existing.title,
              toolUseId: toolUseId ?? null,
              inlineText: inlineText?.trim() ? inlineText : existing.inlineText
            }
          : {
              id: tabId,
              kind: 'subagent',
              title: title?.trim() || 'SubAgents',
              closable: true,
              sessionId,
              toolUseId: toolUseId ?? null,
              inlineText: inlineText?.trim() ? inlineText : null,
              createdAt: Date.now()
            }
        const rightPanelTabs = existing
          ? state.rightPanelTabs.map((item: any) => (item.id === tabId ? tab : item))
          : [...state.rightPanelTabs, tab]
        return {
          rightPanelTabs,
          ...activateRightPanelTab(state, sessionId, tabId),
          rightPanelOpen: true
        }
      }),

    openSubAgentsPanel: (toolUseId: any, sessionId: any) =>
      get().ensureSubAgentTab(toolUseId ?? null, null, null, sessionId),

    // Goal 是 per-session（带 goalId），作用域键必须用会话而不是项目：项目键会让
    // 同项目两个会话共用一张 Goal tab 并互相覆写 goalId。projectId 降级为数据字段。
    openGoalPanel: (
      sessionId?: string | null,
      projectId?: string | null,
      goalId?: string | null
    ) =>
      set((state: any) => {
        const resolvedSessionId = resolveRightPanelSessionId(state, sessionId)
        const session = resolvedSessionId
          ? useChatStore.getState().sessions.find((item) => item.id === resolvedSessionId)
          : null
        const resolvedProjectId = projectId ?? session?.projectId ?? useChatStore.getState().activeProjectId ?? null
        const tabId = scopedRightPanelTabId('goal', resolvedSessionId)
        const activation = activateRightPanelTab(state, resolvedSessionId, tabId)
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        if (existing) {
          const rightPanelTabs = state.rightPanelTabs.map((tab: RightPanelTabInstance) =>
            tab.id === tabId
              ? {
                  ...tab,
                  sessionId: resolvedSessionId ?? tab.sessionId ?? null,
                  projectId: resolvedProjectId ?? tab.projectId ?? null,
                  goalId: goalId ?? tab.goalId ?? null
                }
              : tab
          )
          return { rightPanelTabs, ...activation, rightPanelOpen: true }
        }
        const tab: RightPanelTabInstance = {
          id: tabId,
          kind: 'goal',
          title: 'Goals',
          closable: true,
          sessionId: resolvedSessionId,
          projectId: resolvedProjectId,
          goalId: goalId ?? null,
          createdAt: Date.now()
        }
        const rightPanelTabs = ensureRightPanelTabs([...state.rightPanelTabs, tab])
        return { rightPanelTabs, ...activation, rightPanelOpen: true }
      }),

    ensureTerminalTab: () =>
      set((state: any) => {
        const sessionId = resolveRightPanelSessionId(state)
        const tabId = scopedRightPanelTabId('terminal', sessionId)
        const activation = activateRightPanelTab(state, sessionId, tabId)
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        if (existing) {
          return { ...activation, rightPanelOpen: true }
        }
        const tab: RightPanelTabInstance = {
          id: tabId,
          kind: 'terminal',
          title: 'Terminal',
          closable: true,
          sessionId,
          createdAt: Date.now()
        }
        return {
          rightPanelTabs: ensureRightPanelTabs([...state.rightPanelTabs, tab]),
          ...activation,
          rightPanelOpen: true
        }
      }),

    ensureFilesTab: (sessionId: any) =>
      set((state: any) => {
        const resolvedSessionId = resolveRightPanelSessionId(state, sessionId)
        const tabId = scopedRightPanelTabId('files', resolvedSessionId)
        const activation = activateRightPanelTab(state, resolvedSessionId, tabId)
        // 按 id 命中即同会话，不需要再回写 sessionId（改造前按 kind 命中时
        // 只激活不回写，会让第二个会话永远打不开自己的 files tab）。
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        if (existing) {
          return { ...activation, rightPanelOpen: true }
        }
        const tab: RightPanelTabInstance = {
          id: tabId,
          kind: 'files',
          title: 'Files',
          closable: true,
          createdAt: Date.now(),
          sessionId: resolvedSessionId
        }
        return {
          rightPanelTabs: ensureRightPanelTabs([...state.rightPanelTabs, tab]),
          ...activation,
          rightPanelOpen: true
        }
      }),

    // Context & progress tab — keep the existing summary kind for persisted
    // panel-state compatibility; the session summary is rendered at the bottom.
    ensureSummaryTab: (sessionId: any) =>
      set((state: any) => {
        const resolvedSessionId = resolveRightPanelSessionId(state, sessionId)
        const tabId = scopedRightPanelTabId('summary', resolvedSessionId)
        const activation = activateRightPanelTab(state, resolvedSessionId, tabId)
        const existing = state.rightPanelTabs.find((tab: any) => tab.id === tabId)
        if (existing) {
          return { ...activation, rightPanelOpen: true }
        }
        const tab: RightPanelTabInstance = {
          id: tabId,
          kind: 'summary',
          title: 'Context & progress',
          closable: true,
          createdAt: Date.now(),
          sessionId: resolvedSessionId
        }
        return {
          rightPanelTabs: ensureRightPanelTabs([...state.rightPanelTabs, tab]),
          ...activation,
          rightPanelOpen: true
        }
      }),

    // 批量关闭逐项复用 closeRightPanelTab：preview 类 tab 的关闭走的是双层栈
    // （右栏 tab + previewPanelTabs 同步），在 slice 里另写一套 filter 会让
    // 预览栈留下孤儿。先快照 id 列表再逐项关——每关一个 state 就变了。
    closeOtherRightPanelTabs: (keepTabId: string) => {
      const state = get()
      const kept = state.rightPanelTabs.find((tab) => tab.id === keepTabId)
      const scopeId = kept
        ? rightPanelTabScope(kept)
        : rightPanelTabScopeId(resolveRightPanelSessionId(state))
      const targets = state.rightPanelTabs
        .filter((tab) => tab.id !== keepTabId && rightPanelTabScope(tab) === scopeId)
        .map((tab) => tab.id)
      for (const tabId of targets) get().closeRightPanelTab(tabId)
    },

    closeAllRightPanelTabs: () => {
      const state = get()
      const scopeId = rightPanelTabScopeId(resolveRightPanelSessionId(state))
      const targets = state.rightPanelTabs
        .filter((tab) => rightPanelTabScope(tab) === scopeId)
        .map((tab) => tab.id)
      for (const tabId of targets) get().closeRightPanelTab(tabId)
    },
  }
}
