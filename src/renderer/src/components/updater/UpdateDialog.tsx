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
  const isInstalling = state.phase === 'installing'
  const isManualDistribution = !state.supportsAutoInstall
  const hasAvailableUpdate = Boolean(state.availableVersion)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('updater.dialog.title', { defaultValue: '应用更新' })}</DialogTitle>
          <DialogDescription>
            {state.phase === 'downloaded'
              ? t('updater.dialog.downloaded', { defaultValue: '更新已下载，确认后重启安装。' })
              : state.phase === 'error'
                ? state.error
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
                <span>{Math.round(state.progress ?? 0)}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.progress ?? 0)}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, state.progress ?? 0))}%` }}
                />
              </div>
            </div>
          ) : null}

          {state.phase === 'error' ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {state.error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onOpenReleasePage} disabled={!state.releaseUrl}>
            <ExternalLink className="size-4" />
            {t('updater.dialog.openRelease', { defaultValue: '打开发布页' })}
          </Button>

          {state.phase === 'downloaded' || isInstalling ? (
            <Button onClick={() => void onInstall()} disabled={isInstalling}>
              {isInstalling ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {isInstalling
                ? t('updater.dialog.installing', { defaultValue: '正在准备安装…' })
                : t('updater.dialog.install', { defaultValue: '立即重启安装' })}
            </Button>
          ) : isManualDistribution && hasAvailableUpdate ? (
            <Button onClick={onOpenReleasePage}>
              <ExternalLink className="size-4" />
              {t('updater.dialog.manualDownload', { defaultValue: '手动下载' })}
            </Button>
          ) : hasAvailableUpdate ? (
            <Button onClick={() => void onDownload()} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t('updater.dialog.download', { defaultValue: '下载更新' })}
            </Button>
          ) : (
            <Button onClick={() => void onCheck()} disabled={isChecking}>
              {isChecking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t('updater.dialog.checkAgain', { defaultValue: '重新检查' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
