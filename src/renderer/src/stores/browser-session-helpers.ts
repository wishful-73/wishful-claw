/**

 * Browser session-scoped state helpers.

 *

 * Extracted from ui-store.ts to keep the store focused on UI state.

 * These functions handle session/project-level isolation of browser

 * panel state (URL, loading, navigation, errors).

 */



import { useChatStore } from './chat-store'

import type { UIStore } from './ui-store-interface'

import { DEFAULT_BROWSER_DEVICE_MODE, type BrowserDeviceMode } from '@shared/browser-device-presets'



// ─── Types ───



export interface BrowserErrorInfo {

  code: number

  desc: string

  url: string

}



export interface BrowserPanelSessionState {

  url: string

  loading: boolean

  pageTitle: string

  canGoBack: boolean

  canGoForward: boolean

  errorInfo: BrowserErrorInfo | null

  /** 设备仿真模式：pc / iphone / pixel / ipad / custom */
  deviceMode: BrowserDeviceMode

  /** custom 模式的宽高；其余模式为 null */
  customViewport: { width: number; height: number } | null

  /** 命令式导航请求序号：变化即代表「明确要求 webview 去这个地址」 */
  navigationSeq: number

}



// ─── Constants ───



const GLOBAL_BROWSER_SESSION_KEY = '__global__'



export const DEFAULT_BROWSER_STATE: BrowserPanelSessionState = {

  url: '',

  loading: false,

  pageTitle: '',

  canGoBack: false,

  canGoForward: false,

  errorInfo: null,

  deviceMode: DEFAULT_BROWSER_DEVICE_MODE,

  customViewport: null,

  navigationSeq: 0

}



// ─── Scope resolution ───



export interface PanelScope {

  sessionId: string | null

  projectId: string | null

}



function normalizeScopeId(value?: string | null): string | null {

  const trimmed = value?.trim()

  return trimmed || null

}



function resolveProjectIdForSession(sessionId?: string | null): string | null {

  const normalizedSessionId = normalizeScopeId(sessionId)

  if (!normalizedSessionId) return useChatStore.getState().activeProjectId ?? null

  const chatState = useChatStore.getState()

  return chatState.sessions.find((session) => session.id === normalizedSessionId)?.projectId ?? null

}



export function resolvePanelScope(

  state: Pick<UIStore, 'activeScopedSessionId' | 'activeScopedProjectId'>,

  sessionId?: string | null,

  projectId?: string | null

): PanelScope {

  const resolvedSessionId = normalizeScopeId(

    sessionId !== undefined

      ? sessionId

      : (state.activeScopedSessionId ?? useChatStore.getState().activeSessionId ?? null)

  )

  const resolvedProjectId = normalizeScopeId(

    projectId !== undefined

      ? projectId

      : resolvedSessionId

        ? resolveProjectIdForSession(resolvedSessionId)

        : (state.activeScopedProjectId ?? useChatStore.getState().activeProjectId ?? null)

  )

  return {

    sessionId: resolvedSessionId,

    projectId: resolvedProjectId

  }

}



// ─── State map helpers ───



export function getBrowserSessionKey(sessionId?: string | null, projectId?: string | null): string {

  const normalizedSessionId = normalizeScopeId(sessionId)

  if (normalizedSessionId) return normalizedSessionId

  const normalizedProjectId = normalizeScopeId(projectId)

  return normalizedProjectId ? `project:${normalizedProjectId}` : GLOBAL_BROWSER_SESSION_KEY

}



export function getBrowserStateFromMap(

  states: Record<string, BrowserPanelSessionState | undefined> | null | undefined,

  sessionId?: string | null,

  projectId?: string | null

): BrowserPanelSessionState {

  return states?.[getBrowserSessionKey(sessionId, projectId)] ?? DEFAULT_BROWSER_STATE

}



export function getBrowserScopeKey(scope: PanelScope): string {

  return getBrowserSessionKey(scope.sessionId, scope.projectId)

}



export function isActiveBrowserScope(

  state: Pick<UIStore, 'activeScopedSessionId' | 'activeScopedProjectId'>,

  scope: PanelScope

): boolean {

  return getBrowserScopeKey(resolvePanelScope(state)) === getBrowserScopeKey(scope)

}



function browserAliasState(

  browserState: BrowserPanelSessionState

): Pick<

  UIStore,

  | 'browserUrl'

  | 'browserLoading'

  | 'browserPageTitle'

  | 'browserCanGoBack'

  | 'browserCanGoForward'

  | 'browserErrorInfo'

> {

  return {

    browserUrl: browserState.url,

    browserLoading: browserState.loading,

    browserPageTitle: browserState.pageTitle,

    browserCanGoBack: browserState.canGoBack,

    browserCanGoForward: browserState.canGoForward,

    browserErrorInfo: browserState.errorInfo

  }

}



export function updateBrowserStateForSession(

  state: Pick<

    UIStore,

    'activeScopedSessionId' | 'activeScopedProjectId' | 'browserStatesBySession'

  >,

  sessionId: string | null | undefined,

  patch: Partial<BrowserPanelSessionState>,

  projectId?: string | null

): Partial<UIStore> {

  const scope = resolvePanelScope(state, sessionId, projectId)

  const key = getBrowserScopeKey(scope)

  const browserStatesBySession = state.browserStatesBySession ?? {}

  const nextBrowserState = {

    ...getBrowserStateFromMap(browserStatesBySession, scope.sessionId, scope.projectId),

    ...patch

  }

  return {

    browserStatesBySession: {

      ...browserStatesBySession,

      [key]: nextBrowserState

    },

    ...(isActiveBrowserScope(state, scope) ? browserAliasState(nextBrowserState) : {})

  }

}

