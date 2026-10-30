/*
 * 已下载的运行文件（S-244 §4.2 独立清理入口）。
 *
 * 为什么需要这一块：卸载插件**不删**共享资产（装一次多插件共用，也没法判断还有谁在用）。
 * 代价就是可能留着几百 MB 到 1 GB 的垃圾 —— 那就必须有一个看得见、删得掉的地方，
 * 否则本号就是在造新的垃圾堆。
 *
 * 这里只列「已就绪」的资产：没下载的东西不占磁盘，列出来只会让人以为占了空间。
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDriveDownload, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import {
  fetchAssetCatalog,
  fetchAssetStatuses,
  formatAssetSize,
  onAssetProgress,
  removeAsset,
  type PluginAssetPublicInfo,
  type PluginAssetStatus
} from '@renderer/lib/plugins/plugin-assets'

interface ReadyAsset {
  id: string
  name: string
  size: number
}

export function PluginAssetsStorage(): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const [catalog, setCatalog] = useState<PluginAssetPublicInfo[]>([])
  const [statuses, setStatuses] = useState<Record<string, PluginAssetStatus>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const entries = await fetchAssetCatalog()
      setCatalog(entries)
      const list = await fetchAssetStatuses(entries.map((entry) => entry.id))
      const next: Record<string, PluginAssetStatus> = {}
      for (const status of list) next[status.id] = status
      setStatuses(next)
    } catch (error) {
      console.error('[plugin-assets] storage refresh failed', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 下载完 / 删完都靠主进程推送回来，不轮询
  useEffect(() => {
    return onAssetProgress((event) => {
      setStatuses((prev) => ({
        ...prev,
        [event.id]: {
          id: event.id,
          state: event.state,
          name: prev[event.id]?.name,
          size: event.totalBytes > 0 ? event.totalBytes : prev[event.id]?.size,
          receivedBytes: event.receivedBytes,
          path: prev[event.id]?.path,
          error: event.error
        }
      }))
      if (event.state === 'ready') void refresh()
    })
  }, [refresh])

  const ready: ReadyAsset[] = catalog
    .map((entry) => ({ id: entry.id, name: entry.name, size: statuses[entry.id]?.size ?? entry.size }))
    .filter((entry) => statuses[entry.id]?.state === 'ready')

  const totalBytes = ready.reduce((sum, entry) => sum + entry.size, 0)

  const drop = async (target: ReadyAsset): Promise<void> => {
    const ok = await confirm({
      title: t('extension.storage.removeConfirm', {
        defaultValue: '确定删除这个运行文件？正在使用它的插件将无法运行。'
      }),
      description: target.name,
      variant: 'destructive'
    })
    if (!ok) return
    setBusy(target.id)
    try {
      await removeAsset(target.id)
      setStatuses((prev) => ({
        ...prev,
        [target.id]: { ...prev[target.id], id: target.id, state: 'absent', receivedBytes: 0 }
      }))
      toast.success(t('extension.storage.removed', { defaultValue: '已删除' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const dropAll = async (): Promise<void> => {
    const ok = await confirm({
      title: t('extension.storage.removeAllConfirm', {
        defaultValue: '确定删除全部已下载的运行文件？正在使用它们的插件将无法运行。'
      }),
      description: t('extension.storage.total', {
        defaultValue: '共 {{size}}',
        size: formatAssetSize(totalBytes)
      }),
      variant: 'destructive'
    })
    if (!ok) return
    setBusy('*')
    try {
      for (const entry of ready) await removeAsset(entry.id)
      await refresh()
      toast.success(t('extension.storage.removed', { defaultValue: '已删除' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
        <Loader2 className="mr-2 inline size-3.5 animate-spin" />
        {t('extension.storage.loading', { defaultValue: '正在统计…' })}
      </div>
    )
  }
  if (ready.length === 0) return null

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <HardDriveDownload className="size-4 text-muted-foreground" />
          {t('extension.storage.title', { defaultValue: '已下载的运行文件' })}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t('extension.storage.total', {
              defaultValue: '共 {{size}}',
              size: formatAssetSize(totalBytes)
            })}
          </span>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void dropAll()}>
            {t('extension.storage.removeAll', { defaultValue: '全部清理' })}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('extension.storage.hint', {
          defaultValue: '这些文件由主程序托管，多个插件共用，卸载插件不会删除。'
        })}
      </p>
      <div className="space-y-1.5">
        {ready.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{entry.name}</p>
              <p className="truncate text-xs text-muted-foreground">{entry.id}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{formatAssetSize(entry.size)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void drop(entry)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
