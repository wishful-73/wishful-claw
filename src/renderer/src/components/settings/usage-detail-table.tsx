import { useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Columns3, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { formatTokens, sourceLabel } from './UsagePanelParts'

export interface UsageLogRow {
  id: string
  sessionId?: string | null
  providerId?: string | null
  runtimeRole?: string | null
  scope?: string | null
  collaborationMode?: string | null
  modelId?: string | null
  providerType?: string | null
  status: string
  errorKind?: string | null
  errorMessage?: string | null
  httpStatusCode?: number | null
  attemptIndex: number
  totalAttempts?: number | null
  inputTokens: number
  billableInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalCostUsd?: number | null
  startedAt: number
  durationMs: number
}

type DetailColumn =
  | 'time'
  | 'model'
  | 'endpoint'
  | 'source'
  | 'input'
  | 'billableInput'
  | 'output'
  | 'cacheCreation'
  | 'reasoning'
  | 'duration'
  | 'cost'

const DETAIL_COLUMNS: Array<{
  id: DetailColumn
  labelKey?: string
  fallback: string
}> = [
  { id: 'time', labelKey: 'usage.detail.columns.time', fallback: '时间' },
  { id: 'model', labelKey: 'usage.detail.columns.model', fallback: '模型' },
  { id: 'endpoint', fallback: '请求地址' },
  { id: 'source', labelKey: 'usage.detail.columns.source', fallback: '来源' },
  { id: 'input', labelKey: 'usage.detail.columns.input', fallback: '原始输入' },
  {
    id: 'billableInput',
    labelKey: 'usage.detail.columns.billableInput',
    fallback: '计费输入'
  },
  { id: 'output', labelKey: 'usage.detail.columns.output', fallback: '输出' },
  {
    id: 'cacheCreation',
    labelKey: 'usage.detail.columns.cacheCreation',
    fallback: '缓存创建'
  },
  { id: 'reasoning', labelKey: 'usage.detail.columns.reasoning', fallback: '推理' },
  { id: 'duration', labelKey: 'usage.detail.columns.duration', fallback: '耗时' },
  { id: 'cost', labelKey: 'usage.detail.columns.cost', fallback: '成本' }
]

const DEFAULT_VISIBLE_COLUMNS: Record<DetailColumn, boolean> = {
  time: true,
  model: true,
  endpoint: true,
  source: true,
  input: true,
  billableInput: true,
  output: true,
  cacheCreation: true,
  reasoning: true,
  duration: true,
  cost: true
}

function formatCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function UsageDetailTable({
  rows,
  total,
  page,
  pageSize,
  loading,
  providerBaseUrlFor,
  onPageChange
}: {
  rows: UsageLogRow[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  providerBaseUrlFor: (providerId?: string | null) => string | undefined
  onPageChange: (page: number) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [visibleColumns, setVisibleColumns] =
    useState<Record<DetailColumn, boolean>>(DEFAULT_VISIBLE_COLUMNS)
  const visibleColumnCount = DETAIL_COLUMNS.filter((column) => visibleColumns[column.id]).length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const columnLabel = (column: (typeof DETAIL_COLUMNS)[number]): string =>
    column.labelKey ? t(column.labelKey, { defaultValue: column.fallback }) : column.fallback

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            >
              <Columns3 className="size-3.5" />
              {t('usage.detail.columns.select', { defaultValue: '显示列' })}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="px-2 py-1 text-xs">
              {t('usage.detail.columns.select', { defaultValue: '显示列' })}
            </DropdownMenuLabel>
            {DETAIL_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={visibleColumns[column.id]}
                disabled={visibleColumns[column.id] && visibleColumnCount === 1}
                onCheckedChange={(checked) =>
                  setVisibleColumns((current) => ({ ...current, [column.id]: checked === true }))
                }
                onSelect={(event) => event.preventDefault()}
                className="text-xs"
              >
                {columnLabel(column)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full min-w-max text-left text-[12px]">
          <thead>
            <tr className="border-b text-[11px] text-muted-foreground">
              {DETAIL_COLUMNS.map((column) =>
                visibleColumns[column.id] ? (
                  <th
                    key={column.id}
                    className={cn(
                      'whitespace-nowrap py-1.5 font-medium',
                      column.id === 'cost' ? 'text-right' : 'pr-3',
                      ['input', 'billableInput', 'output', 'cacheCreation', 'reasoning', 'duration'].includes(
                        column.id
                      ) && 'text-right'
                    )}
                  >
                    {columnLabel(column)}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody className={cn(loading && 'opacity-60')}>
            {rows.map((row) => {
              const failed = row.status === 'error'
              const baseUrl = providerBaseUrlFor(row.providerId)
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/40 last:border-0"
                  title={failed ? (row.errorMessage ?? row.errorKind ?? '') : undefined}
                >
                  {visibleColumns.time && (
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">
                      {formatTime(row.startedAt)}
                    </td>
                  )}
                  {visibleColumns.model && (
                    <td className="max-w-[140px] truncate py-1.5 pr-3 text-foreground">
                      {row.modelId ?? '—'}
                      {row.attemptIndex > 1 && (
                        <span className="ml-1 text-[10px] text-muted-foreground/60">
                          #{row.attemptIndex}
                        </span>
                      )}
                    </td>
                  )}
                  {visibleColumns.endpoint && (
                    <td
                      className="max-w-[260px] truncate py-1.5 pr-3 text-muted-foreground"
                      title={baseUrl}
                    >
                      {baseUrl ?? '—'}
                    </td>
                  )}
                  {visibleColumns.source && (
                    <td className="max-w-[140px] truncate py-1.5 pr-3 text-muted-foreground">
                      {sourceLabel(row)}
                    </td>
                  )}
                  {visibleColumns.input && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">
                      {formatTokens(row.inputTokens)}
                    </td>
                  )}
                  {visibleColumns.billableInput && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">
                      {formatTokens(row.billableInputTokens)}
                    </td>
                  )}
                  {visibleColumns.output && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">
                      {formatTokens(row.outputTokens)}
                    </td>
                  )}
                  {visibleColumns.cacheCreation && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.cacheCreationTokens)}
                    </td>
                  )}
                  {visibleColumns.reasoning && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.reasoningTokens)}
                    </td>
                  )}
                  {visibleColumns.duration && (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatDuration(row.durationMs)}
                    </td>
                  )}
                  {visibleColumns.cost && (
                    <td
                      className={cn(
                        'py-1.5 text-right tabular-nums',
                        failed ? 'text-destructive' : 'text-foreground'
                      )}
                    >
                      {failed ? (
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className="size-3" />
                          {row.errorKind ?? 'error'}
                        </span>
                      ) : (
                        formatCost(row.totalCostUsd)
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {loading && <Loader2 className="size-3 animate-spin" />}
          {t('usage.detail.pagination.summary', {
            defaultValue: '第 {{page}} / {{pageCount}} 页 · 共 {{total}} 条',
            page: page + 1,
            pageCount,
            total
          })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={loading || page === 0}
            onClick={() => onPageChange(page - 1)}
            title={t('usage.detail.pagination.previous', { defaultValue: '上一页' })}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={loading || page + 1 >= pageCount}
            onClick={() => onPageChange(page + 1)}
            title={t('usage.detail.pagination.next', { defaultValue: '下一页' })}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
