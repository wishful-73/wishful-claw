import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { RendererUpdateState } from '@shared/updater/types'

interface UpdateStatusBannerProps {
  state: RendererUpdateState
  onShowDetails: () => void
  onInstall: () => Promise<void>
}

/**
 * The details dialog is transient — it gets closed, the window gets hidden to the tray, the renderer
 * gets reloaded. This banner is the persistent in-app pointer back to Main's snapshot, so a download
 * running in the background or a package already on disk can never become invisible.
 *
 * It has no dismiss button on purpose. A dismissible banner would recreate the exact problem it
 * exists to solve: state the user can no longer see and no longer reach. When the whole window is
 * hidden, the tray "更新详情" entry is the recovery path instead.
 */
export function UpdateStatusBanner({
  state,
  onShowDetails,
  onInstall
}: UpdateStatusBannerProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const { phase } = state

  if (phase !== 'downloading' && phase !== 'downloaded' && phase !== 'error') return null

  const isError = phase === 'error'
  const isDownloaded = phase === 'downloaded'

  return (
    <div
      role="status"
      className={cn(
        'fixed right-4 bottom-4 z-40 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
        isError
          ? 'border-destructive/40 bg-destructive/10'
          : 'border-border bg-background'
      )}
    >
      {isError ? (
        <CircleAlert className="size-4 shrink-0 text-destructive" />
      ) : isDownloaded ? (
        <CheckCircle2 className="size-4 shrink-0 text-primary" />
      ) : (
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {isError
            ? t('updater.banner.error', { defaultValue: '更新失败' })
            : isDownloaded
              ? t('updater.banner.downloaded', {
                  version: state.downloadedVersion ?? '',
                  defaultValue: '更新 {{version}} 已下载，等待重启安装'
                })
              : t('updater.banner.downloading', { defaultValue: '正在后台下载更新…' })}
        </p>
        {isError && state.error ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{state.error}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isDownloaded ? (
          <Button size="sm" onClick={() => void onInstall()}>
            <RotateCcw className="size-3.5" />
            {t('updater.banner.install', { defaultValue: '重启安装' })}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onShowDetails}>
          {t('updater.banner.details', { defaultValue: '详情' })}
        </Button>
      </div>
    </div>
  )
}
