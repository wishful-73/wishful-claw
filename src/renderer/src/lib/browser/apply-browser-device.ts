/**
 * 内置浏览器的设备仿真应用层。
 *
 * 拆成两个函数，触发源严格分工 —— 这是避免「无限重载」的关键：
 *
 * - `syncBrowserDeviceEmulation`：只补视口仿真，**不 reload、不碰 UA**。
 *   可安全挂在 `dom-ready`（每次导航都会触发）上。
 * - `applyBrowserDevice`：运行时切换设备，改 UA → 补仿真 → reload 并等加载完成。
 *   仅在「用户切设备」「agent 切设备」时调用。
 *
 * `enableDeviceEmulation` 本身即时生效、不要求 reload，所以两者能解耦。
 */

import {
  browserDeviceKey,
  resolveBrowserDeviceViewport,
  type BrowserDeviceMode,
  type BrowserDeviceViewport
} from '@shared/browser-device-presets'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { isWebviewConnected } from '@renderer/lib/browser/webview-helpers'

export type BrowserDeviceApplyResult =
  | { ok: true; viewport: BrowserDeviceViewport | null }
  | { ok: false; error: string }

export interface BrowserDeviceTarget {
  webview: Electron.WebviewTag
  mode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
}

export interface BrowserDeviceSwitchTarget extends BrowserDeviceTarget {
  /** `pc` 形态要恢复的桌面 UA */
  desktopUserAgent: string
}

const RELOAD_TIMEOUT_MS = 10000

/** 导航被新的导航打断时的错误码，不算失败。 */
const ERR_ABORTED = -3

interface SetDeviceResponse {
  success: boolean
  viewport?: BrowserDeviceViewport | null
  error?: string
}

/**
 * 只补视口仿真。幂等，可安全挂在 `dom-ready` 上。
 */
export async function syncBrowserDeviceEmulation(
  target: BrowserDeviceTarget
): Promise<BrowserDeviceApplyResult> {
  let webContentsId: number
  try {
    webContentsId = target.webview.getWebContentsId()
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }

  try {
    const response = (await ipcClient.invoke(IPC.BROWSER_SET_DEVICE, {
      webContentsId,
      mode: target.mode,
      custom: target.customViewport
    })) as SetDeviceResponse

    if (!response?.success) {
      return { ok: false, error: response?.error ?? '设备仿真设置失败' }
    }
    return { ok: true, viewport: response.viewport ?? null }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

/**
 * 只缓存「进行中」的调用；settled 立刻出表，失败可立即重试。
 * 键是 webContentsId —— webview 重建后 guest id 变化，旧条目自然失效。
 */
const inFlight = new Map<number, { key: string; promise: Promise<BrowserDeviceApplyResult> }>()

/**
 * 运行时切换设备：改 UA → 补仿真 → reload 并等加载完成。
 *
 * 同配置并发调用复用同一个 promise，保证只 reload 一次。
 */
export function applyBrowserDevice(
  target: BrowserDeviceSwitchTarget
): Promise<BrowserDeviceApplyResult> {
  let webContentsId: number
  try {
    webContentsId = target.webview.getWebContentsId()
  } catch (error) {
    return Promise.resolve({ ok: false, error: describeError(error) })
  }

  const key = browserDeviceKey(target.mode, target.customViewport)
  const existing = inFlight.get(webContentsId)

  // 同配置正在跑 ⇒ 直接复用，不重复 reload
  if (existing && existing.key === key) return existing.promise

  // 不同配置在途 ⇒ 等它跑完再跑，避免两次 reload 交错
  const queued = existing ? existing.promise.then(noop, noop) : Promise.resolve()
  const promise: Promise<BrowserDeviceApplyResult> = queued.then(() => runDeviceSwitch(target))

  // 检查与占位之间没有 await —— 并发调用必然命中同一条目
  inFlight.set(webContentsId, { key, promise })
  void promise
    .then(noop, noop)
    .then(() => {
      // 身份校验后再删：避免误删后来者的条目
      if (inFlight.get(webContentsId)?.promise === promise) inFlight.delete(webContentsId)
    })

  return promise
}

/**
 * webview 重建 / 销毁时清掉旧 guest 的占位，防止 id 复用误命中。
 */
export function forgetBrowserDeviceState(webview: Electron.WebviewTag | null): void {
  if (!webview) return
  try {
    inFlight.delete(webview.getWebContentsId())
  } catch {
    /* webview 已销毁，无需清理 */
  }
}

async function runDeviceSwitch(
  target: BrowserDeviceSwitchTarget
): Promise<BrowserDeviceApplyResult> {
  const { webview } = target
  if (!isWebviewConnected(webview)) return { ok: false, error: 'Webview not connected' }

  const viewport = resolveBrowserDeviceViewport(target.mode, target.customViewport)
  let previousUserAgent: string
  try {
    previousUserAgent = webview.getUserAgent()
    // UA 先改：`useragent` 属性只对「导航前」生效，运行时必须用方法
    webview.setUserAgent(viewport ? viewport.userAgent : target.desktopUserAgent)
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }

  const emulation = await syncBrowserDeviceEmulation(target)
  if (!emulation.ok) {
    // 仿真失败 ⇒ 回滚 UA，别留下「UA 是手机、视口是桌面」的撕裂状态
    try {
      webview.setUserAgent(previousUserAgent)
    } catch {
      /* 回滚失败不影响主流程 */
    }
    return emulation
  }

  const reloaded = await reloadAndWait(webview)
  if (!reloaded.ok) {
    return { ok: false, error: reloaded.error }
  }

  return { ok: true, viewport: emulation.viewport }
}

type ReloadResult = { ok: true } | { ok: false; error: string }

function reloadAndWait(webview: Electron.WebviewTag): Promise<ReloadResult> {
  return new Promise<ReloadResult>((resolve) => {
    let settled = false

    const finish = (result: ReloadResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      webview.removeEventListener('did-finish-load', onFinish)
      webview.removeEventListener('did-fail-load', onFail)
      resolve(result)
    }

    const onFinish = (): void => finish({ ok: true })

    const onFail = (event: Electron.DidFailLoadEvent): void => {
      // 子帧失败不算主文档加载结束
      if (!event.isMainFrame) return
      // 被新导航打断属于正常情况
      if (event.errorCode === ERR_ABORTED) return
      finish({ ok: false, error: event.errorDescription || `加载失败（${event.errorCode}）` })
    }

    const timer = setTimeout(() => finish({ ok: true }), RELOAD_TIMEOUT_MS)

    webview.addEventListener('did-finish-load', onFinish)
    webview.addEventListener('did-fail-load', onFail as EventListener)

    try {
      webview.reload()
    } catch (error) {
      finish({ ok: false, error: describeError(error) })
    }
  })
}

function noop(): void {
  /* 忽略上一次的执行结果，只为排队 / 吞掉拒绝 */
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
