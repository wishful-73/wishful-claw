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
import { GLOBAL_TAB_SCOPE_ID, resolveRightPanelSessionId, rightPanelTabScopeId } from './right-panel-scope'
import {
  planBrowserKeepAlive,
  shouldEvictIdle,
  type BrowserKeepAliveSlot
} from '@renderer/lib/browser/browser-keepalive'
import { useChatStore } from './chat-store'

type SetFn = (partial: Partial<UIStore> | ((state: UIStore) => Partial<UIStore>)) => void
type GetFn = () => UIStore

/** 池的落盘形态是 map，判据要的是数组 —— 只在边界上转一次。 */
function readKeepAliveSlots(
  map: UIStore['browserKeepAliveBySession'] | undefined
): BrowserKeepAliveSlot[] {
  return Object.entries(map ?? {}).map(([scopeId, value]) => ({
    scopeId,
    lastAccessAt: value?.lastAccessAt ?? 0
  }))
}

/**
 * 池满时给 agent 的说明要带「谁占着、占的什么页面」，而这两样分住在别的 store 里：
 * 标题在 chat-store，URL 在 browserStatesBySession。
 */
function describeBrowserScope(
  state: UIStore,
  scopeId: string
): { title: string; url: string } {
  const sessionId = scopeId === GLOBAL_TAB_SCOPE_ID ? null : scopeId
  let title = sessionId ?? GLOBAL_TAB_SCOPE_ID
  if (sessionId) {
    const chat = useChatStore.getState() as any
    const index = chat.sessionsById?.[sessionId]
    const session = typeof index === 'number' ? chat.sessions?.[index] : undefined
    const sessionTitle = typeof session?.title === 'string' ? session.title.trim() : ''
    if (sessionTitle) title = sessionTitle
  } else {
    title = 'global session'
  }
  const url = state.getBrowserState?.(sessionId)?.url ?? ''
  return { title, url }
}

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

    openBrowserTab: (url: any, sessionId: any, projectId: any, options: any) => {
      // S-260：先申请保活名额，再建 tab。顺序不能反 —— 反了就是「tab 建好、webview 没挂上」，
      // 工具侧只能干等 10 秒再报「did not attach」，把一个能说清的原因变成一个超时。
      // `keepAliveExplicit` 默认跟 background 走：agent 后台调用不许抢别人的名额，
      // 用户自己要看（点 tab / 手动输地址）才允许强制腾位。
      get().ensureBrowserKeepAlive(sessionId, {
        explicit: options?.keepAliveExplicit ?? options?.background !== true,
        projectId
      })
      return get().ensureBrowserTab(url, sessionId, projectId, options)
    },

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

    // ── S-260 浏览器保活池 ──
    //
    // 池 = 当前**挂载了 BrowserPanel** 的会话。判定与淘汰顺序全在
    // `lib/browser/browser-keepalive.ts`（纯函数、可测），这里只做状态读写。
    // `explicit` 的含义：用户自己要看（点 tab / 手动输地址）⇒ 池满也腾位；
    // agent 后台调用 ⇒ 一个都不许动时直接拒绝并说明原因。

    ensureBrowserKeepAlive: (sessionId: any, options?: any) => {
      const state: any = get()
      const scopeId = rightPanelTabScopeId(resolveRightPanelSessionId(state, sessionId))
      const plan = planBrowserKeepAlive({
        slots: readKeepAliveSlots(state.browserKeepAliveBySession),
        leases: state.browserLeasesBySession ?? {},
        // 当前作用域永远受保护 —— 包括面板收起时，用户随时会切回来。
        visibleScopeId: rightPanelTabScopeId(resolveRightPanelSessionId(state)),
        targetScopeId: scopeId,
        explicit: options?.explicit !== false,
        describeScope: (id) => describeBrowserScope(state, id)
      })
      if (plan.action === 'reject') throw new Error(plan.reason)
      set((current: any) => {
        const browserKeepAliveBySession = { ...(current.browserKeepAliveBySession ?? {}) }
        if (plan.action === 'reclaim') delete browserKeepAliveBySession[plan.evictScopeId]
        browserKeepAliveBySession[scopeId] = {
          lastAccessAt: Date.now(),
          projectId: options?.projectId ?? null
        }
        return { browserKeepAliveBySession }
      })
    },

    beginBrowserLease: (sessionId: any) => {
      // 先占名额再计数：反过来会有一瞬间「lease > 0 但没挂载」，淘汰判据读到的就是假状态。
      get().ensureBrowserKeepAlive(sessionId, { explicit: false })
      set((current: any) => {
        const scopeId = rightPanelTabScopeId(resolveRightPanelSessionId(current, sessionId))
        const browserLeasesBySession = { ...(current.browserLeasesBySession ?? {}) }
        browserLeasesBySession[scopeId] = (browserLeasesBySession[scopeId] ?? 0) + 1
        return { browserLeasesBySession }
      })
    },

    endBrowserLease: (sessionId: any) =>
      set((current: any) => {
        const scopeId = rightPanelTabScopeId(resolveRightPanelSessionId(current, sessionId))
        const browserLeasesBySession = { ...(current.browserLeasesBySession ?? {}) }
        const next = (browserLeasesBySession[scopeId] ?? 0) - 1
        if (next > 0) browserLeasesBySession[scopeId] = next
        else delete browserLeasesBySession[scopeId]
        return { browserLeasesBySession }
      }),

    touchBrowserKeepAlive: (sessionId: any) =>
      set((current: any) => {
        const scopeId = rightPanelTabScopeId(resolveRightPanelSessionId(current, sessionId))
        // 只续期，不入池 —— 否则「切到某个会话」就等于「给它的浏览器占一个名额」。
        if (!current.browserKeepAliveBySession?.[scopeId]) return {}
        return {
          browserKeepAliveBySession: {
            ...current.browserKeepAliveBySession,
            [scopeId]: { lastAccessAt: Date.now() }
          }
        }
      }),

    evictIdleBrowserKeepAlive: () =>
      set((current: any) => {
        const now = Date.now()
        const visibleScopeId = rightPanelTabScopeId(resolveRightPanelSessionId(current))
        const leases = current.browserLeasesBySession ?? {}
        const browserKeepAliveBySession = { ...(current.browserKeepAliveBySession ?? {}) }
        let changed = false
        for (const slot of readKeepAliveSlots(browserKeepAliveBySession)) {
          if (!shouldEvictIdle({ slot, leases, visibleScopeId, now })) continue
          delete browserKeepAliveBySession[slot.scopeId]
          changed = true
        }
        return changed ? { browserKeepAliveBySession } : {}
      }),
  }
}
