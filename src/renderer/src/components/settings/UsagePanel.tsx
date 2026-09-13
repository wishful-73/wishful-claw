import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, BarChart3, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { SettingsSection } from '@renderer/components/settings/settings-primitives'
import { UsageDetailTable, type UsageLogRow } from './usage-detail-table'
import { cn } from '@renderer/lib/utils'
import { useProviderStore } from '@renderer/stores/provider-store'
import {
  formatTokens,
  RollupTable,
  sourceLabel,
  StatCard,
  UsageBarChart,
  UsageLineChart,
  type UsageModelSeries
} from './UsagePanelParts'

/**
 * Settings → Usage: request-level usage panel (#1, iteration 28).
 *
 * Data comes from the per-request log (one row per HTTP attempt), which is an
 * entirely separate statistic from the turn-level session usage shown in chat.
 * Nothing here reads the old session statistic.
 *
 * The three ranges are shorthand ('24h' / '7d' / '30d') resolved server-side, so
 * the client never has to agree with the worker on bucket boundaries. 24h buckets
 * hourly, 7d/30d bucket daily, and the worker gap-fills empty buckets — this
 * component can therefore draw the series as-is.
 */

type UsageRange = '24h' | '7d' | '30d'
type UsageChartTab = 'line' | 'bar' | 'stats'

interface UsageResponse {
  success: boolean
  error?: string | null
}

