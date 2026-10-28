/**
 * 用量折线图。
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
      </div>
      <TimeAxisLabels buckets={buckets} interval={interval} />
      <ChartLegend series={series} />
    </div>
  )
}
