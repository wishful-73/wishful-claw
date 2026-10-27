/**
 * 内置浏览器的「清除浏览数据」（S-235）。
 *
 * 为什么是「按 webContentsId 清」而不是「按设置判该清哪个 partition」：
 * `browser:emulation-status` 目前是 stub，设置里写着「复用浏览器数据」，运行时却被打回
 * `false`，真身始终挂在 `persist:wishfulclaw-browser` 上。任何「读设置 → 决定清哪个
 * session」的写法都有一半概率清错对象 —— 用户点了没反应，需求等于没做。
 * 主进程拿 `webContents.fromId(id).session`，不管那道 stub bug 修没修、用户怎么选，都对。
 *
 * 清的范围只有两级缓存。`clearStorageData` 会连登录态和站点数据一起抹掉，那是「重置浏览器」，
 * 不是「清缓存」，不在本动作里。
 */

import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { isWebviewConnected } from '@renderer/lib/browser/webview-helpers'
import { reloadAndWait } from '@renderer/lib/browser/apply-browser-device'

export type BrowserClearCacheResult = { ok: true } | { ok: false; error: string }

interface ClearCacheResponse {
  success: boolean
  error?: string
}

export async function clearBrowserCache(
  webview: Electron.WebviewTag | null
): Promise<BrowserClearCacheResult> {
  if (!isWebviewConnected(webview)) {
    return { ok: false, error: 'Webview not connected' }
  }

  let webContentsId: number
  try {
    webContentsId = webview.getWebContentsId()
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }

  try {
    const response = (await ipcClient.invoke(IPC.BROWSER_CLEAR_CACHE, {
      webContentsId
    })) as ClearCacheResponse

    if (!response?.success) {
      return { ok: false, error: response?.error ?? '清除浏览数据失败' }
    }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }

  // 清完必须重载，而且要绕过缓存：清缓存在后台，不重载的话页面还是内存里那一份，
  // 用户体感就是「点了没反应」。顺序不能反 —— 先清后载才是装新货再开箱。
  const reloaded = await reloadAndWait(webview, { ignoreCache: true })
  if (!reloaded.ok) return { ok: false, error: reloaded.error }

  return { ok: true }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
