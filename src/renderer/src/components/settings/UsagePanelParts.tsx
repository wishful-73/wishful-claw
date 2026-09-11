import { cn } from '@renderer/lib/utils'
import type { UsageBucket } from './UsagePanel'

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  return `${(value / 1_000_000).toFixed(2)}M`
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

export function UsageSparkline({
  buckets,
  interval
}: {
  buckets: UsageBucket[]
  interval: 'hour' | 'day'
}): React.JSX.Element {
  const max = buckets.reduce((peak, b) => Math.max(peak, b.requestCount), 0)

  if (buckets.length === 0) {
    return <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">—</div>
  }

  return (
    <div className="flex h-32 items-end gap-[2px]">
      {buckets.map((bucket) => {
        const total = bucket.requestCount
        const errors = bucket.errorCount
        const totalPct = max === 0 ? 0 : (total / max) * 100
        const errorPct = total === 0 ? 0 : (errors / total) * 100

        return (
          <div
            key={bucket.bucketStart}
            className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${formatBucketLabel(bucket.bucketStart, interval)} · ${total} 次请求${
              errors > 0 ? `（${errors} 次失败）` : ''
            }`}
          >
            {total > 0 ? (
              <div
                className="relative w-full rounded-sm bg-primary/70 transition-colors group-hover:bg-primary"
                style={{ height: `${Math.max(totalPct, 2)}%` }}
              >
                {errors > 0 && (
                  <div
                    className="absolute inset-x-0 top-0 rounded-sm bg-destructive/80"
                    style={{ height: `${errorPct}%` }}
                  />
                )}
              </div>
            ) : (
              <div className="w-full rounded-sm bg-muted-foreground/20" style={{ height: 2 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border bg-background/60 px-3 py-2.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  )
}

export function RollupTable<
  T extends {
    requestCount: number
    errorCount: number
    billableInputTokens: number
    outputTokens: number
    totalCostUsd?: number | null
  }
>({
  rows,
  labelOf,
  subOf,
  emptyText
}: {
  rows: T[]
  labelOf: (row: T) => string
  subOf: (row: T) => string
  emptyText: string
}): React.JSX.Element {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
  }

  return (
    <table className="w-full text-left text-[12px]">
      <thead>
        <tr className="border-b text-[11px] text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">—</th>
          <th className="py-1.5 pr-3 text-right font-medium">请求</th>
          <th className="py-1.5 pr-3 text-right font-medium">输入</th>
          <th className="py-1.5 text-right font-medium">成本</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const sub = subOf(row)
          return (
            <tr key={`${labelOf(row)}-${index}`} className="border-b border-border/40 last:border-0">
              <td className="max-w-[180px] py-1.5 pr-3">
                <div className="truncate text-foreground">{labelOf(row)}</div>
                {sub && <div className="truncate text-[10px] text-muted-foreground/60">{sub}</div>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">
                {row.requestCount}
                {row.errorCount > 0 && (
                  <span className="ml-1 text-[10px] text-destructive">({row.errorCount})</span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {formatTokens(row.billableInputTokens)}
              </td>
              <td className={cn('py-1.5 text-right tabular-nums', row.totalCostUsd == null ? 'text-muted-foreground' : 'text-foreground')}>
                {formatCost(row.totalCostUsd)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
