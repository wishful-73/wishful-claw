/**
 * Wire types for the global agent Task Board.
 * Sources: db/global-tasks-* and db/global-task-dispatches-* worker methods.
 * Contract: camelCase input params, snake_case rows for multi-word fields.
 * The Task Board never reads the session-scoped tasks table.
 */

export type GlobalTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type GlobalTaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type GlobalDispatchStatus =
  | 'pending'
  | 'sent'
  | 'acknowledged'
  | 'in_progress'
  | 'completed'
  // S-280：会话结束时代替 agent 归档，**不是** agent 显式回复。
  // 必须与 'completed' 分开：卡片要如实写「未显式回复」，不许伪装成显式完成。
  | 'completed_implicit'
  | 'blocked'
  | 'failed'
  | 'cancelled'
export type GlobalDispatchKind = 'message' | 'work_request'

export const GLOBAL_TASK_STATUSES: GlobalTaskStatus[] = [
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled'
]
export const GLOBAL_TASK_PRIORITIES: GlobalTaskPriority[] = ['low', 'normal', 'high', 'urgent']
export const GLOBAL_DISPATCH_STATUSES: GlobalDispatchStatus[] = [
  'pending',
  'sent',
  'acknowledged',
  'in_progress',
  'completed',
  'completed_implicit',
  'blocked',
  'failed',
  'cancelled'
]

/** snake_case wire row returned by db/global-tasks-list. */
export interface GlobalTaskRow {
  id: string
  title: string
  description: string
  status: GlobalTaskStatus
  priority: GlobalTaskPriority
  /** JSON array text, e.g. ["tag-a","tag-b"] — parse with parseTags(). */
  tags: string
  due_at: number | null
  archived: number
  /** S-300: owning project id, or null for a pure global task. */
  project_id: string | null
  created_at: number
  updated_at: number
}

/** snake_case wire row returned by db/global-task-dispatches-list. */
export interface GlobalTaskDispatchRow {
  id: string
  global_task_id: string
  project_id: string | null
  session_id: string
  source_session_id: string | null
  kind: GlobalDispatchKind
  instruction: string
  status: GlobalDispatchStatus
  latest_report: string | null
  error: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

export interface GlobalMutationResult {
  success: boolean
  changed: number
  error?: string | null
}

export function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Same id shape as the worker-side executors (gt_/gd_ + guid without dashes). */
export function newGlobalTaskId(): string {
  return `gt_${crypto.randomUUID().replace(/-/g, '')}`
}

export function newDispatchId(): string {
  return `gd_${crypto.randomUUID().replace(/-/g, '')}`
}
