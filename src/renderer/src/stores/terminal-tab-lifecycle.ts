// S-154 — 终端选项卡的生命周期判据。
//
// 背景：agent 通过 Terminal 工具起的终端，PTY 一死（工具 `stop` → `pty.kill()` → `terminal:exit`），
// 渲染端只把 tab 的 `status` 改成 `exited` / `error`，**tab 本身留着** —— 跑几轮下来，用户看到的
// 就是一排点了没反应的死选项卡。
//
// 判据抽成零依赖纯函数：renderer 与回归套件跑同一份代码（同 scroll-collapse-gate 的做法），
// 也让「删 tab 之后选谁」只有一份实现（closeTab 与 _onExit 共用）。

export type TerminalTabKind = 'local' | 'local-agent' | 'ssh-agent'

/**
 * 进程退出后应当自动关闭的 tab 类型。
 *
 * 只收 `local-agent` —— 那是 agent 用完即弃的终端。
 * `local`（用户自己开的）与 `ssh-agent`（SSH 观察窗）退出后保留：用户可能还要看那屏输出，
 * 而且它们不会像 agent 终端那样一批一批地攒。
 */
export const AUTO_CLOSE_ON_EXIT_KINDS: ReadonlySet<TerminalTabKind> = new Set<TerminalTabKind>([
  'local-agent'
])

/** 该类型的 tab 在进程退出后要不要直接关掉。要放开范围只改上面那个集合。 */
export function shouldCloseTabOnExit(kind: TerminalTabKind): boolean {
  return AUTO_CLOSE_ON_EXIT_KINDS.has(kind)
}

/**
 * 从一个 tab 列表里摘掉指定 tab，并按「谁该顶上」重挑 activeTabId。
 *
 * 规矩与 `closeTab` 原来内联的那段完全一致：关掉的正是当前选中项时，顶上来的取剩余列表的
 * **最后一项**（没有剩余则为 null）；关掉的不是当前选中项时，选中项原样不动。
 */
export function removeTabAndPickActive<T extends { id: string }>(
  tabs: readonly T[],
  removedId: string,
  activeTabId: string | null
): { tabs: T[]; activeTabId: string | null } {
  const remaining = tabs.filter((tab) => tab.id !== removedId)
  const nextActiveId =
    activeTabId === removedId
      ? remaining.length > 0
        ? remaining[remaining.length - 1].id
        : null
      : activeTabId
  return { tabs: remaining, activeTabId: nextActiveId }
}

/**
 * 该会话名下还剩几个 tab。
 *
 * 用途唯一：摘掉最后一个 tab 之后，**空停靠栏会自动新建一个终端**
 * （BottomTerminalDock 的 `dockOpen && sessionTabs.length === 0` 分支），
 * 所以计数归零时必须顺手把该会话的停靠栏收起来，否则用户会看到「死 tab 消失 → 冒出个全新空白终端」。
 */
export function countTabsForSession<T extends { sessionId?: string | null }>(
  tabs: readonly T[],
  sessionId: string | null | undefined
): number {
  if (!sessionId) return 0
  return tabs.filter((tab) => tab.sessionId === sessionId).length
}
