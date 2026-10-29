import {
  isPromiseLike,
  isWebviewConnected,
  type MaybePromise
} from '../browser/webview-helpers'
import { useUIStore } from '../../stores/ui-store'
import type { ToolContext } from './tool-types'

type ElectronWebview = Electron.WebviewTag

/** Minimal type for Electron nativeImage returned by webview.capturePage() */
export interface NativeImageLike {
  isEmpty(): boolean
  toDataURL(): string
  /** BGRA 像素，每像素 4 字节。缺陷 A 的「白图检测」只靠它，不解 PNG。 */
  toBitmap(): Uint8Array
  getSize(): { width: number; height: number }
}

function getWebview(ctx?: ToolContext): ElectronWebview | null {
  const ref = useUIStore.getState().getBrowserWebviewRef(ctx?.sessionId)
  const webview = ref?.current ?? null
  return isWebviewConnected(webview) ? webview : null
}

function requireWebview(ctx?: ToolContext): ElectronWebview {
  const webview = getWebview(ctx)
  if (!webview) {
    throw new Error('No attached browser view is available. Use BrowserNavigate first.')
  }
  return webview
}

async function runWebviewCommand<T>(
  webview: ElectronWebview,
  action: string,
  command: (webview: ElectronWebview) => MaybePromise<T>
): Promise<T> {
  if (!isWebviewConnected(webview)) {
    throw new Error(`Browser view is not attached while trying to ${action}.`)
  }

  const result = command(webview)
  return isPromiseLike<T>(result) ? await result : result
}

async function waitForLoad(webview: ElectronWebview, timeoutMs = 30000): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isWebviewConnected(webview)) {
      resolve()
      return
    }

    let resolved = false
    const timers: { timeout?: number; detach?: number } = {}
    const done = (): void => {
      if (resolved) return
      resolved = true
      if (timers.timeout !== undefined) window.clearTimeout(timers.timeout)
      if (timers.detach !== undefined) window.clearInterval(timers.detach)
      webview.removeEventListener('did-stop-loading', done)
      webview.removeEventListener('did-fail-load', done)
      resolve()
    }
    webview.addEventListener('did-stop-loading', done)
    webview.addEventListener('did-fail-load', done)
    timers.timeout = window.setTimeout(done, timeoutMs)
    timers.detach = window.setInterval(() => {
      if (!isWebviewConnected(webview)) done()
    }, 100)
  })
}

async function waitForWebview(
  ctx?: ToolContext,
  maxWaitMs = 5000
): Promise<ElectronWebview | null> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const webview = getWebview(ctx)
    if (webview) return webview
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

// Returns the attached browser webview, self-healing when none is present.
// The webview stays mounted in the background once a page has been opened (see
// RightPanel), so this normally hits the fast path. If it is missing — e.g. the
// browser tab was never created for this session — we launch it in the background
// (without stealing the UI) using the last known URL so the tool can still run.
async function ensureAttachedWebview(ctx: ToolContext): Promise<ElectronWebview> {
  const existing = getWebview(ctx)
  if (existing) return existing

  // Nothing is attached. Without a previously opened page there is genuinely
  // nothing to read or interact with, so keep the original "navigate first" hint
  // rather than spawning an empty browser tab.
  const storedUrl = useUIStore.getState().getBrowserState(ctx.sessionId).url
  if (!storedUrl) {
    throw new Error('No attached browser view is available. Use BrowserNavigate first.')
  }

  // A page was opened before but its webview is no longer mounted (e.g. the tab was
  // dropped). Relaunch it in the background — without stealing the UI — and wait for
  // the freshly mounted webview to reload the stored URL before proceeding.
  useUIStore.getState().openBrowserTab(storedUrl, ctx.sessionId, undefined, { background: true })

  const webview = await waitForWebview(ctx)
  if (!webview) {
    throw new Error('No attached browser view is available. Use BrowserNavigate first.')
  }
  await waitForLoad(webview)
  return webview
}

function parseWebviewJson<T>(raw: unknown): T {
  if (typeof raw === 'string') return JSON.parse(raw) as T
  if (raw && typeof raw === 'object') return raw as T
  throw new Error(`Unexpected browser script result: ${String(raw)}`)
}

function extractBase64ImageData(dataUrl: string): { data: string; mediaType: string } | null {
  const commaIndex = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || commaIndex === -1) return null

  const metadata = dataUrl.slice(5, commaIndex)
  if (!metadata.includes(';base64')) return null

  return {
    data: dataUrl.slice(commaIndex + 1),
    mediaType: metadata.split(';')[0] || 'image/png'
  }
}

/**
 * S-260：一次浏览器工具调用期间把该会话的保活名额「钉住」。
 *
 * 返回的释放函数必须在 finally 里调 —— 漏了就是名额泄漏，池再也腾不出来。
 * 拿不到名额时**不阻止**本次调用：已有挂载的 webview 照样能用，真正需要新挂载时
 * `ensureAttachedWebview` 会给出「谁占着、怎么办」的说明。
 */
function acquireBrowserLease(sessionId?: string | null): () => void {
  try {
    useUIStore.getState().beginBrowserLease(sessionId)
  } catch {
    return () => {}
  }
  let released = false
  return () => {
    if (released) return
    released = true
    useUIStore.getState().endBrowserLease(sessionId)
  }
}

export {
  type ElectronWebview,
  acquireBrowserLease,
  getWebview,
  requireWebview,
  runWebviewCommand,
  waitForLoad,
  waitForWebview,
  ensureAttachedWebview,
  parseWebviewJson,
  extractBase64ImageData
}
