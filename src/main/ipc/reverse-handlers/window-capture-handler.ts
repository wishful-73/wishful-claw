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
    const result: WindowCaptureResult = {
      success: true,
      data: png.toString('base64'),
      width: size.width,
      height: size.height
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
