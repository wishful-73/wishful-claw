/**
 * 用量柱状图。
 *
 * S-250 从 `UsagePanelParts.tsx` 搬出，JSX 与计算逐字平移。
 */

import { useState } from 'react'
import type { UsageBucket } from '../usage-panel-types'
import { formatBucketLabel, type UsageModelSeries } from './format'
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
  useMeasuredSize
} from './chart-primitives'

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
  const [wrapRef, measured] = useMeasuredSize()
  const width = measured.width || FALLBACK_SIZE.width
  const height = measured.height || FALLBACK_SIZE.height
  const padding = CHART_PADDING
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
    <div className="flex min-h-64 flex-1 flex-col">
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full"
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
      </div>
      <TimeAxisLabels buckets={buckets} interval={interval} />
      <ChartLegend series={series} />
    </div>
  )
}
