/**
 * 会话概览面板的 Git 相关类型。
 *
 * S-250 从 `SessionSummaryPanel.tsx` 搬出，字段一字未改。
 */

export interface GitResultBase {
  success?: boolean
  error?: string
}

export interface GitSummary {
  loading: boolean
  branch: string | null
  ahead: number
  behind: number
  changedFileCount: number
  added: number | null
  deleted: number | null
  dirty: boolean
  error: string | null
}

export type GitLineSummaryResult = GitResultBase & {
  added?: number
  deleted?: number
}
