/**
 * 网址 → 打开动作：一律交给右侧浏览器面板。
 *
 * 不开系统浏览器：面板是内置 webview，接得住任意站点（不像 iframe 会被
 * X-Frame-Options 挡下），而 agent 给的地址多半是它刚起的本地 dev server ——
 * 「就地看一眼」比切走一个应用顺手。
 *
 * 与 local-target.ts 分工：那边管本地路径（图片走全屏、其余走预览面板），
 * 这边只管 http(s)。两者都不负责「目标是否存在」的判定。
 */

import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'

/** 认「网页」的判据。与本地路径判定刻意分开：一个网址不是路径，反之亦然。 */
const HTTP_URL_RE = /^https?:\/\//i

export function isWebUrl(value: string): boolean {
  return HTTP_URL_RE.test(value.trim())
}

/** 在右侧浏览器面板打开该网址；面板已有浏览器 tab 则复用并前置。 */
export function openWebUrl(url: string): void {
  const link = url.trim()
  if (!link) return
  useUIStore.getState().openBrowserTab(link, useChatStore.getState().activeSessionId)
}
