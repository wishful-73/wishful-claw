import type { UsageLogRow } from './usage-detail-table'

/**
 * 用量统计面板（Settings → Usage）的数据形状：全部是后端 `db/usage-*` 端点的 DTO。
 * 抽成独立文件与组件逻辑分开（见 `dev-workflow.md` 阶段四「大文件拆分」）。
 */

export interface UsageResponse {
  success: boolean
  error?: string | null
}

export interface UsageOverview extends UsageResponse {
  from: number
  to: number
  requestCount: number
  successCount: number
  errorCount: number
  inputTokens: number
  billableInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  // Absent (not null) when nothing in the window was priced — see WhenWritingNull.
  totalCostUsd?: number | null
  avgDurationMs?: number | null
  retryCount: number
}

export interface UsageBucket {
  bucketStart: number
  requestCount: number
  successCount: number
  errorCount: number
  billableInputTokens: number
  outputTokens: number
  totalCostUsd?: number | null
}

export interface UsageBuckets extends UsageResponse {
  interval: 'hour' | 'day'
  from: number
  to: number
  buckets: UsageBucket[]
}

export interface UsageModelRow {
  providerId?: string | null
  modelId: string
  providerType?: string | null
  requestCount: number
  errorCount: number
  billableInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd?: number | null
}

export interface UsageLogsResponse extends UsageResponse {
  rows: UsageLogRow[]
  total: number
  offset: number
  limit: number
}
