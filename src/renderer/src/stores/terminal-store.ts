import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { resolveShellExecutable } from '@renderer/stores/settings-store-types'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  countTabsForSession,
  removeTabAndPickActive,
  shouldCloseTabOnExit,
  type TerminalTabKind
} from '@renderer/stores/terminal-tab-lifecycle'

// ─── Types ───

// 判据（哪些 tab 退出即关、删 tab 后选谁、某会话还剩几个 tab）在零依赖模块里，
// renderer 与回归套件跑同一份代码。对外导入路径不变。
export type { TerminalTabKind }

export interface TerminalTab {
  id: string
  kind: TerminalTabKind
  title: string
  shell: string
  cwd: string
  status: 'running' | 'exited' | 'error'
  exitCode?: number
  createdAt: number
  /** Project this tab belongs to */
  projectId?: string | null
  /** Session this tab belongs to (agent tabs are per-session) */
  sessionId?: string | null
  /** For ssh-agent tabs: the connection name for display */
  connectionName?: string
}

interface TerminalStore {
  tabs: TerminalTab[]
  activeTabId: string | null
  _initialized: boolean

  init: () => void
  createTab: (cwd?: string, projectId?: string | null, titleOverride?: string, sessionId?: string | null) => Promise<string | null>
  closeTab: (id: string) => Promise<void>
  setActiveTab: (id: string | null) => void

  /** Create or reuse an SSH agent observation tab for a session */
  ensureSshAgentTab: (sessionId: string, projectId?: string | null, connectionName?: string) => void
  /** Check if an agent tab exists for a session */
  hasSshAgentTabForSession: (sessionId: string) => boolean

  _onCreated: (event: {
    id?: string
    title?: string
    shell?: string
    cwd?: string
    createdAt?: number
    exitCode?: number
    sessionId?: string
    projectId?: string
  }) => void
  _onOutput: (event: { id?: string; data?: string; seq?: number }) => void
  _onExit: (event: { id?: string; exitCode?: number; signal?: number }) => void
}

