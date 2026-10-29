/**
 * `window:capture-self` — screenshot the app's own window.
 *
 * Deliberately separate from `desktop:screenshot:capture`, which grabs the whole
 * desktop through desktopCapturer. That path photographs everything else on
 * screen too — browser tabs, chat windows, shell output — which is exactly the
 * noise the user guide's screenshot list warns about. When the subject is our own
 * UI, capturing the window directly is both cleaner and safer.
 *
 * Runs in the main process as a reverse-request from the Worker.
 */

import { screen } from 'electron'
import { getMainWindow } from '../../main-window-registry'
import { persistImageBuffer } from '../../lib/image-persist'

export interface WindowCaptureParams {
  /** Optional settle time before capturing, so an animation can finish. */
  delayMs?: number
  /** Write the PNG here. Relative paths resolve against `baseDir`. */
  targetPath?: string
  baseDir?: string
}

export interface WindowCaptureResult {
  success: boolean
  data?: string
  filePath?: string
  width?: number
  height?: number
  /**
   * 窗口内容区在**屏幕**上的位置，单位 DIP（`getContentBounds()` 的坐标系）。
   *
   * S-272 ①：以前只回尺寸不回位置，模型拿这张图完全没法换算成屏幕坐标 —— 它知道按钮
   * 「在窗口里的哪儿」，却不知道窗口「在屏幕的哪儿」，`DesktopClick` 据此永远点不准。
   * 点击要的是物理像素 ⇒ 同一条报文里给 scaleFactor，让模型自己乘。
   */
  bounds?: { x: number; y: number; width: number; height: number }
  /** 窗口所在显示器的缩放比。物理像素 = DIP × scaleFactor。 */
  scaleFactor?: number
  error?: string
}

const MAX_DELAY_MS = 5_000

function clampDelay(value: unknown): number {
  const delay = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.min(Math.max(Math.trunc(delay), 0), MAX_DELAY_MS)
}

export async function handleWindowCaptureSelf(
  params: Record<string, unknown>
): Promise<WindowCaptureResult> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return { success: false, error: 'Main window is not available.' }
  }
  if (win.isMinimized()) {
    return { success: false, error: 'Main window is minimized; restore it before capturing.' }
  }

  const typed = params as WindowCaptureParams

  const delayMs = clampDelay(typed.delayMs)
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  try {
    const image = await win.webContents.capturePage()
    if (image.isEmpty()) {
      return { success: false, error: 'Captured image is empty.' }
    }

    const size = image.getSize()
    const png = image.toPNG()
    const contentBounds = win.getContentBounds()
    const display = screen.getDisplayMatching(contentBounds)
    const result: WindowCaptureResult = {
      success: true,
      data: png.toString('base64'),
      width: size.width,
      height: size.height,
      bounds: {
        x: contentBounds.x,
        y: contentBounds.y,
        width: contentBounds.width,
        height: contentBounds.height
      },
      scaleFactor: display.scaleFactor > 0 ? display.scaleFactor : 1
    }

    const target = typeof typed.targetPath === 'string' ? typed.targetPath.trim() : ''
    if (target) {
      const persisted = persistImageBuffer(png, 'image/png', {
        targetPath: target,
        baseDir: typed.baseDir
      })
      result.filePath = persisted.filePath
    }

    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
