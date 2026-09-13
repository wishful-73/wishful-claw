import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type {
  RendererUpdateState,
  UpdateBannerPosition,
  UpdatePhase
} from '@shared/updater/types'
import { createUpdateProgressFormatter } from './update-progress'
import {
  clampUpdateBannerPosition,
  placedBannerStyle,
  type BannerSize,
  type BannerViewport
} from './banner-position'

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
 * The lift exists because the banner's default corner *is* the toast corner. Once the banner has
 * been dragged somewhere the user picked, lifting the toasts for it would move them out of their
 * own corner for no reason — so the lift follows the banner's default placement, not its presence.
 */
export function shouldLiftToastsForBanner(
  phase: UpdatePhase,
  position: UpdateBannerPosition | null
): boolean {
  return isUpdateBannerVisible(phase) && position === null
}

/** A press must travel this far before it counts as a drag rather than a click on the banner. */
const DRAG_THRESHOLD_PX = 3

/** Anything interactive inside the banner keeps its own click; pressing it must not start a drag. */
const DRAG_IGNORE_SELECTOR = 'button, a, input, select, textarea, [data-banner-no-drag]'

interface BannerDrag {
  pointerId: number
  startX: number
  startY: number
  /** Pointer offset inside the banner at grab time, so it does not jump under the cursor. */
  grabX: number
  grabY: number
  size: BannerSize
  moved: boolean
  /** Latest clamped position; the drop commits this rather than recomputing from the event. */
  latest: UpdateBannerPosition | null
}

function readViewport(): BannerViewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * The details dialog is transient — it gets closed, the window gets hidden to the tray, the renderer
 * gets reloaded. This banner is the persistent in-app pointer back to Main's snapshot, so a download
 * running in the background or a package already on disk can never become invisible.
 *
 * It has no dismiss button on purpose. A dismissible banner would recreate the exact problem it
 * exists to solve: state the user can no longer see and no longer reach. When the whole window is
 * hidden, the tray "更新详情" entry is the recovery path instead.
 *
 * It is draggable for the same reason it cannot be dismissed: it has to live somewhere the user can
 * tolerate for the length of a download, and no single corner suits every layout. Until it is
 * dragged it stays anchored (bottom-left, following the sidebar); after that the placed position
 * wins and is persisted, so the window no longer gets to move it.
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
  const persistedPosition = useSettingsStore((s) => s.updateBannerPosition)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const bannerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<BannerDrag | null>(null)
  // The live position during a drag. Persisting on every pointermove would push an IPC write — and
  // then a settings-file write in Main — per frame, so the drag stays local and only the drop saves.
  const [dragPosition, setDragPosition] = useState<UpdateBannerPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [viewport, setViewport] = useState<BannerViewport>(readViewport)
  // Read before the effects so the repair below can tell "not on screen yet" from "no position":
  // without it in the deps, a position that only becomes off-viewport once the banner appears
  // (phase idle → downloading) would never get repaired.
  const bannerVisible = isUpdateBannerVisible(phase)

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

  useEffect(() => {
    const onResize = (): void => setViewport(readViewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // A position restored from a previous session can be off-viewport: it was dragged on a larger
  // window, or the window has been shrunk since. Repair the *rendered* position only — the stored
  // one is deliberately left alone, so a window that grows back puts the banner back where it was
  // chosen instead of at a bound some smaller window imposed on it.
  useEffect(() => {
    if (!bannerVisible || persistedPosition === null) return
    // A drag in progress owns the position; it clamps every move itself.
    if (dragRef.current) return
    const element = bannerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const clamped = clampUpdateBannerPosition(persistedPosition, viewport, {
      width: rect.width,
      height: rect.height
    })
    setDragPosition((current) =>
      current && current.left === clamped.left && current.top === clamped.top ? current : clamped
    )
  }, [bannerVisible, persistedPosition, viewport])

  if (!bannerVisible) return null

  const isError = phase === 'error'
  const isDownloaded = phase === 'downloaded'
  // leftSidebarWidth keeps its last value after the sidebar collapses, so the open flag has to be
  // checked too — otherwise a collapsed sidebar leaves an empty band between it and the banner.
  const bannerLeft = leftSidebarOpen ? leftSidebarWidth + 16 : 16
  // A hand-placed position takes over from the anchored corner for good.
  const activePosition = dragPosition ?? persistedPosition

  const positionFromPointer = (
    clientX: number,
    clientY: number,
    drag: BannerDrag
  ): UpdateBannerPosition =>
    clampUpdateBannerPosition(
      { left: clientX - drag.grabX, top: clientY - drag.grabY },
      viewport,
      drag.size
    )

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest(DRAG_IGNORE_SELECTOR)) return
    // A second finger must not take the banner away from the drag already in progress.
    if (dragRef.current) return
    const element = e.currentTarget
    const rect = element.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      size: { width: rect.width, height: rect.height },
      moved: false,
      latest: null
    }
    element.setPointerCapture(e.pointerId)
    // Suppresses the text selection a press-and-move on a status region would otherwise start.
    e.preventDefault()
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX
    ) {
      return
    }
    const next = positionFromPointer(e.clientX, e.clientY, drag)
    drag.moved = true
    drag.latest = next
    setIsDragging(true)
    setDragPosition(next)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setIsDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // A press that never crossed the threshold is a click on the banner, not a move.
    if (!drag.moved || !drag.latest) return
    setDragPosition(drag.latest)
    updateSettings({ updateBannerPosition: drag.latest })
  }

  return (
    <div
      ref={bannerRef}
      role="status"
      title={t('updater.banner.dragHint', { defaultValue: '按住可拖动' })}
      style={activePosition ? placedBannerStyle(activePosition, viewport) : { left: bannerLeft }}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'fixed bottom-6 z-40 flex max-w-sm touch-none items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
        isDragging ? 'cursor-grabbing select-none' : 'cursor-grab',
        isError ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-background'
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
