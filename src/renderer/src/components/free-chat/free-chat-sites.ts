/**
 * 免费对话站点清单的排序（v2-iter-31 / S-55）。
 *
 * 清单顺序**就是**免费对话页顶部那排选项卡的排列顺序 —— 页面直接 `sites.map(...)`
 * 渲染（见 FreeChatPage.tsx），选中项也按站点 id 记（`freeChatActiveTabId`），
 * 所以这里只负责把配置数组挪一格，页面自然跟着生效，**不需要任何同步逻辑**。
 *
 * 抽成纯模块是为了可测：组件只管渲染按钮与禁用态。
 */

import type { FreeChatSite } from '@renderer/stores/settings-store-types'

export type FreeChatSiteMoveDirection = 'up' | 'down'

/**
 * 把 `siteId` 对应的站点上移/下移一位。
 *
 * 越界（已在首/末）或 id 不存在时**原样返回同一个数组引用**：调用方据此跳过写盘，
 * 也避免触发无谓的重渲染。
 */
export function moveFreeChatSite(
  sites: FreeChatSite[],
  siteId: string,
  direction: FreeChatSiteMoveDirection
): FreeChatSite[] {
  const index = sites.findIndex((site) => site.id === siteId)
  if (index === -1) return sites

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= sites.length) return sites

  const next = [...sites]
  const moved = next[index]
  next[index] = next[targetIndex]
  next[targetIndex] = moved
  return next
}
