// Browser slice — extracted from ui-store.ts
// Contains browser state management methods to keep ui-store.ts under 500 lines

import type { UIStore } from './ui-store-interface'
import {
  getBrowserScopeKey,
  getBrowserStateFromMap,
  isActiveBrowserScope,
  resolvePanelScope,
  updateBrowserStateForSession
} from './browser-session-helpers'

type SetFn = (partial: Partial<UIStore> | ((state: UIStore) => Partial<UIStore>)) => void
type GetFn = () => UIStore

export function createBrowserSlice(set: SetFn, get: GetFn) {
  return {
    getBrowserState: (sessionId: any, projectId: any) => {
      const state = get()
      const scope = resolvePanelScope(state, sessionId, projectId)
      return getBrowserStateFromMap(
        state.browserStatesBySession,
        scope.sessionId,
        scope.projectId
      )
    },

    patchBrowserState: (sessionId: any, patch: any, projectId: any) =>
      set((state: any) => updateBrowserStateForSession(state, sessionId, patch, projectId)),

    openBrowserTab: (url: any, sessionId: any, projectId: any, options: any) =>
      get().ensureBrowserTab(url, sessionId, projectId, options),

    getBrowserWebviewRef: (sessionId: any, projectId: any) => {
      const state = get()
      const scope = resolvePanelScope(state, sessionId, projectId)
      return state.browserWebviewRefsBySession[getBrowserScopeKey(scope)] ?? null
    },

    setBrowserWebviewRef: (ref: any, sessionId: any, projectId: any) =>
      set((state: any) => {
        const scope = resolvePanelScope(state, sessionId, projectId)
        const key = getBrowserScopeKey(scope)
        const browserWebviewRefsBySession = { ...state.browserWebviewRefsBySession }
        if (ref) {
          browserWebviewRefsBySession[key] = ref
        } else {
          delete browserWebviewRefsBySession[key]
        }
        return {
          browserWebviewRefsBySession,
          ...(isActiveBrowserScope(state, scope) ? { browserWebviewRef: ref } : {})
        }
      }),

    // 设备模式与自定义视口一次写完：分两次 set 会让面板的副作用跑两遍。
    setBrowserDevice: (device: any, sessionId: any, projectId: any) =>
      get().patchBrowserState(
        sessionId,
        { deviceMode: device.mode, customViewport: device.customViewport },
        projectId
      ),

    // 命令式导航：递增序号，让 BrowserPanel 把 committedUrl 同步到新地址。
    // 站内跳转只回写 url、不动序号 —— 那正是「不重载」的前提。
    requestBrowserNavigation: (url: any, sessionId: any, projectId: any) => {
      const state = get()
      const scope = resolvePanelScope(state, sessionId, projectId)
      const current = getBrowserStateFromMap(
        state.browserStatesBySession,
        scope.sessionId,
        scope.projectId
      )
      get().patchBrowserState(
        sessionId,
        { url, navigationSeq: (current.navigationSeq ?? 0) + 1 },
        projectId
      )
    },
  }
}
