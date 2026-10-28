/**
 * 用量面板的通用陈列件：指标卡与汇总表。
 *
 * S-250 把图表的格式化、基元、折线图、柱状图分别搬到 `./usage/` 下，
 * 本文件保留 `StatCard` / `RollupTable`，并把原本由这里导出的名字全部 re-export，
 * 外部 import 路径与符号名零改动。
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { formatTokens } from '@renderer/lib/format-tokens'
import { formatCost } from './usage/format'

export type { UsageModelBucket, UsageModelSeries } from './usage/format'
export { formatAxisLabel, formatBucketLabel, formatCost, sourceLabel } from './usage/format'
export { UsageBarChart } from './usage/bar-chart'
export { UsageLineChart } from './usage/line-chart'

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center rounded-lg border bg-background/60 px-3 py-2.5 text-center">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums text-foreground">{value}</div>
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
    cacheReadTokens?: number
    cacheCreationTokens?: number
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
          <th className="py-1.5 pr-3 text-right font-medium">{t('usage.rollup.output', { defaultValue: '输出' })}</th>
          <th className="py-1.5 pr-3 text-right font-medium">{t('usage.rollup.cache', { defaultValue: '缓存' })}</th>
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
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {formatTokens(row.outputTokens)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {formatTokens((row.cacheReadTokens ?? 0) + (row.cacheCreationTokens ?? 0))}
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
