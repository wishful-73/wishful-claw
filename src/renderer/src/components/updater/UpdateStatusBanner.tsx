import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import type { RendererUpdateState, UpdatePhase } from '@shared/updater/types'
import { createUpdateProgressFormatter } from './update-progress'

interface UpdateStatusBannerProps {
  state: RendererUpdateState
  onShowDetails: () => void
  onInstall: () => Promise<void>
}

const VISIBLE_PHASES: readonly UpdatePhase[] = ['downloading', 'downloaded', 'error']

export function isUpdateBannerVisible(phase: UpdatePhase): boolean {
  return VISIBLE_PHASES.includes(phase)
}

// The banner shares the bottom-left corner with the toast stack, so the stack is lifted by this
// amount while the banner is up (24 from the bottom edge + ~58 banner + 8 gap). Both of the
// banner's text lines truncate, which is what keeps its height stable enough to hardcode.
export const UPDATE_BANNER_TOAST_BOTTOM = 90

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
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen)
  const leftSidebarWidth = useUIStore((s) => s.leftSidebarWidth)

  // All hooks run before the early return: a phase change must not change the hook order.
  const formatter = useMemo(
    () => createUpdateProgressFormatter(t('updater.progress.unknown', { defaultValue: '未知' })),
    [t]
  )
  const stats =
    phase === 'downloaded'
      ? t('updater.progress.completed', {
          bytes: formatter.transferredOfTotal(state),
          elapsed: formatter.elapsed(state.elapsedMs),
          defaultValue: '{{bytes}} · 已用 {{elapsed}}'
        })
      : t('updater.progress.stats', {
          bytes: formatter.transferredOfTotal(state),
          speed: formatter.speed(state.bytesPerSecond),
          elapsed: formatter.elapsed(state.elapsedMs),
          defaultValue: '{{bytes}} · 速度 {{speed}} · 已用 {{elapsed}}'
        })

  if (!isUpdateBannerVisible(phase)) return null

  const isError = phase === 'error'
  const isDownloaded = phase === 'downloaded'
  // leftSidebarWidth keeps its last value after the sidebar collapses, so the open flag has to be
  // checked too — otherwise a collapsed sidebar leaves an empty band between it and the banner.
  const bannerLeft = leftSidebarOpen ? leftSidebarWidth + 16 : 16

  return (
    <div
      role="status"
      style={{ left: bannerLeft }}
      className={cn(
        'fixed bottom-6 z-40 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
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
        ) : isError ? null : (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{stats}</p>
        )}
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
