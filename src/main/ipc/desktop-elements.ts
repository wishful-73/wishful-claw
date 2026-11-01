/**
 * `desktop:query:elements` —— 问自家窗口「这个按钮在哪」（S-273 段 A）。
 *
 * 纯逻辑在 `lib/ax-elements.ts`（不 import electron，可写回归），这里只做三件事：
 * 拿到窗口、挂 CDP、按顺序收尾。
 *
 * **只覆盖自家窗口**。第三方应用拿不到 `webContents`，`debugger` 无从挂起 —— 这条
 * 直接报错并把模型引回 `DesktopListWindows` + 相对坐标，不做「猜一个」。
 */

import { screen } from 'electron'
import { getMainWindow } from '../main-window-registry'
import {
  collectAxElements,
  pickClosestNames,
  type AxCollectResult,
  type AxFrame,
  type AxQueryOptions,
  type CdpSession
} from '../lib/ax-elements'

export const DESKTOP_QUERY_ELEMENTS = 'desktop:query:elements'

export interface QueryElementsParams extends AxQueryOptions {
  /** 可选：模型想找的元素名。找不到时用它出候选。 */
  expect?: string
}

export interface QueryElementsResult {
  success: boolean
  error?: string
  /** 找不到 `expect` 时的候选名，让模型下一轮改对而不是反复试坐标。 */
  candidates?: string[]
  elements?: AxCollectResult['elements']
  totalNodes?: number
  missingRects?: number
  frameNote?: string
  width?: number
  height?: number
}

/** CDP 的 `DOM.getBoxModel` 要 DOM 域先 enable，否则报 "DOM agent is not enabled"。 */
function createSession(webContents: Electron.WebContents): CdpSession {
  return {
    send: async (method, params) => {
      const debuggerApi = webContents.debugger
      return debuggerApi.sendCommand(method, params)
    }
  }
}

export async function queryDesktopElements(
  params: QueryElementsParams = {}
): Promise<QueryElementsResult> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return {
      success: false,
      error:
        'This app has no window available, so its element tree cannot be read. ' +
        'For other applications use DesktopListWindows and relative coordinates instead.'
    }
  }

  if (win.isMinimized()) {
    return {
      success: false,
      error: 'The app window is minimized; restore it before querying its elements.'
    }
  }

  const webContents = win.webContents
  if (!webContents || webContents.isDestroyed()) {
    return {
      success: false,
      error:
        'The app window has no live web contents. Only this app\'s own window can be queried this way — ' +
        'for other applications use DesktopListWindows and relative coordinates.'
    }
  }

  const contentBounds = win.getContentBounds()
  const display = screen.getDisplayMatching(contentBounds)
  const frame: AxFrame = {
    originX: contentBounds.x,
    originY: contentBounds.y,
    scaleFactor: display.scaleFactor > 0 ? display.scaleFactor : 1,
    // 页面缩放：CSS 像素 ÷ zoomFactor = DIP。用户按过 Ctrl+= 时这条不能漏，
    // 否则元素矩形会整体偏小。
    zoomFactor: webContents.getZoomFactor() || 1
  }

  const attachedHere = attachDebugger(webContents)
  if (!attachedHere.ok) {
    return { success: false, error: attachedHere.error }
  }

  try {
    // `DOM.getBoxModel` 依赖 DOM 域；enable 一次就够，disable 不必 —— DOM 域没有
    // 「树常驻」的代价，而 Accessibility 有（Chromium 会一直维护完整 a11y 树）。
    await webContents.debugger.sendCommand('DOM.enable')

    const collected = await collectAxElements(createSession(webContents), frame, params)
    const expect = typeof params.expect === 'string' ? params.expect.trim() : ''

    const result: QueryElementsResult = {
      success: true,
      elements: collected.elements,
      totalNodes: collected.totalNodes,
      missingRects: collected.missingRects,
      frameNote: collected.frameNote,
      width: contentBounds.width,
      height: contentBounds.height
    }

    if (expect && !collected.elements.some((element) => element.name.includes(expect))) {
      result.candidates = pickClosestNames(
        expect,
        collected.elements.map((element) => element.name).filter(Boolean)
      )
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    detachDebugger(webContents)
  }
}

/**
 * 挂 CDP。已经挂着（DevTools 或另一个工具）时 `attach` 会抛 —— 那不该被当成
 * 「元素树读不到」，报文要说清楚是「调试会话被占用」，模型才知道换个时机再试。
 */
function attachDebugger(
  webContents: Electron.WebContents
): { ok: true } | { ok: false; error: string } {
  try {
    if (webContents.debugger.isAttached()) {
      return {
        ok: false,
        error:
          'Another debugger session is already attached to this window (DevTools or a previous tool run). ' +
          'Detach it and retry; nothing was changed.'
      }
    }
    webContents.debugger.attach('1.3')
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: `Could not attach a debugger session to the app window: ${detail}`
    }
  }
}

/** 收尾。detach 失败不抛出 —— 它一旦盖住原始异常，模型看到的就是错的那条。 */
function detachDebugger(webContents: Electron.WebContents): void {
  try {
    if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
      webContents.debugger.detach()
    }
  } catch {
    // 忽略：窗口可能正在销毁
  }
}