interface UsageOverview extends UsageResponse {
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

interface UsageBuckets extends UsageResponse {
  interval: 'hour' | 'day'
  from: number
  to: number
  buckets: UsageBucket[]
}

interface UsageModelBuckets extends UsageResponse {
  interval: 'hour' | 'day'
  from: number
  to: number
  series: UsageModelSeries[]
}

interface UsageModelRow {
  providerId?: string | null
  modelId: string
  providerType?: string | null
  requestCount: number
  errorCount: number
  billableInputTokens: number
  outputTokens: number
  totalCostUsd?: number | null
}

interface UsageSourceRow {
  runtimeRole?: string | null
  scope?: string | null
  collaborationMode?: string | null
  requestCount: number
  errorCount: number
  billableInputTokens: number
  outputTokens: number
  totalCostUsd?: number | null
}

const RANGES: { id: UsageRange; labelKey: string; fallback: string }[] = [
  { id: '24h', labelKey: 'usage.ranges.h24', fallback: '24 小时' },
  { id: '7d', labelKey: 'usage.ranges.d7', fallback: '7 天' },
  { id: '30d', labelKey: 'usage.ranges.d30', fallback: '30 天' }
]

const DETAIL_PAGE_SIZE = 20

/**
 * A missing cost renders as "—" rather than "$0.00": an unconfigured price means
 * the cost is unknown, and showing zero would imply the call was free.
 */
function formatCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface UsageLogsResponse extends UsageResponse {
  rows: UsageLogRow[]
  total: number
  offset: number
  limit: number
}

function requestUsageLogs(range: UsageRange, page: number): Promise<UsageLogsResponse> {
  return window.api.workerRequest<UsageLogsResponse>('db/usage-logs', {
    range,
    limit: DETAIL_PAGE_SIZE,
    offset: page * DETAIL_PAGE_SIZE
  })
}

export function UsagePanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((state) => state.providers)
  const [range, setRange] = useState<UsageRange>('24h')
  const [chartTab, setChartTab] = useState<UsageChartTab>('line')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<UsageOverview | null>(null)
  const [buckets, setBuckets] = useState<UsageBuckets | null>(null)
  const [modelBuckets, setModelBuckets] = useState<UsageModelBuckets | null>(null)
  const [byModel, setByModel] = useState<UsageModelRow[]>([])
  const [bySource, setBySource] = useState<UsageSourceRow[]>([])
  const [logs, setLogs] = useState<UsageLogRow[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(0)
  const [logsLoading, setLogsLoading] = useState(false)

  // Guards against stale range and detail-page responses overwriting newer data.
  const loadSeq = useRef(0)
  const logsLoadSeq = useRef(0)

  const load = useCallback(async (next: UsageRange, detailPage: number): Promise<void> => {
    const seq = ++loadSeq.current
    const detailSeq = ++logsLoadSeq.current
    setLoading(true)
    setLogsLoading(true)
    setError(null)
    try {
      const params = { range: next }
      const [ov, bk, mb, bm, bs, lg] = await Promise.all([
        window.api.workerRequest<UsageOverview>('db/usage-overview', params),
        window.api.workerRequest<UsageBuckets>('db/usage-buckets', {
          ...params,
          // Break daily bars at the viewer's midnight, not UTC midnight.
          timezoneOffsetMinutes: -new Date().getTimezoneOffset()
        }),
        window.api.workerRequest<UsageModelBuckets>('db/usage-model-buckets', {
          ...params,
          timezoneOffsetMinutes: -new Date().getTimezoneOffset()
        }),
        window.api.workerRequest<{ success: boolean; error?: string | null; rows: UsageModelRow[] }>(
          'db/usage-by-model',
          params
        ),
        window.api.workerRequest<{ success: boolean; error?: string | null; rows: UsageSourceRow[] }>(
          'db/usage-by-source',
          params
        ),
        requestUsageLogs(next, detailPage)
      ])
      if (seq !== loadSeq.current) return
      const failed = [ov, bk, mb, bm, bs, lg].find((response) => !response.success)
      if (failed) {
        throw new Error(failed.error || '用量统计请求失败')
      }
      setOverview(ov)
      setBuckets(bk)
      setModelBuckets(mb)
      setByModel(bm?.rows ?? [])
      setBySource(bs?.rows ?? [])
      if (detailSeq === logsLoadSeq.current) {
        setLogs(lg.rows)
        setLogsTotal(lg.total)
        setLogsPage(detailPage)
      }
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
      if (detailSeq === logsLoadSeq.current) setLogsLoading(false)
    }
  }, [])

  const loadLogsPage = useCallback(async (next: UsageRange, page: number): Promise<void> => {
    const seq = ++logsLoadSeq.current
    setLogsLoading(true)
    setError(null)
    try {
      let resolvedPage = Math.max(0, page)
      let response = await requestUsageLogs(next, resolvedPage)
      if (!response.success) throw new Error(response.error || '请求明细加载失败')

      const lastPage = Math.max(0, Math.ceil(response.total / DETAIL_PAGE_SIZE) - 1)
      if (resolvedPage > lastPage) {
        resolvedPage = lastPage
        response = await requestUsageLogs(next, resolvedPage)
        if (!response.success) throw new Error(response.error || '请求明细加载失败')
      }
      if (seq !== logsLoadSeq.current) return
      setLogs(response.rows)
      setLogsTotal(response.total)
      setLogsPage(resolvedPage)
    } catch (err) {
      if (seq !== logsLoadSeq.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === logsLoadSeq.current) setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    setLogsPage(0)
    void load(range, 0)
  }, [load, range])

  const isEmpty = overview != null && overview.requestCount === 0
  const providerFor = (providerId?: string | null) =>
    providerId ? providers.find((provider) => provider.id === providerId) : undefined
  const providerLabel = (providerId?: string | null, providerType?: string | null) =>
    providerFor(providerId)?.name ?? providerType ?? providerId ?? '未知服务商'
  const chartSeries = (modelBuckets?.series ?? []).map((series) => ({
    ...series,
    providerName: providerLabel(series.providerId, series.providerType)
  }))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-8 py-6">
        {/* Header: range switcher + refresh */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {t('usage.title', { defaultValue: '用量统计' })}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border bg-background/60 p-0.5">
              {RANGES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setRange(item.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                    range === item.id
                      ? 'bg-primary/10 font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(item.labelKey, { defaultValue: item.fallback })}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => void load(range, logsPage)}
              disabled={loading}
              title={t('usage.refresh', { defaultValue: '刷新' })}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : null}

        {/* Usage views */}
        <div className="space-y-3">
          <div className="flex items-center gap-1 rounded-lg border bg-background/60 p-1" role="tablist">
            {([
              ['line', '曲线图'],
              ['bar', '柱状图'],
              ['stats', '统计概览']
            ] as const).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={chartTab === id}
                onClick={() => setChartTab(id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-xs transition-colors',
                  chartTab === id
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {chartTab === 'stats' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCard
                label={t('usage.stats.requests', { defaultValue: '请求次数' })}
                value={String(overview?.requestCount ?? 0)}
                hint={
                  overview
                    ? t('usage.stats.outcomeSummary', {
                        success: overview.successCount,
                        error: overview.errorCount,
                        defaultValue: '{{success}} 成功 / {{error}} 失败'
                      }) +
                      (overview.retryCount > 0
                        ? t('usage.stats.retries', {
                            retryCount: overview.retryCount,
                            defaultValue: ' · {{retryCount}} 次重试'
                          })
                        : '')
                    : undefined
                }
              />
              <StatCard
                label={t('usage.stats.input', { defaultValue: '原始输入' })}
                value={formatTokens(overview?.inputTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.billableInput', { defaultValue: '计费输入' })}
                value={formatTokens(overview?.billableInputTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.output', { defaultValue: '输出' })}
                value={formatTokens(overview?.outputTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.cacheRead', { defaultValue: '缓存读取' })}
                value={formatTokens(overview?.cacheReadTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.cacheCreation', { defaultValue: '缓存创建' })}
                value={formatTokens(overview?.cacheCreationTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.reasoning', { defaultValue: '推理' })}
                value={formatTokens(overview?.reasoningTokens ?? 0)}
              />
              <StatCard
                label={t('usage.stats.cost', { defaultValue: '成本' })}
                value={formatCost(overview?.totalCostUsd)}
                hint={t('usage.stats.costHint', { defaultValue: '未配置价格则不计' })}
              />
              <StatCard
                label={t('usage.stats.avgDuration', { defaultValue: '平均耗时' })}
                value={formatDuration(overview?.avgDurationMs)}
              />
            </div>
          ) : (
            <SettingsSection
              id={`sec-usage-${chartTab}`}
              title={t('usage.chart.title', { defaultValue: '请求趋势' })}
              description={t('usage.chart.desc', {
                defaultValue: '按模型展示请求量，空时间段按 0 处理'
              })}
            >
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
                  <Activity className="size-5 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    {t('usage.empty', { defaultValue: '该时间范围内还没有请求记录' })}
                  </p>
                </div>
              ) : chartTab === 'line' ? (
                <UsageLineChart
                  buckets={buckets?.buckets ?? []}
                  series={chartSeries}
                  interval={buckets?.interval ?? 'hour'}
                />
              ) : (
                <UsageBarChart
                  buckets={buckets?.buckets ?? []}
                  series={chartSeries}
                  interval={buckets?.interval ?? 'hour'}
                />
              )}
            </SettingsSection>
          )}
        </div>

        {/* Per-model / per-source rollups */}
        {!isEmpty && (
          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsSection
              id="sec-usage-by-model"
              title={t('usage.byModel.title', { defaultValue: '按模型' })}
            >
              <RollupTable
                rows={byModel}
                labelOf={(row) => `${providerLabel(row.providerId, row.providerType)} · ${row.modelId}`}
                subOf={(row) => row.providerType ?? ''}
                emptyText={t('usage.byModel.empty', { defaultValue: '暂无数据' })}
              />
            </SettingsSection>
            <SettingsSection
              id="sec-usage-by-source"
              title={t('usage.bySource.title', { defaultValue: '按来源' })}
            >
              <RollupTable
                rows={bySource}
                labelOf={sourceLabel}
                subOf={() => ''}
                emptyText={t('usage.bySource.empty', { defaultValue: '暂无数据' })}
              />
            </SettingsSection>
          </div>
        )}

        {/* Detail lines */}
        {!isEmpty && (
          <SettingsSection
            id="sec-usage-detail"
            title={t('usage.detail.title', { defaultValue: '请求明细' })}
            description={t('usage.detail.count', {
              defaultValue: '共 {{total}} 条',
              total: logsTotal
            })}
          >
            <UsageDetailTable
              rows={logs}
              total={logsTotal}
              page={logsPage}
              pageSize={DETAIL_PAGE_SIZE}
              loading={logsLoading}
              providerBaseUrlFor={(providerId) => providerFor(providerId)?.baseUrl}
              onPageChange={(page) => void loadLogsPage(range, page)}
            />
          </SettingsSection>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          {t('usage.footnote', {
            defaultValue:
              '统计基于模型请求日志（每次 HTTP 请求一行，含重试与失败）。成本仅按模型显式配置的价格计算，未配置价格时留空。'
          })}
        </p>
      </div>
    </div>
  )
}
