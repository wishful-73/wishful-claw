import type { LoopEndReason, RequestRetryState, ToolCallState } from '../../lib/agent/types'

import type { SubAgentEvent } from '../../lib/agent/sub-agents/types'

import type {

  TokenUsage,

  MessageRequestModelMeta

} from '../../lib/api/types'



type SubAgentReportStatus = 'pending' | 'queued' | 'submitted' | 'retrying' | 'fallback' | 'missing'



export interface SubAgentState {

  name: string

  displayName?: string

  toolUseId: string

  sessionId?: string

  description: string

  prompt: string

  isRunning: boolean

  isQueued?: boolean

  success: boolean | null

  endReason: LoopEndReason | null

  errorMessage: string | null

  iteration: number

  toolCalls: ToolCallState[]

  streamingText: string

  transcript: import('../../lib/api/types').UnifiedMessage[]

  currentAssistantMessageId: string | null

  report: string

  /**
   * Worker 落库的子 agent 完整报告（对应 DB 里的 data.finalOutput）。渲染端流式累积的
   * report 在父 run 提前结束时只有前几轮，重载会话时靠这个字段补全（S-36）。
   */
  finalOutput?: string

  reportStatus: SubAgentReportStatus

  usage?: TokenUsage

  requestModel?: MessageRequestModelMeta

  mcpServerIds?: string[]

  permissionMode?: 'default' | 'whitelist' | 'fullAccess'

  startedAt: number

  completedAt: number | null

}



export interface SessionToolCallCache {

  pending: ToolCallState[]

  executed: ToolCallState[]

}



export interface SessionSubAgentLiveState {

  active: Record<string, SubAgentState>

  completed: Record<string, SubAgentState>

}



export interface PersistedAgentHistoryState {

  subAgentHistory: SubAgentState[]

  sessionSubAgentSummaries: Record<string, SubAgentState[]>

}



export interface BackgroundProcessState {

  id: string

  command: string

  cwd?: string

  sessionId?: string

  toolUseId?: string

  description?: string

  source?: string

  terminalId?: string

  status: 'running' | 'exited' | 'stopped' | 'error'

  output: string

  port?: number

  exitCode?: number | null

  createdAt: number

  updatedAt: number

}



export interface ForegroundShellExecState {

  execId: string

  processId?: string

  terminalId?: string

  command?: string

  cwd?: string

  sessionId?: string

  startedAt: number

  updatedAt: number

}



export interface ProcessListItem {

  id: string

  command: string

  cwd?: string

  port?: number

  createdAt?: number

  running?: boolean

  exitCode?: number | null

  metadata?: {

    source?: string

    sessionId?: string

    toolUseId?: string

    description?: string

    terminalId?: string

  }

}



export interface ProcessOutputEvent {

  id: string

  data?: string

  port?: number

  exited?: boolean

  exitCode?: number | null

  metadata?: {

    source?: string

    sessionId?: string

    toolUseId?: string

    description?: string

    terminalId?: string

  }

}



export interface BufferedProcessOutputEvent {

  id: string

  data: string

  port?: number

  exited?: boolean

  exitCode?: number | null

  metadata?: {

    source?: string

    sessionId?: string

    toolUseId?: string

    description?: string

    terminalId?: string

  }

}



export interface AgentFileSnapshot {

  exists: boolean

  text?: string

  previewText?: string

  tailPreviewText?: string

  textOmitted?: boolean

  hash: string | null

  size: number

  lineCount?: number

}



export interface AgentRunFileChange {

  id: string

  runId: string

  sessionId?: string

  toolUseId?: string

  toolName?: string

  filePath: string

  transport: 'local' | 'ssh'

  connectionId?: string

  op: 'create' | 'modify'

  status: 'open' | 'reverted'

  before: AgentFileSnapshot

  after: AgentFileSnapshot

  createdAt: number

  revertedAt?: number

}



export interface AgentRunChangeSet {

  runId: string

  sessionId?: string

  assistantMessageId: string

  status: 'open' | 'reverted'

  changes: AgentRunFileChange[]

  createdAt: number

  updatedAt: number

}



