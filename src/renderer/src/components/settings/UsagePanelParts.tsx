import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { UsageBucket } from './UsagePanel'

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

const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
]

function modelColor(index: number): string {
  return chartColors[index % chartColors.length]
}

function modelSeriesLabel(item: UsageModelSeries): string {
  const provider = item.providerName ?? item.providerType ?? item.providerId ?? '未知服务商'
  return `${provider} · ${item.modelId}`
}

function axisUpperBound(value: number): number {
  const safeValue = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  const normalized = safeValue / magnitude
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return niceNormalized * magnitude
}

function ChartYAxis({
  width,
  height,
  padding,
  max
}: {
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
  max: number
}): React.JSX.Element {
  const chartHeight = height - padding.top - padding.bottom
  const tickCount = max <= 4 ? max : 4
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index)

  return (
    <g>
      {ticks.map((index) => {
        const ratio = index / tickCount
        const value = Math.round(max * ratio)
        const y = padding.top + chartHeight - chartHeight * ratio
        return (
          <g key={`tick-${index}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              className="stroke-border/60"
              strokeDasharray="3 5"
            />
            <text
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize="11"
            >
              {value}
            </text>
          </g>
        )
      })}
      <line
        x1={padding.left}
        x2={padding.left}
        y1={padding.top}
        y2={height - padding.bottom}
        className="stroke-border"
      />
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        className="stroke-border"
      />
      <title>{`纵轴范围 0-${max}`}</title>
    </g>
  )
}

function getHoveredBucketIndex(
  event: React.MouseEvent<SVGRectElement>,
  bucketCount: number
): number {
  const bounds = event.currentTarget.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
  return Math.min(bucketCount - 1, Math.max(0, Math.round(ratio * Math.max(bucketCount - 1, 1))))
}

function ChartTooltip({
  bucket,
  bucketIndex,
  series,
  interval,
  left
}: {
  bucket: UsageBucket
  bucketIndex: number
  series: UsageModelSeries[]
  interval: 'hour' | 'day'
  left: number
}): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[170px] -translate-x-1/2 rounded-md border border-border/80 bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-sm"
      style={{ left: `${left}%` }}
      role="status"
      aria-live="polite"
    >
      <div className="mb-1.5 border-b border-border/70 pb-1 font-medium">
        {formatAxisLabel(bucket.bucketStart, interval)}
      </div>
      <div className="space-y-1">
        {series.map((item, index) => (
          <div
            key={`${item.providerId ?? 'unknown'}-${item.modelId}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: modelColor(index) }}
              />
              <span className="max-w-[190px] truncate" title={modelSeriesLabel(item)}>
                {modelSeriesLabel(item)}
              </span>
            </span>
            <strong className="shrink-0 tabular-nums">{item.buckets[bucketIndex]?.requestCount ?? 0}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const following = points[index + 2] ?? next
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    }
    const control2 = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6
    }
    const minY = Math.min(current.y, next.y)
    const maxY = Math.max(current.y, next.y)
    control1.y = Math.min(maxY, Math.max(minY, control1.y))
    control2.y = Math.min(maxY, Math.max(minY, control2.y))
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`
  }
  return path
}

function ChartLegend({ series }: { series: UsageModelSeries[] }): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {series.map((item, index) => (
        <span
          key={`${item.providerId ?? 'unknown'}-${item.modelId}`}
          className="inline-flex max-w-full items-center gap-1.5"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: modelColor(index) }}
          />
          <span className="max-w-[260px] truncate" title={modelSeriesLabel(item)}>
            {modelSeriesLabel(item)}
          </span>
        </span>
      ))}
    </div>
  )
}

function TimeAxisLabels({
  buckets,
  interval
}: {
  buckets: UsageBucket[]
  interval: 'hour' | 'day'
}): React.JSX.Element {
  return (
    <div
      className="grid text-center text-[9px] text-muted-foreground/60"
      style={{ gridTemplateColumns: `repeat(${Math.max(buckets.length, 1)}, minmax(0, 1fr))` }}
    >
      {buckets.map((bucket) => (
        <span
          key={bucket.bucketStart}
          className="truncate px-0.5"
          title={formatAxisLabel(bucket.bucketStart, interval)}
        >
          {formatBucketLabel(bucket.bucketStart, interval)}
        </span>
      ))}
    </div>
  )
}

export function UsageLineChart({
  buckets,
  series,
  interval
}: {
  buckets: UsageBucket[]
  series: UsageModelSeries[]
  interval: 'hour' | 'day'
}): React.JSX.Element {
  const dataMax = Math.max(
    0,
    ...series.flatMap((item) => item.buckets.map((bucket) => bucket.requestCount))
  )
  const max = axisUpperBound(dataMax)
  const width = 800
  const height = 320
  const padding = { top: 12, right: 8, bottom: 20, left: 48 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const xOf = (index: number): number =>
    padding.left + (index / Math.max(buckets.length - 1, 1)) * chartWidth
  const yOf = (value: number): number => padding.top + chartHeight - (value / max) * chartHeight
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null)
  const hoveredBucketData = hoveredBucket == null ? null : buckets[hoveredBucket]
  const tooltipLeft =
    hoveredBucket == null ? 50 : (hoveredBucket / Math.max(buckets.length - 1, 1)) * 100

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-80 w-full overflow-visible"
        role="img"
        aria-label="按模型请求趋势"
        preserveAspectRatio="none"
      >
        <ChartYAxis width={width} height={height} padding={padding} max={max} />
        {series.map((item, seriesIndex) => {
          const points = buckets.map((_, bucketIndex) => {
            const value = item.buckets[bucketIndex]?.requestCount ?? 0
            return { x: xOf(bucketIndex), y: yOf(value) }
          })
          return (
            <g key={`${item.providerId ?? 'unknown'}-${item.modelId}`}>
              <title>{modelSeriesLabel(item)}</title>
              <path
                d={smoothPath(points)}
                fill="none"
                stroke={modelColor(seriesIndex)}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {item.buckets.map((bucket, bucketIndex) => (
                <circle
                  key={`${item.providerId ?? 'unknown'}-${item.modelId}-${bucket.bucketStart}`}
                  cx={xOf(bucketIndex)}
                  cy={yOf(bucket.requestCount)}
                  r={hoveredBucket === bucketIndex ? '4' : '2.5'}
                  fill={modelColor(seriesIndex)}
                  opacity={hoveredBucket === bucketIndex ? 1 : 0.72}
                  stroke={hoveredBucket === bucketIndex ? 'var(--background)' : undefined}
                  strokeWidth={hoveredBucket === bucketIndex ? 1.5 : undefined}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {`${modelSeriesLabel(item)} · ${formatBucketLabel(bucket.bucketStart, interval)} · ${bucket.requestCount} 次请求`}
                  </title>
                </circle>
              ))}
            </g>
          )
        })}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={(event) => setHoveredBucket(getHoveredBucketIndex(event, buckets.length))}
          onMouseLeave={() => setHoveredBucket(null)}
        />
      </svg>
      {hoveredBucketData && (
        <ChartTooltip
          bucket={hoveredBucketData}
          bucketIndex={hoveredBucket ?? 0}
          series={series}
          interval={interval}
          left={tooltipLeft}
        />
      )}
      <TimeAxisLabels buckets={buckets} interval={interval} />
      <ChartLegend series={series} />
    </div>
  )
}

export function UsageBarChart({
  buckets,
  series,
  interval
}: {
  buckets: UsageBucket[]
  series: UsageModelSeries[]
  interval: 'hour' | 'day'
}): React.JSX.Element {
  const dataMax = Math.max(
    0,
    ...series.flatMap((item) => item.buckets.map((bucket) => bucket.requestCount))
  )
  const max = axisUpperBound(dataMax)
  const width = 800
  const height = 320
  const padding = { top: 12, right: 8, bottom: 20, left: 48 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const groupWidth = chartWidth / Math.max(buckets.length, 1)
  const barWidth = Math.max(1, (groupWidth / Math.max(series.length, 1)) * 0.72)
  const yOf = (value: number): number => padding.top + chartHeight - (value / max) * chartHeight
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null)
  const hoveredBucketData = hoveredBucket == null ? null : buckets[hoveredBucket]
  const tooltipLeft =
    hoveredBucket == null ? 50 : ((hoveredBucket + 0.5) / Math.max(buckets.length, 1)) * 100

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-80 w-full overflow-visible"
        role="img"
        aria-label="按模型请求量柱状图"
        preserveAspectRatio="none"
      >
        <ChartYAxis width={width} height={height} padding={padding} max={max} />
        {buckets.map((bucket, bucketIndex) =>
          series.map((item, seriesIndex) => {
            const value = item.buckets[bucketIndex]?.requestCount ?? 0
            const heightValue = (value / max) * chartHeight
            return (
              <rect
                key={`${item.providerId ?? 'unknown'}-${item.modelId}-${bucket.bucketStart}`}
                x={padding.left + bucketIndex * groupWidth + seriesIndex * (groupWidth / Math.max(series.length, 1)) + (groupWidth / Math.max(series.length, 1) - barWidth) / 2}
                y={yOf(value)}
                width={barWidth}
                height={heightValue}
                rx="1.5"
                fill={modelColor(seriesIndex)}
                opacity={hoveredBucket === bucketIndex ? 1 : 0.82}
              >
                <title>
                  {`${modelSeriesLabel(item)} · ${formatBucketLabel(bucket.bucketStart, interval)} · ${value} 次请求`}
                </title>
              </rect>
            )
          })
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={(event) => setHoveredBucket(getHoveredBucketIndex(event, buckets.length))}
          onMouseLeave={() => setHoveredBucket(null)}
        />
      </svg>
      {hoveredBucketData && (
        <ChartTooltip
          bucket={hoveredBucketData}
          bucketIndex={hoveredBucket ?? 0}
          series={series}
          interval={interval}
          left={tooltipLeft}
        />
      )}
      <TimeAxisLabels buckets={buckets} interval={interval} />
      <ChartLegend series={series} />
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
  const { t } = useTranslation('settings')
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
  }

  return (
    <table className="w-full text-left text-[12px]">
      <thead>
        <tr className="border-b text-[11px] text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">—</th>
          <th className="py-1.5 pr-3 text-right font-medium">{t('usage.rollup.requests', { defaultValue: '请求' })}</th>
          <th className="py-1.5 pr-3 text-right font-medium">{t('usage.rollup.input', { defaultValue: '输入' })}</th>
          <th className="py-1.5 text-right font-medium">{t('usage.rollup.cost', { defaultValue: '成本' })}</th>
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
