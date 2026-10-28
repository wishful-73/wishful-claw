/**
 * 合并后的应用列表缓存槽。
 *
 * S-249 从 `quick-launcher.ts` 搬出。单独成一个文件是为了打断反向依赖：
 * UWP 后台扫描结束时要把缓存置空（新扫到的条目还没并进去），而 app-list 又要读 UWP 缓存 ——
 * 两者直接互相 import 就成环了，缓存槽放中间一层，两边都只往这儿看。
 *
 * 注意这里只搬了「槽」，`cacheTime` 与 `iconCache` 仍留在 `app-list.ts` 内部 ——
 * 它们没有被任何外部模块碰过，没必要外露。
 */

import type { AppShortcut } from './types'

let appListCache: AppShortcut[] | null = null

export function getAppListCache(): AppShortcut[] | null {
  return appListCache
}

export function setAppListCache(next: AppShortcut[] | null): void {
  appListCache = next
}

/** 让下一次搜索重建合并列表（历史顺序变了 / 自定义应用改了 / UWP 扫到新条目）。 */
export function invalidateAppListCache(): void {
  appListCache = null
}
