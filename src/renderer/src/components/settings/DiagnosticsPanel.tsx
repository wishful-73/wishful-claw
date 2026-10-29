/*
 * 资源与诊断（S-247 §5.4）。
 *
 * 这是「用户报内存高」时唯一可靠的输入 —— 不用开任务管理器、不用装工具、不用截图。
 * 数据 5 秒刷一次（和主进程采样节奏一致），同一批数字每 5 分钟落一条日志，
 * 所以「涨上来」这件事事后也能复盘。
 *
 * 这里**只有读数**：没有「清理内存」按钮。S-247 §7 明确不做自动回收，给个按钮
 * 只会让人以为问题解决了，而实际只是把数字短暂压下去。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, RefreshCw } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { MemorySnapshot } from '@shared/diagnostics-types'

/** 与主进程 `MEMORY_SAMPLE_INTERVAL_MS` 对齐。 */
const REFRESH_MS = 5_000
/** 与主进程告警阈值对齐（单进程 1.5 GB / Worker 托管堆 800 MB）。 */
const WARN_PROCESS_BYTES = 1_536 * 1024 * 1024
const WARN_WORKER_MANAGED_BYTES = 800 * 1024 * 1024

function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DiagnosticsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = (await ipcClient.invoke(IPC.DIAGNOSTICS_MEMORY)) as MemorySnapshot
      if (!mounted.current) return
      setSnapshot(result)
      setError(null)
    } catch (err) {
      if (!mounted.current) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load])

  const rows = snapshot?.processes ?? []
  const worker = snapshot?.worker ?? null
  const total = snapshot?.totalWorkingSetBytes ?? 0

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-8 pb-16 pt-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Activity className="size-5 text-muted-foreground" />
              {t('diagnostics.title', { defaultValue: '资源与诊断' })}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('diagnostics.subtitle', {
                defaultValue: '当前各进程的内存占用。每 5 秒刷新，同一批数字每 5 分钟写进日志。'
              })}
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            {t('diagnostics.refresh', { defaultValue: '刷新' })}
          </Button>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4">
          <span className="text-sm text-muted-foreground">
            {t('diagnostics.total', { defaultValue: '合计工作集' })}
          </span>
          <span className="text-lg font-semibold tabular-nums">{toMb(total)}</span>
          <span className="text-xs text-muted-foreground">
            {snapshot
              ? t('diagnostics.capturedAt', {
                  defaultValue: '取样 {{time}}',
                  time: new Date(snapshot.capturedAt).toLocaleTimeString()
                })
              : t('diagnostics.loading', { defaultValue: '正在读取…' })}
          </span>
          {snapshot && snapshot.warnings.length > 0 ? (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              {snapshot.warnings.join(' · ')}
            </Badge>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">
                  {t('diagnostics.colRole', { defaultValue: '进程' })}
                </th>
                <th className="px-4 py-2 text-left font-medium">PID</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('diagnostics.colWorkingSet', { defaultValue: '工作集' })}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('diagnostics.colPeak', { defaultValue: '峰值' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const hot = row.workingSetBytes >= WARN_PROCESS_BYTES
                return (
                  <tr key={row.pid} className="border-t border-border/50">
                    <td className="px-4 py-2">
                      <span className={hot ? 'text-destructive' : undefined}>
                        {t(`diagnostics.kind.${row.kind}`, { defaultValue: row.kind })}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.electronType}</span>
                    </td>
                    <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground">{row.pid}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${hot ? 'text-destructive' : ''}`}>
                      {toMb(row.workingSetBytes)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {toMb(row.peakWorkingSetBytes)}
                    </td>
                  </tr>
                )
              })}
              {worker ? (
                <tr className="border-t border-border/50 bg-muted/20">
                  <td className="px-4 py-2">
                    <span
                      className={
                        worker.managedBytes >= WARN_WORKER_MANAGED_BYTES ? 'text-destructive' : undefined
                      }
                    >
                      {t('diagnostics.kind.worker', { defaultValue: 'Worker' })}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('diagnostics.workerManaged', {
                        defaultValue: '托管堆 {{value}} · 堆 {{heap}} · 碎片 {{frag}}',
                        value: toMb(worker.managedBytes),
                        heap: toMb(worker.heapBytes),
                        frag: toMb(worker.fragmentedBytes)
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground">{worker.pid}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{toMb(worker.workingSetBytes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">—</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('diagnostics.hint', {
            defaultValue:
              '浏览器 webview 里的网页、以及显卡驱动自己占的内存不在这里 —— 那些由页面和系统决定。需要复盘「什么时候开始涨」请看日志里的 memory 行。'
          })}
        </p>
      </div>
    </div>
  )
}
