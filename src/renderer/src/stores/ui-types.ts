// ─── Types ───

export type AppMode = 'chat' | 'clarify' | 'cowork' | 'code' | 'acp'

export type NavItem =
  | 'chat'
  | 'channels'
  | 'resources'
  | 'skills'
  | 'souls'
  | 'sync'
  | 'draw'
  | 'translate'
  | 'tasks'
  | 'codegraph'


export type ChatView = 'home' | 'project' | 'archive' | 'git' | 'session' | 'persona'

export type RightPanelSection = 'execution' | 'resources' | 'collaboration' | 'monitoring'
export type AgentFilesTab = 'files' | 'changes'
export type AgentFilesChangeSource = 'all' | 'agent' | 'git'
export type RightPanelTabKind =
  | 'activity'
  | 'memory'
  | 'context'
  | 'review'
  | 'files'
  | 'preview'
  | 'browser'
  | 'subagent'
  | 'terminal'
  | 'goal'
  | 'summary'
  | 'timeline'

export interface RightPanelTabInstance {
  id: string
  kind: RightPanelTabKind
  title: string
  closable: boolean
  sessionId?: string | null
  toolUseId?: string | null
  inlineText?: string | null
  processId?: string
  terminalSource?: 'local' | 'ssh'
  localTabId?: string
  sshTabId?: string
  previewTabId?: string
  projectId?: string | null
  goalId?: string | null
  initialChangeId?: string | null
  selectionRequestId?: number
  modified?: boolean
  createdAt: number
}

export type SettingsTab =
  | 'provider'
  | 'modelManagement'
  | 'runtime'
  | 'memory'
  | 'shortcuts'
  | 'general'
  | 'persona'
  | 'about'
  | 'logs'
  | 'usage'
  | 'permission'
  | 'channel'
  | 'plugin'
  | 'webSearch'
  | 'extension'
  | 'mcp'

  | 'ssh'
  | 'skills'

const SETTINGS_TABS: ReadonlySet<string> = new Set<SettingsTab>([
  'provider',
  'modelManagement',
  'runtime',
  'memory',
  'shortcuts',
  'general',
  'persona',
  'about',
  'logs',
  'usage',
  'permission',
  'channel',
  'plugin',
  'webSearch',
  'extension',
  'mcp',
  'ssh',
  'skills'
])

export function normalizeSettingsTab(raw: unknown): SettingsTab {
  return typeof raw === 'string' && SETTINGS_TABS.has(raw)
    ? (raw as SettingsTab)
    : 'provider'
}

export type PreviewSource = 'file' | 'dev-server' | 'markdown' | 'diff'
export type DiffSource = 'git' | 'agent'
export type GitChangeSection = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export type DetailPanelContent =
  | { type: 'team' }
  | { type: 'subagent'; toolUseId?: string; text?: string }
  | { type: 'terminal'; processId: string }
  | { type: 'change-review'; runId: string; initialChangeId?: string | null }
  | { type: 'document'; title: string; content: string }
  | { type: 'report'; title: string; data: unknown }

export interface MessageListViewState {
  scrollOffset: number
  messageCount: number
  loadedRangeStart: number
  loadedRangeEnd: number
}