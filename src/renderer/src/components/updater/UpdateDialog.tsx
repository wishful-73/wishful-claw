import { useTranslation } from 'react-i18next'
import { Download, ExternalLink, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import type { RendererUpdateState } from '@shared/updater/types'
import { UpdateReleaseNotes } from './UpdateReleaseNotes'

interface UpdateDialogProps {
  state: RendererUpdateState
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => Promise<void>
  onInstall: () => Promise<void>
  onCheck: () => Promise<void>
  onOpenReleasePage: () => void
}

export function UpdateDialog({
  state,
  open,
  onOpenChange,
  onDownload,
  onInstall,
  onCheck,
  onOpenReleasePage
}: UpdateDialogProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const isChecking = state.phase === 'checking'
  const isDownloading = state.phase === 'downloading'
  const isDownloaded = state.phase === 'downloaded'
  const isInstalling = state.phase === 'installing'
  const isError = state.phase === 'error'
  const isManualDistribution = !state.supportsAutoInstall
  const hasAvailableUpdate = Boolean(state.availableVersion)
  const isFinished = isDownloaded || isInstalling

  // An error is reachable from a failed check, a failed download and a failed install, and each one
  // has a different retry. Guessing wrong leaves a dead end: re-downloading a package that is
  // already on disk is acknowledged instantly and installs nothing.
  const canRetryInstall =
    isError && state.downloadedVersion !== null && state.downloadedVersion === state.expectedVersion
  const canRetryDownload = isError && !canRetryInstall && Boolean(state.expectedVersion)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('updater.dialog.title', { defaultValue: '应用更新' })}</DialogTitle>
          <DialogDescription>
            {isError
              ? t('updater.dialog.errorTitle', { defaultValue: '更新失败' })
              : isDownloaded
                ? t('updater.dialog.downloaded', { defaultValue: '更新已下载，确认后重启安装。' })
                : hasAvailableUpdate
                  ? t('updater.dialog.available', { version: state.availableVersion, defaultValue: '发现新版本 {{version}}' })
                  : t('updater.dialog.description', { defaultValue: '检查 Wishful Claw 的最新版本。' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t('updater.dialog.currentVersion', { defaultValue: '当前版本' })}
            </span>
            <span className="font-medium">{state.currentVersion || '—'}</span>
          </div>

          {state.releaseNotes ? <UpdateReleaseNotes notes={state.releaseNotes} /> : null}

          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('updater.dialog.downloading', { defaultValue: '正在下载更新…' })}</span>
                {/* An unknown percent must not render as 0%: that reads as a stalled download. */}
                <span>
                  {state.percent === null
                    ? t('updater.dialog.percentUnknown', { defaultValue: '未知' })
                    : `${Math.round(state.percent)}%`}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.percent === null ? undefined : Math.round(state.percent)}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, state.percent ?? 0))}%` }}
                />
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  {t('updater.dialog.backgroundHint', {
                    defaultValue: '下载会在后台继续，关闭此窗口不会中断。'
                  })}
                </p>
                <p>
                  {t('updater.dialog.trayHint', {
                    defaultValue: '可随时从托盘“更新详情”查看进度。'
                  })}
                </p>
              </div>
            </div>
          ) : null}

          {isError && state.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {state.error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {/* The finished state keeps exactly two actions: the plan forbids anything here that could
              be mistaken for a way to postpone or replace the explicit restart. */}
          {isFinished ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('updater.dialog.later', { defaultValue: '稍后' })}
              </Button>
              <Button onClick={() => void onInstall()} disabled={isInstalling}>
                {isInstalling ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                {isInstalling
                  ? t('updater.dialog.installing', { defaultValue: '正在准备安装…' })
                  : t('updater.dialog.install', { defaultValue: '立即重启安装' })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onOpenReleasePage} disabled={!state.releaseUrl}>
                <ExternalLink className="size-4" />
                {t('updater.dialog.openRelease', { defaultValue: '打开发布页' })}
              </Button>

              {isDownloading ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('updater.dialog.later', { defaultValue: '稍后' })}
                </Button>
              ) : canRetryInstall ? (
                <Button onClick={() => void onInstall()}>
                  <RotateCcw className="size-4" />
                  {t('updater.dialog.retryInstall', { defaultValue: '重试安装' })}
                </Button>
              ) : canRetryDownload ? (
                <Button onClick={() => void onDownload()}>
                  <Download className="size-4" />
                  {t('updater.dialog.retry', { defaultValue: '重试' })}
                </Button>
              ) : isManualDistribution && hasAvailableUpdate ? (
                <Button onClick={onOpenReleasePage}>
                  <ExternalLink className="size-4" />
                  {t('updater.dialog.manualDownload', { defaultValue: '手动下载' })}
                </Button>
              ) : hasAvailableUpdate ? (
                <Button onClick={() => void onDownload()} disabled={isDownloading}>
                  <Download className="size-4" />
                  {t('updater.dialog.download', { defaultValue: '后台下载' })}
                </Button>
              ) : (
                <Button onClick={() => void onCheck()} disabled={isChecking}>
                  {isChecking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {isError
                    ? t('updater.dialog.retry', { defaultValue: '重试' })
                    : t('updater.dialog.checkAgain', { defaultValue: '重新检查' })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
