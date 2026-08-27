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


export type AutoModelRoute = 'main' | 'fast'
export type AutoModelTaskType = string
export type AutoModelConfidence = string
export type AutoModelDecisionSource = string
export type AutoModelRoutingComplexity = string
export type AutoModelRoutingRisk = string

export interface AutoModelSelectionStatus {
  source: 'auto'
  mode?: string
  target: AutoModelRoute
  providerId?: string
  modelId?: string
  providerName?: string
  modelName?: string
  taskType?: AutoModelTaskType
  confidence?: AutoModelConfidence
  decisionSource?: AutoModelDecisionSource
  toolsAllowed?: boolean
  complexity?: AutoModelRoutingComplexity
  risk?: AutoModelRoutingRisk
  reasons?: string[]
  classifierRoute?: AutoModelRoute
  heuristicRoute?: AutoModelRoute
  fallbackReason?: string
  routingDurationMs?: number
  selectedAt: number
}

export type AutoModelRoutingState = 'idle' | 'routing'

export type ChatView = 'home' | 'project' | 'archive' | 'channels' | 'git' | 'session' | 'persona'

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
  | 'shortcuts'
  | 'general'
  | 'persona'
  | 'about'
  | 'permission'
  | 'channel'
  | 'plugin'
  | 'extension'
  | 'mcp'

  | 'ssh'
  | 'skills'

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