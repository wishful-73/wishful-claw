/**
 * 用量面板的数值与标签格式化（纯函数，无 JSX）。
 *
 * S-250 从 `UsagePanelParts.tsx` 搬出，函数体逐字平移。
 */

export interface UsageModelBucket {
  bucketStart: number
  requestCount: number
}

export interface UsageModelSeries {
  providerId?: string | null
  providerName?: string | null
  modelId: string
  providerType?: string | null
  buckets: UsageModelBucket[]
}

export function formatCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function formatBucketLabel(bucketStart: number, interval: 'hour' | 'day'): string {
  const d = new Date(bucketStart)
  if (interval === 'hour') return `${String(d.getHours()).padStart(2, '0')}:00`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 24h 窗口的首尾桶钟点相同，轴标签需带日期才不会被读成同一时刻。 */
export function formatAxisLabel(bucketStart: number, interval: 'hour' | 'day'): string {
  const label = formatBucketLabel(bucketStart, interval)
  if (interval === 'day') return label
  const d = new Date(bucketStart)
  return `${d.getMonth() + 1}/${d.getDate()} ${label}`
}

export function sourceLabel(row: {
  runtimeRole?: string | null
  scope?: string | null
  collaborationMode?: string | null
}): string {
  const role = row.runtimeRole ?? 'unknown'
  // Auxiliary requests own no session: an "unknown" placeholder would bury the
  // one label the user actually needs when asking "which model answered this?".
  const parts = [row.scope, row.collaborationMode].filter((part) => Boolean(part) && part !== 'unknown')
  return parts.length > 0 ? `${role} · ${parts.join(':')}` : role
}
