/**
 * 用量图表的基元：配色、坐标轴、悬浮提示、平滑路径、图例、时间轴与尺寸测量。
 *
 * S-250 从 `UsagePanelParts.tsx` 搬出，函数与 JSX 逐字平移。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import type { UsageBucket } from '../usage-panel-types'
import { formatAxisLabel, formatBucketLabel, type UsageModelSeries } from './format'

export const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
]

export function modelColor(index: number): string {
  return chartColors[index % chartColors.length]
}

export function modelSeriesLabel(item: UsageModelSeries): string {
  const provider = item.providerName ?? item.providerType ?? item.providerId ?? '未知服务商'
  return `${provider} · ${item.modelId}`
}

export function axisUpperBound(value: number): number {
  const safeValue = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  const normalized = safeValue / magnitude
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return niceNormalized * magnitude
}

export function ChartYAxis({
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

export function getHoveredBucketIndex(
  event: React.MouseEvent<SVGRectElement>,
  bucketCount: number
): number {
  const bounds = event.currentTarget.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
  return Math.min(bucketCount - 1, Math.max(0, Math.round(ratio * Math.max(bucketCount - 1, 1))))
}

export function ChartTooltip({
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
  // A centered (left-anchored, -50%) tooltip overflows the container near
  // either edge and gets clipped / triggers a scrollbar. Anchor the near edge
  // directly in those zones; only center in the middle range.
  const flipRight = left > 85
  const flipLeft = left < 15
  const centered = !flipRight && !flipLeft
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-2 z-10 min-w-[170px] rounded-md border border-border/80 bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-sm',
        centered && '-translate-x-1/2'
      )}
      style={
        flipRight
          ? { right: `${100 - left}%` }
          : { left: `${left}%` }
      }
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

export function smoothPath(points: { x: number; y: number }[]): string {
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

export function ChartLegend({ series }: { series: UsageModelSeries[] }): React.JSX.Element {
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

export function TimeAxisLabels({
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

/**
 * Measures the wrapper's real pixel size (ResizeObserver) so the SVG can build
 * its coordinate system at 1:1 scale. Drawing in a stretched viewBox
 * (preserveAspectRatio="none" over a fixed 800x320 grid) distorts glyphs and
 * circles whenever the container aspect ratio differs from 2.5:1.
 */
export function useMeasuredSize(): [
  React.RefObject<HTMLDivElement | null>,
  { width: number; height: number }
] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

/** Fixed 800x320 until the first real measurement lands (one frame). */
export const FALLBACK_SIZE = { width: 800, height: 320 }
export const CHART_PADDING = { top: 12, right: 8, bottom: 20, left: 48 }