export type SessionExecutionStatus = 'running' | 'retrying' | 'completed'



export interface AgentStore {

  isRunning: boolean

  currentLoopId: string | null

  liveSessionId: string | null

  pendingToolCalls: ToolCallState[]

  executedToolCalls: ToolCallState[]

  runChangesByRunId: Record<string, AgentRunChangeSet>

  sessionSubAgentSummaries: Record<string, SubAgentState[]>

  sessionBackgroundProcessSummaries: Record<string, BackgroundProcessState[]>



  runningSessions: Record<string, SessionExecutionStatus>

  sessionRequestRetryState: Record<string, RequestRetryState>



  sessionToolCallsCache: Record<string, SessionToolCallCache>

  sessionSubAgentLiveCache: Record<string, SessionSubAgentLiveState>



  activeSubAgents: Record<string, SubAgentState>

  completedSubAgents: Record<string, SubAgentState>

  subAgentHistory: SubAgentState[]

  runningSubAgentNamesSig: string

  runningSubAgentSessionIdsSig: string



  approvedToolNames: string[]

  addApprovedTool: (name: string) => void



  backgroundProcesses: Record<string, BackgroundProcessState>

  foregroundShellExecByToolUseId: Record<string, ForegroundShellExecState>

  initBackgroundProcessTracking: () => Promise<void>

  registerForegroundShellExec: (

    toolUseId: string,

    execId: string,

    metadata?: { command?: string; cwd?: string; sessionId?: string }

  ) => void

  updateForegroundShellExec: (

    toolUseId: string,

    patch: Partial<

      Pick<ForegroundShellExecState, 'processId' | 'terminalId' | 'command' | 'cwd' | 'sessionId'>

    >

  ) => void

  clearForegroundShellExec: (toolUseId: string) => void

  abortForegroundShellExec: (toolUseId: string) => Promise<void>

  registerBackgroundProcess: (process: {

    id: string

    command: string

    cwd?: string

    sessionId?: string

    toolUseId?: string

    description?: string

    source?: string

    terminalId?: string

  }) => void

  stopBackgroundProcess: (id: string) => Promise<void>

  sendBackgroundProcessInput: (id: string, input: string, appendNewline?: boolean) => Promise<void>

  removeBackgroundProcess: (id: string) => void



  setRunning: (running: boolean) => void

  setCurrentLoopId: (id: string | null) => void

  setSessionStatus: (sessionId: string, status: SessionExecutionStatus | null) => void

  setSessionRequestRetryState: (sessionId: string, state: RequestRetryState | null) => void

  isSessionActive: (sessionId: string | null | undefined) => boolean

  switchToolCallSession: (prevSessionId: string | null, nextSessionId: string | null) => void

  loadSubAgentHistoryForSession: (sessionId: string) => Promise<void>

  resetLiveSessionExecution: (sessionId: string) => void

  addToolCall: (tc: ToolCallState, sessionId?: string | null) => void

  updateToolCall: (id: string, patch: Partial<ToolCallState>, sessionId?: string | null) => void

  refreshRunChanges: (

    runId: string,

    query?: { sessionId?: string; toolUseIds?: string[] }

  ) => Promise<void>

  refreshSessionRunChanges: (

    sessionId: string,

    query?: { assistantMessageIds?: string[]; toolUseIds?: string[] }

  ) => Promise<void>

  undoRunChanges: (runId: string) => Promise<{ error?: string }>

  undoFileChange: (runId: string, changeId: string) => Promise<{ error?: string }>

  clearToolCalls: () => void

  abort: () => void



  handleSubAgentEvent: (event: SubAgentEvent, sessionId?: string) => void



  clearSessionData: (sessionId: string) => void

  releaseDormantSessionData: (residentSessionIds: string[]) => void

  compactMemoryFootprint: () => void



  requestApproval: (toolCallId: string) => Promise<boolean>

  registerApprovalSource: (

    toolCallId: string,

    meta: { requestId: string; replyTo?: string; source?: 'teammate' | 'teammate-plan' }

  ) => void

  resolveApproval: (toolCallId: string, approved: boolean) => void

  clearPendingApprovals: () => void

}

