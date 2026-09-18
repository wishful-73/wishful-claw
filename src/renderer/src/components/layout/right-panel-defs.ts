export const LEFT_SIDEBAR_DEFAULT_WIDTH = 292
export const LEFT_SIDEBAR_MIN_WIDTH = 272
export const LEFT_SIDEBAR_MAX_WIDTH = 420

export const RIGHT_PANEL_DEFAULT_WIDTH = 384
export const RIGHT_PANEL_MIN_WIDTH = 280
export const RIGHT_PANEL_MAX_WIDTH = Number.POSITIVE_INFINITY
export const RIGHT_PANEL_MAX_WIDTH_RATIO = 0.8
export const RIGHT_PANEL_RAIL_WIDTH = 48
export const RIGHT_PANEL_RAIL_SLIM_WIDTH = 12
export const BOTTOM_TERMINAL_DOCK_DEFAULT_HEIGHT = 220
export const BOTTOM_TERMINAL_DOCK_MIN_HEIGHT = 160
export const BOTTOM_TERMINAL_DOCK_MAX_HEIGHT = 560

/**
 * 聊天窗区域的最小宽度（px）。
 *
 * 判据：输入框底部工具栏那一行放不下就会被裁 / 出横向滚动条，聊天窗再窄就没法用了。
 * 所以该值必须 >= 输入框的自然宽度，否则判据自破 —— 取值宁大勿小（取大了只是两侧面板早一点被收）。
 * 800 是按左侧组 + 右侧组 + 工具栏内边距 + 输入框左右 px-4 的粗估，需真机校准。
 */
export const CHAT_MIN_WIDTH = 800

/** 视口留给两侧面板的总预算 = 视口宽 - 聊天窗最低宽度。视口不可知时视为不限。 */
function panelBudget(): number {
  if (typeof window === 'undefined' || !(window.innerWidth > 0)) {
    return Number.POSITIVE_INFINITY
  }
  return window.innerWidth - CHAT_MIN_WIDTH
}

export function clampLeftSidebarWidth(width: number): number {
  const maxWidth = Math.min(LEFT_SIDEBAR_MAX_WIDTH, panelBudget())
  return Math.min(maxWidth, Math.max(LEFT_SIDEBAR_MIN_WIDTH, width))
}

export function clampRightPanelWidth(width: number): number {
  const budgetMax = panelBudget()
  const ratioMax =
    typeof window !== 'undefined' && window.innerWidth > 0
      ? window.innerWidth * RIGHT_PANEL_MAX_WIDTH_RATIO
      : RIGHT_PANEL_MAX_WIDTH
  const maxWidth = Math.min(RIGHT_PANEL_MAX_WIDTH, budgetMax, ratioMax)
  return Math.min(maxWidth, Math.max(RIGHT_PANEL_MIN_WIDTH, width))
}

/**
 * 两侧面板宽度与聊天窗最低宽度之和超过视口时，收掉「另一侧」以保住聊天窗。
 *
 * 只在另一侧确实开着时才收；无处可收（另一侧本来就没开，或视口不可知）时返回 null，
 * 保持现状 —— 窗口本身就窄到放不下时硬折腾只会来回抖动。
 *
 * @param changed 本次动作作用在哪一侧（展开或拖宽）
 * @returns 需要被强制收起的侧；null 表示不需要动作
 */
export function resolveChatWidthGuard(params: {
  changed: 'left' | 'right'
  leftOpen: boolean
  leftWidth: number
  rightOpen: boolean
  rightWidth: number
}): 'left' | 'right' | null {
  if (typeof window === 'undefined' || !(window.innerWidth > 0)) return null
  const used = (params.leftOpen ? params.leftWidth : 0) + (params.rightOpen ? params.rightWidth : 0)
  if (used + CHAT_MIN_WIDTH <= window.innerWidth) return null
  const other: 'left' | 'right' = params.changed === 'left' ? 'right' : 'left'
  const otherOpen = other === 'left' ? params.leftOpen : params.rightOpen
  return otherOpen ? other : null
}

export function clampBottomTerminalDockHeight(
  height: number,
  maxHeight = BOTTOM_TERMINAL_DOCK_MAX_HEIGHT
): number {
  return Math.min(maxHeight, Math.max(BOTTOM_TERMINAL_DOCK_MIN_HEIGHT, height))
}
