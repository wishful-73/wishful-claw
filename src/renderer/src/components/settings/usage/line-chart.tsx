/**
 * 用量折线图。
 *
 * S-250 从 `UsagePanelParts.tsx` 搬出，JSX 与计算逐字平移。
 */

import { useState } from 'react'
import type { UsageBucket } from '../usage-panel-types'
import { type UsageModelSeries } from './format'
import {
  CHART_PADDING,
  ChartLegend,
  ChartTooltip,
  ChartYAxis,
  FALLBACK_SIZE,
  TimeAxisLabels,
  axisUpperBound,
  getHoveredBucketIndex,
  modelColor,
  modelSeriesLabel,
  smoothPath,
  useMeasuredSize
} from './chart-primitives'

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
  const [wrapRef, measured] = useMeasuredSize()
  const width = measured.width || FALLBACK_SIZE.width
  const height = measured.height || FALLBACK_SIZE.height
  const padding = CHART_PADDING
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
    <div className="flex min-h-64 flex-1 flex-col">
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full"
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
              {/*
                S-289：圆点只在光标所在的这一列出现。
                未交互时不画点 —— 系列数 × 桶数（默认 24 桶 × 3~5 个模型就是 72~120 个）
                会缀满整张图，而 r=2.5 正好等于 strokeWidth，读起来像一串珠子而不是趋势线。
                原先每点的 <title> 一并删掉：ChartTooltip 是列级的，hover 时已经把这一列
                所有系列的数据摆出来了，两份提示会同时弹出、互相遮挡。
              */}
              {hoveredBucket != null && item.buckets[hoveredBucket] && (
                <circle
                  cx={xOf(hoveredBucket)}
                  cy={yOf(item.buckets[hoveredBucket].requestCount)}
                  r="4"
                  fill={modelColor(seriesIndex)}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
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
      </div>
      <TimeAxisLabels buckets={buckets} interval={interval} />
      <ChartLegend series={series} />
    </div>
  )
}
