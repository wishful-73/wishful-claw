import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Download, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import type { RendererUpdateState } from '@shared/updater/types'
import { createUpdateProgressFormatter } from './update-progress'

interface UpdateIndicatorProps {
  state: RendererUpdateState
  onClick: () => void
}

/**
 * 顶栏更新图标 —— 取代原来左下角那块常驻浮块。
 *
 * 可见性判据是「手上还有没有一件待办的事」（有待下载的版本 / 已下载的包 / 一次失败），**不是相位**：
 * 点这个图标本身就会触发一次远端重查，相位会短暂变成 `checking`，若按相位判，图标会在用户点下去的
 * 瞬间从眼前消失。
 *
 * 没有关闭按钮，也不自动隐藏 —— 它替浮块承担的就是「状态看得见、够得着」这件事，能关掉等于把浮块
 * 的问题重做一遍。只在更新真正装完（相位与版本都归零）之后才消失。
 *
 * 图标必须在任何窗口宽度下都在：同类实现里有把顶栏指示写成 `hidden xl:inline-flex` 的，窄窗直接
 * 消失，这个坑不抄。
 */
export function isUpdateIndicatorVisible(state: RendererUpdateState): boolean {
  if (state.availableVersion !== null || state.downloadedVersion !== null) return true
  // 检查失败也要留痕：浮块没了以后，错误只剩 toast 闪一下。
  return state.phase === 'error'
}

export function UpdateIndicator({ state, onClick }: UpdateIndicatorProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  // 所有 hook 都排在提前返回之前 —— 相位一变就少跑一个 hook 会直接崩。
  const formatter = useMemo(
    () => createUpdateProgressFormatter(t('updater.progress.unknown', { defaultValue: '未知' })),
    [t]
  )

  if (!isUpdateIndicatorVisible(state)) return null

  const isError = state.phase === 'error'
  const isDownloaded = state.downloadedVersion !== null
  const isDownloading = !isError && !isDownloaded && state.phase === 'downloading'

  const label = isError
    ? t('updater.indicator.error', { defaultValue: '更新失败，点击查看' })
    : isDownloaded
      ? t('updater.indicator.downloaded', {
          version: state.downloadedVersion ?? '',
          defaultValue: '更新 {{version}} 已下载，点击查看'
        })
      : isDownloading
        ? state.percent === null
          ? t('updater.indicator.downloading', { defaultValue: '正在下载更新…' })
          : t('updater.indicator.downloadingPercent', {
              percent: formatter.percent(state.percent),
              defaultValue: '正在下载更新 {{percent}}'
            })
        : t('updater.indicator.available', {
            version: state.availableVersion ?? '',
            defaultValue: '发现新版本 {{version}}'
          })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            'titlebar-no-drag flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
            isError
              ? 'text-destructive'
              : 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
          )}
        >
          {isError ? (
            <CircleAlert className="size-4" />
          ) : isDownloaded ? (
            <CheckCircle2 className="size-4" />
          ) : isDownloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
