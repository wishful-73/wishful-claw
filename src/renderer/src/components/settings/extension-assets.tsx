/*
 * 扩展的运行文件（S-242 §4.6 层 1）。
 *
 * 「不点，一个字节都不下」是这条的硬约束 —— 所以这里只有按钮，没有自动下载。
 * 体积数字来自**主程序目录表**，不是插件自报：插件说 50 MB 实际下 5 GB 的事不能发生。
 *
 * 状态来源两路：进入时查一次（轻量，只查存在性 + 大小），之后靠主进程推的进度事件。
 * 不用定时器轮询 —— 下载几百 MB 时轮询的百分比是一格一格跳的。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Download, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import {
  cancelAsset,
  downloadAsset,
  fetchAssetStatuses,
  formatAssetSize,
  onAssetProgress,
  type PluginAssetProgressEvent,
  type PluginAssetStatus
} from '@renderer/lib/plugins/plugin-assets'
import type { ExtensionAssetDefinition } from '../../../../shared/extension-types'

interface ExtensionAssetsProps {
  assets: ExtensionAssetDefinition[]
  /** 卡片里用紧凑版：一行状态 + 一个按钮，不带进度条。 */
  compact?: boolean
}

const BUSY_STATES = new Set(['downloading', 'verifying'])

export function ExtensionAssets({ assets, compact = false }: ExtensionAssetsProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const ids = useMemo(() => assets.map((asset) => asset.id), [assets])
  const idsKey = ids.join('|')
  const [statuses, setStatuses] = useState<Record<string, PluginAssetStatus>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    void fetchAssetStatuses(ids)
      .then((list) => {
        if (cancelled) return
        const next: Record<string, PluginAssetStatus> = {}
        for (const status of list) next[status.id] = status
        setStatuses(next)
      })
      .catch((error) => {
        if (!cancelled) console.error('[plugin-assets] status failed', error)
      })
    return () => {
      cancelled = true
    }
    // idsKey 才是真正的依赖：数组每次渲染都是新引用，直接依赖会无限拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  useEffect(() => {
    const off = onAssetProgress((event: PluginAssetProgressEvent) => {
      if (!ids.includes(event.id)) return
      setStatuses((prev) => {
        const current = prev[event.id]
        return {
          ...prev,
          [event.id]: {
            id: event.id,
            state: event.state,
            name: current?.name,
            size: event.totalBytes > 0 ? event.totalBytes : current?.size,
            receivedBytes: event.receivedBytes,
            path: current?.path,
            error: event.error
          }
        }
      })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  if (assets.length === 0) return null

  const describe = (status: PluginAssetStatus | undefined): string => {
    const size = status?.size ? formatAssetSize(status.size) : ''
    switch (status?.state) {
      case 'ready':
        return `${t('extension.assets.stateReady')}${size ? ` · ${size}` : ''}`
      case 'downloading': {
        const received = status.receivedBytes ? formatAssetSize(status.receivedBytes) : ''
        const total = size || ''
        const progressText = received && total ? ` · ${received} / ${total}` : ''
        return `${t('extension.assets.stateDownloading')}${progressText}`
      }
      case 'verifying':
        return `${t('extension.assets.stateVerifying')}${size ? ` · ${size}` : ''}`
      case 'failed':
        return t('extension.assets.stateFailed')
      case 'unknown':
        return t('extension.assets.stateUnknown')
      default:
        return `${t('extension.assets.stateAbsent')}${size ? ` · ${t('extension.assets.needDownload', { size })}` : ''}`
    }
  }

  const stateIcon = (state: string | undefined): React.JSX.Element => {
    if (state === 'ready') return <CheckCircle2 className="size-3.5 text-emerald-600" />
    if (state === 'failed' || state === 'unknown') return <AlertCircle className="size-3.5 text-destructive" />
    if (state === 'downloading' || state === 'verifying') return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    return <Download className="size-3.5 text-muted-foreground" />
  }

  const start = async (id: string): Promise<void> => {
    setPending((prev) => ({ ...prev, [id]: true }))
    try {
      const result = await downloadAsset(id)
      if (!mounted.current) return
      setStatuses((prev) => ({ ...prev, [id]: { ...prev[id], ...result } }))
      if (result.state === 'ready') {
        toast.success(t('extension.assets.stateReady'))
      } else if (result.state === 'failed') {
        toast.error(result.error ?? t('extension.assets.stateFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (mounted.current) setPending((prev) => ({ ...prev, [id]: false }))
    }
  }

  const stop = async (id: string): Promise<void> => {
    try {
      await cancelAsset(id)
      if (!mounted.current) return
      setStatuses((prev) => ({
        ...prev,
        [id]: { ...prev[id], state: 'absent', receivedBytes: prev[id]?.receivedBytes ?? 0 }
      }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  if (compact) {
    // 卡片里只报「有没有、多大」，具体操作去详情页
    const missing = assets.filter((asset) => {
      const state = statuses[asset.id]?.state
      return state !== 'ready'
    })
    if (missing.length === 0) return null
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {missing.map((asset) => {
          const status = statuses[asset.id]
          return (
            <span key={asset.id} className="inline-flex items-center gap-1">
              {stateIcon(status?.state)}
              {status?.name ?? asset.id}
              <span>·</span>
              <span>{describe(status)}</span>
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t('extension.assets.title')}</h3>
        <p className="text-[11px] text-muted-foreground">{t('extension.assets.hint')}</p>
      </div>
      <div className="space-y-2">
        {assets.map((asset) => {
          const status = statuses[asset.id]
          const state = status?.state ?? 'absent'
          const busy = BUSY_STATES.has(state)
          const percent = status?.size && status.size > 0
            ? Math.min(100, Math.round((status.receivedBytes / status.size) * 100))
            : 0
          return (
            <div key={asset.id} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{status?.name ?? asset.id}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {stateIcon(state)}
                    <span>{describe(status)}</span>
                  </p>
                </div>
                {busy ? (
                  <Button size="sm" variant="outline" onClick={() => void stop(asset.id)}>
                    <X className="mr-1.5 size-3.5" />
                    {t('extension.assets.cancel')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={state === 'ready' ? 'ghost' : 'outline'}
                    disabled={state === 'ready' || state === 'unknown' || pending[asset.id]}
                    onClick={() => void start(asset.id)}
                  >
                    <Download className="mr-1.5 size-3.5" />
                    {state === 'failed'
                      ? t('extension.assets.retry')
                      : t('extension.assets.download')}
                  </Button>
                )}
              </div>
              {busy ? (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${state === 'verifying' ? 100 : percent}%` }}
                  />
                </div>
              ) : null}
              {state === 'failed' && status?.error ? (
                <p className="mt-1.5 text-[11px] text-destructive">{status.error}</p>
              ) : null}
              {state === 'absent' && status?.receivedBytes ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t('extension.assets.cancelHint')}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
