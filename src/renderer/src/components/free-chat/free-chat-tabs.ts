/**
 * 免费对话页的选项卡状态（iter-30 / S-40）。
 *
 * 形态：顶部一行列出配置里的**全部**站点 —— 没打开的显示成普通按钮，打开了的变成带 × 的选项卡。
 * 规则（老大 2026-09-16 定）：
 * - 同一个站点只允许一个选项卡
 * - 关闭当前选项卡后就近激活右边那个；已在最右则激活左边那个
 * - 配置里被删掉的站点，其选项卡一并消失
 *
 * 抽成纯模块是为了可测：组件只管渲染与 webview 生命周期，规则全部收在这里。
 */

export interface FreeChatTabs {
  /** 已打开的站点 id，顺序跟随配置顺序（由调用方按 sites 过滤后传入）。 */
  openIds: string[]
  /** 当前激活的站点 id；没有任何选项卡时是空串。 */
  activeId: string
}

/** 打开（或激活）一个站点。已打开则只切换，不重复追加。 */
export function openFreeChatTab(state: FreeChatTabs, siteId: string): FreeChatTabs {
  if (!siteId) return state
  if (state.openIds.includes(siteId)) {
    return state.activeId === siteId ? state : { ...state, activeId: siteId }
  }
  return { openIds: [...state.openIds, siteId], activeId: siteId }
}

/** 关闭一个站点。关的是当前选项卡时就近顶替，否则当前不变。 */
export function closeFreeChatTab(state: FreeChatTabs, siteId: string): FreeChatTabs {
  const index = state.openIds.indexOf(siteId)
  if (index === -1) return state
  const openIds = state.openIds.filter((id) => id !== siteId)
  if (state.activeId !== siteId) return { openIds, activeId: state.activeId }
  // 关掉后原位置即「右边那个」；已在最右则落到最后一个（原位置的左边）。
  return { openIds, activeId: openIds[Math.min(index, openIds.length - 1)] ?? '' }
}

/** 站点清单变化后收敛。失效站点按「关闭」处理（就近顶替），无变化时返回原对象。 */
export function reconcileFreeChatTabs(state: FreeChatTabs, availableIds: string[]): FreeChatTabs {
  let next = state
  for (const id of state.openIds) {
    if (!availableIds.includes(id)) next = closeFreeChatTab(next, id)
  }
  return next
}

/**
 * 从持久化值恢复。持久化内容不可信：可能是旧版本残留、被手改过、或站点已被删除，
 * 因此逐项校验（字符串 + 站点仍存在）+ 去重，当前选项卡失效时回落第一个。
 */
export function restoreFreeChatTabs(
  persistedOpenIds: unknown,
  persistedActiveId: unknown,
  availableIds: string[]
): FreeChatTabs {
  const rawIds: unknown[] = Array.isArray(persistedOpenIds) ? persistedOpenIds : []
  const openIds: string[] = []
  for (const id of rawIds) {
    if (typeof id !== 'string' || !availableIds.includes(id) || openIds.includes(id)) continue
    openIds.push(id)
  }
  const activeId =
    typeof persistedActiveId === 'string' && openIds.includes(persistedActiveId)
      ? persistedActiveId
      : (openIds[0] ?? '')
  return { openIds, activeId }
}
