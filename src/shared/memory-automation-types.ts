// Memory automation types — proper definitions for wishful-claw renderer.

// ─── String literal union types ───

export type MemoryAutomationStatus =
  | 'skipped'
  | 'error'
  | 'written'
  | 'filtered'
  | 'undone'
  | string

export type MemoryAutomationFilterReason =
  | 'disabled'
  | 'unsupported_scope'
  | 'no_candidates'
  | 'missing_target'
  | 'missing_provider'
  | 'unsupported_provider'
  | 'write_error'
  | 'invalid_json'
  | 'temporary_chatter'
  | 'rollup_already_processed'
  | string

export type MemoryRootScope = 'global' | 'project' | string

export type MemoryAutomationTarget =
  | 'project_memory'
  | 'global_memory'
  | 'summary_cache'
  | 'global_daily'
  | 'project_daily'
  | 'user_global'
  | 'user_project'
  | string

export type MemoryJobStatus =
  | 'running'
  | 'succeeded'
  | 'succeeded_no_output'
  | 'failed'
  | string

export type MemoryAutomationCandidateKind =
  | 'daily_context'
  | 'project_decision'
  | 'workflow_habit'
  | string

// ─── Interfaces ───

export interface MemoryAutomationConfig {
  [key: string]: unknown
}

export interface MemoryAutomationEvent {
  [key: string]: unknown
}

export interface MemoryAutomationResult {
  [key: string]: unknown
}

export interface MemoryRootInput {
  scope: MemoryRootScope
  rootPath: string
  transport?: 'local' | 'ssh' | string
  workingFolder?: string | null
  sshConnectionId?: string | null
  projectId?: string | null
}

export interface MemoryRootDescriptor {
  id: string
  scope: MemoryRootScope
  rootPath: string
  projectId?: string | null
  sshConnectionId?: string | null
}

export interface MemoryStage1OutputInput {
  memoryRootId: string
  scope: MemoryRootScope
  sourceSessionId: string
  sourceUpdatedAt?: number | null
  rawMemory: string
  rolloutSummary: string
  rolloutSlug: string
  fingerprint: string
  status: string
}

export interface MemoryStage1Output {
  id: string
  memoryRootId: string
  scope: MemoryRootScope
  sourceSessionId: string
  sourceUpdatedAt?: number | null
  rawMemory: string
  rolloutSummary: string
  rolloutSlug: string
  fingerprint: string
  status: string
  createdAt: number
}

export interface MemoryPipelineJob {
  id: string
  [key: string]: unknown
}

export interface MemoryPipelineRunResult {
  success: boolean
  error?: string | null
  job?: MemoryPipelineJob | null
  roots?: MemoryRootDescriptor[]
  stage1Outputs?: MemoryStage1Output[] | null
}

export interface MemoryAutomationEntry {
  id: string
  status: MemoryAutomationStatus
  target: MemoryAutomationTarget
  targetPath?: string | null
  sshConnectionId?: string | null
  appendedText?: string | null
  afterContent?: string | null
  beforeContent?: string | null
  [key: string]: unknown
}

export interface MemoryAutomationRecordInput {
  scope: string
  rootScope?: MemoryRootScope | null
  memoryRootId?: string | null
  jobId?: string | null
  projectId?: string | null
  target: MemoryAutomationTarget
  kind: MemoryAutomationCandidateKind
  content: string
  confidence: number
  sourceSessionId?: string | null
  targetPath?: string | null
  status: MemoryAutomationStatus
  filterReason?: MemoryAutomationFilterReason | null
  fingerprint: string
  error?: string | null
  evidence?: Record<string, unknown> | null
  writtenAt?: number | null
  beforeContent?: string | null
  afterContent?: string | null
  appendedText?: string | null
  sshConnectionId?: string | null
}

export interface MemoryAutomationRecordResult {
  success: boolean
  error?: string | null
  entry?: MemoryAutomationEntry | null
}