// ─── Store ───

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  _initialized: false,

  init: () => {
    if (get()._initialized) return
    set({ _initialized: true })

    // Listen for terminal exit to update tab status
    ipcClient.on(IPC.TERMINAL_EXIT, (payload) => {
      const event = payload as { id?: string; exitCode?: number; signal?: number }
      get()._onExit(event)
    })

    // Listen for terminals created outside this window's own createTab call — the agent's Terminal
    // tool starts processes through the Main process, and Main announces each one here.
    ipcClient.on(IPC.TERMINAL_CREATED, (payload) => {
      get()._onCreated(payload as Parameters<TerminalStore['_onCreated']>[0])
    })

    // Listen for SSH exec output — ensure a single agent tab per session
    ipcClient.on(IPC.SSH_EXEC_OUTPUT, (payload) => {
      const event = payload as { execId?: string; stream?: string; data?: string }
      if (!event.execId) return

      // Look up the active session and project
      const chatState = useChatStore.getState()
      const sessionId = chatState.activeSessionId
      if (!sessionId) return

      // Create a tab for this session if one doesn't exist yet
      if (!get().hasSshAgentTabForSession(sessionId)) {
        const activeSession = chatState.sessions.find((s: any) => s.id === sessionId)
        const projectId = activeSession?.projectId ?? null
        const project = projectId
          ? chatState.projects.find((p: any) => p.id === projectId)
          : undefined
        get().ensureSshAgentTab(sessionId, projectId, project?.name)
      }
    })
  },

  createTab: async (cwd, projectId, titleOverride, sessionId) => {
    try {
      // 默认 shell 来自「设置 → 终端与 SSH」。选 'auto' 时解析为 undefined，
      // 由主进程走自己的候选链（PowerShell 优先，cmd 兜底）。
      const { shellExecutionEndpoint, customShellExecutable } = useSettingsStore.getState()
      const shell = resolveShellExecutable({
        endpoint: shellExecutionEndpoint,
        customShellExecutable,
        platform: window.electron?.process?.platform
      })

      const result = (await ipcClient.invoke(IPC.TERMINAL_CREATE, {
        cwd,
        cols: 80,
        rows: 24,
        ...(shell ? { shell } : {})
      })) as {
        id?: string
        shell?: string
        cwd?: string
        title?: string
        createdAt?: number
        error?: string
      }

      if (result.error || !result.id) {
        console.error('[terminal-store] Failed to create terminal:', result.error)
        return null
      }

      const tab: TerminalTab = {
        id: result.id,
        kind: 'local',
        title: titleOverride || result.title || result.shell || 'Terminal',
        shell: result.shell || 'shell',
        cwd: result.cwd || cwd || '~',
        status: 'running',
        createdAt: result.createdAt || Date.now(),
        projectId: projectId ?? null,
        sessionId: sessionId ?? null
      }

      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id
      }))

      return tab.id
    } catch (error) {
      console.error('[terminal-store] Error creating terminal:', error)
      return null
    }
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)

    // Only kill node-pty sessions for local tabs
    if (tab?.kind !== 'ssh-agent') {
      try {
        await ipcClient.invoke(IPC.TERMINAL_KILL, { id })
      } catch {
        // ignore
      }
    }

    set((state) => removeTabAndPickActive(state.tabs, id, state.activeTabId))
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  ensureSshAgentTab: (sessionId, projectId, connectionName) => {
    // Reuse existing tab for this session
    const existing = get().tabs.find(
      (t) => t.kind === 'ssh-agent' && t.sessionId === sessionId
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }

    const tab: TerminalTab = {
      id: `ssh-agent-${sessionId}`,
      kind: 'ssh-agent',
      title: connectionName ? `Agent: ${connectionName}` : 'Agent SSH',
      shell: 'ssh',
      cwd: '~',
      status: 'running',
      createdAt: Date.now(),
      connectionName,
      projectId: projectId ?? null,
      sessionId
    }

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id
    }))

    // Do NOT auto-open the bottom terminal dock.
    // The tab is created and the AgentSshTerminal component is mounted
    // (the dock stays hidden via CSS 'hidden' which keeps the component alive).
    // Output continues to stream into the xterm buffer; when the user
    // manually opens the dock, all accumulated output is visible.
  },

  hasSshAgentTabForSession: (sessionId) => {
    return get().tabs.some(
      (t) => t.kind === 'ssh-agent' && t.sessionId === sessionId
    )
  },

  _onCreated: (event) => {
    const id = event.id
    if (!id) return

    // Already known — this window created it, or an earlier event raced with the invoke reply.
    if (get().tabs.some((tab) => tab.id === id)) return

    const tab: TerminalTab = {
      id,
      kind: 'local-agent',
      title: event.title || 'Agent',
      shell: event.shell || 'shell',
      cwd: event.cwd || '~',
      status: event.exitCode === undefined ? 'running' : event.exitCode === 0 ? 'exited' : 'error',
      createdAt: event.createdAt || Date.now(),
      projectId: event.projectId ?? null,
      sessionId: event.sessionId ?? null,
      ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {})
    }

    set((state) => ({ tabs: [...state.tabs, tab] }))

    // An agent-started terminal the user cannot see is one they cannot supervise, so bring the dock up
    // for that session and put the new tab in front. Two restraint rules: only for the session the user
    // is actually looking at (a background run's terminal belongs to a session they are not in), and
    // never re-select a tab while the dock is already open — there the user is watching something of
    // their own choosing, and the new tab is on the strip either way.
    const sessionId = event.sessionId
    if (!sessionId) return
    if (useChatStore.getState().activeSessionId !== sessionId) return
    const ui = useUIStore.getState()
    if (ui.isBottomTerminalDockOpen(sessionId)) return
    ui.setBottomTerminalDockOpen(sessionId, true)
    set({ activeTabId: id })
  },

  _onOutput: (_event) => {},

  _onExit: (event) => {
    const id = event.id
    if (!id) return

    const exited = get().tabs.find((tab) => tab.id === id)

    // agent 的常驻终端一死，那个选项卡就没有存在意义了 —— 留着只会越堆越多的死 tab（S-154）。
    // 用户自己开的 `local`、SSH 观察窗 `ssh-agent` 不进这条路：那两类的输出用户可能还要看。
    if (exited && shouldCloseTabOnExit(exited.kind)) {
      const removed = removeTabAndPickActive(get().tabs, id, get().activeTabId)
      set(removed)

      // 摘掉某会话最后一个 tab 时顺手收起它的停靠栏：空停靠栏会自动新建一个终端
      // （BottomTerminalDock 的 `dockOpen && sessionTabs.length === 0` 分支），
      // 不收的话用户会看到「死 tab 消失 → 冒出个全新空白终端」。
      const sessionId = exited.sessionId
      if (sessionId && countTabsForSession(removed.tabs, sessionId) === 0) {
        const ui = useUIStore.getState()
        if (ui.isBottomTerminalDockOpen(sessionId)) {
          ui.setBottomTerminalDockOpen(sessionId, false)
        }
      }
      return
    }

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              status: event.exitCode === 0 ? 'exited' : 'error',
              exitCode: event.exitCode
            }
          : tab
      )
    }))
  }
}))
