/**
 * 桌面截图 —— 含可选的窗口裁剪与参照网格（S-272 第二段 · C/D）。
 *
 * 从 `desktop-control.ts` 拆出来的：那个文件原本 395 行，第二段要往里加网格、裁剪、
 * 相对坐标三件事，会顶到 500 行豁免线。拆的界线是「出图」与「输入」—— 截图这条线
 * 依赖 `desktopCapturer` / `nativeImage`，输入那条线依赖 robotjs，本来也没什么共用。
 */

import { desktopCapturer, nativeImage, screen } from 'electron'
import { persistImageBuffer } from '../lib/image-persist'
import { resolveDataDir } from '../lib/data-dir'
import { resolveScreenshotDir, screenshotFileNameFromBuffer } from '../lib/screenshot-dir'
import { paintScreenshotGrid } from '../lib/screenshot-grid'
import { intersectRects, toPhysicalRect, type PhysicalRect } from '../lib/desktop-screen'
import type { CaptureFrame } from '../lib/desktop-coordinate'

export const DESKTOP_SCREENSHOT_CAPTURE = 'desktop:screenshot:capture'

export interface DesktopScreenshotOptions {
  /** 模型显式要的落盘位置（worker 侧已解析成绝对路径）。 */
  targetPath?: string
  /** 叠加参照网格。默认关 —— 只在实际要数像素时开。 */
  grid?: boolean
  /** 只截这块屏幕物理像素矩形（`DesktopListWindows` 给的窗口矩形）。 */
  windowRect?: PhysicalRect | null
  /** 该窗口的标题，仅用于回报文本与错误信息。 */
  windowTitle?: string | null
}

export interface DesktopScreenshotResult {
  success: boolean
  error?: string
  width?: number
  height?: number
  originX?: number
  originY?: number
  /** 主屏缩放比。截图宽度 = bounds.width × scaleFactor，模型据此把图上的像素换算回 DIP。 */
  scaleFactor?: number
  displayCount?: number
  /** 每块屏的物理像素矩形 —— 多屏时模型才知道这张图对应哪一块（S-272 ①）。 */
  displays?: DesktopDisplayInfo[]
  /** 图被系统压过时（4K×2 的 `thumbnailSize` 上限）这里 < 1，相对坐标正好兜住。 */
  imageScale?: number
  /** 是否真的把网格画上去了。位图格式不符时会退化，不能让模型以为有刻度。 */
  gridApplied?: boolean
  /** 裁剪回报：实际截到的窗口矩形（物理像素）。 */
  windowTitle?: string
  windowRect?: PhysicalRect
  mediaType?: string
  data?: string
  /**
   * 这张截图落盘后的绝对路径（S-283）。
   *
   * 以前一个字节都不留盘，历史消息里的图想再看只能重新截 —— 而桌面早不是当时
   * 的样子。落盘之后，压缩把 image 块占位化（S-275）时模型还能按这条路径回读。
   */
  filePath?: string
}

export interface DesktopDisplayInfo {
  id: number
  primary: boolean
  /** 物理像素矩形，与截图坐标系一致。 */
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

/**
 * 最近一次成功截图的坐标系（物理像素）。`DesktopClick` / `DesktopScroll` 的相对坐标
 * 以它为参照 —— 模型说「图里 62% 处」，主进程得知道那是哪个原点、多大一张图。
 *
 * 纯内存、不落盘：进程重启就没了，那时模型也还没有这张图。
 */
let lastCaptureFrame: CaptureFrame | null = null

export function getLastCaptureFrame(): CaptureFrame | null {
  return lastCaptureFrame ? { ...lastCaptureFrame } : null
}

export async function captureDesktopScreenshot(
  options: DesktopScreenshotOptions = {}
): Promise<DesktopScreenshotResult> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const allDisplays = screen.getAllDisplays()
    const scaleFactor = primaryDisplay.scaleFactor
    const primaryPhysical = toPhysicalRect(primaryDisplay)
    const captureWidth = Math.round(primaryDisplay.bounds.width * scaleFactor)
    const captureHeight = Math.round(primaryDisplay.bounds.height * scaleFactor)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: captureWidth, height: captureHeight }
    })

    if (sources.length === 0) {
      return { success: false, error: 'No screen sources found.' }
    }

    const primarySource =
      sources.find((s) => s.display_id === String(primaryDisplay.id)) ?? sources[0]

    let image = primarySource.thumbnail
    const rawSize = image.getSize()
    if (rawSize.width <= 0 || rawSize.height <= 0) {
      return { success: false, error: 'Captured a screen with no pixels.' }
    }
    // 图片像素 / 物理像素。系统在 4K×2 上会把 thumbnailSize 压到上限，那时 < 1。
    const imageScale =
      primaryPhysical.width > 0 ? rawSize.width / primaryPhysical.width : 1

    let reportedRect: PhysicalRect | undefined
    // 裁剪矩形（图片像素空间）。不裁剪时就是整张图，下面算参照系统一走这条路径。
    let cropImageRect: PhysicalRect = {
      x: 0,
      y: 0,
      width: rawSize.width,
      height: rawSize.height
    }
    if (options.windowRect) {
      const requested = options.windowRect
      const visible = intersectRects(requested, primaryPhysical)
      if (!visible) {
        return {
          success: false,
          error:
            `Window "${options.windowTitle ?? ''}" is outside the primary display ` +
            `(${describeRect(primaryPhysical)} vs window ${describeRect(requested)}). ` +
            'Window capture only covers the primary display for now — capture the whole desktop instead.'
        }
      }

      const cropRect = clampRectToImage(
        {
          x: Math.round((visible.x - primaryPhysical.x) * imageScale),
          y: Math.round((visible.y - primaryPhysical.y) * imageScale),
          width: Math.round(visible.width * imageScale),
          height: Math.round(visible.height * imageScale)
        },
        rawSize
      )
      if (cropRect.width <= 0 || cropRect.height <= 0) {
        return {
          success: false,
          error: `Window "${options.windowTitle ?? ''}" has no visible pixels on the primary display.`
        }
      }

      image = image.crop(cropRect)
      cropImageRect = cropRect
      reportedRect = options.windowRect
    }

    const croppedSize = image.getSize()

    let gridApplied = false
    if (options.grid) {
      // 网格画在**裁剪后**的图上：刻度就是「这张图里的像素」，和模型数的位置同一套。
      // 位图长度对不上（缩放型 NativeImage）时宁可不画，也不写出越界的一行字。
      const bitmap = image.toBitmap()
      if (bitmap.length >= croppedSize.width * croppedSize.height * 4) {
        const painted = paintScreenshotGrid(bitmap, croppedSize.width, croppedSize.height)
        image = nativeImage.createFromBitmap(painted, {
          width: croppedSize.width,
          height: croppedSize.height
        })
        gridApplied = true
      }
    }

    const pngBuffer = image.toPNG()

    // S-283：落盘。base64 照旧随报文返回（模型要看得见图），但**同时**留一份在
    // 数据目录 —— 按内容哈希命名，同一帧重复捕获落到同一个文件，不涨盘。
    // S-268：`targetPath` 是模型显式要的位置（worker 侧已解析成绝对路径），给了就以它为准。
    const persisted = persistImageBuffer(pngBuffer, 'image/png', {
      targetPath: options.targetPath,
      defaultDir: resolveScreenshotDir(resolveDataDir(), new Date()),
      fileName: screenshotFileNameFromBuffer(pngBuffer)
    })

    // 相对坐标的参照系：裁剪后这张图在物理像素坐标系里的位置与尺寸。
    // 一律从 `cropImageRect` 推，不给裁剪分支单独记账 —— 两条路算出两套数字是这类
    // 代码最常见的错法（未裁剪时 cropImageRect 就是整张图，自然退化成主屏原点）。
    const safeImageScale = imageScale > 0 ? imageScale : 1
    lastCaptureFrame = {
      originX: primaryPhysical.x + cropImageRect.x / safeImageScale,
      originY: primaryPhysical.y + cropImageRect.y / safeImageScale,
      width: croppedSize.width / safeImageScale,
      height: croppedSize.height / safeImageScale
    }

    return {
      success: true,
      data: pngBuffer.toString('base64'),
      filePath: persisted.filePath,
      width: croppedSize.width,
      height: croppedSize.height,
      originX: lastCaptureFrame.originX,
      originY: lastCaptureFrame.originY,
      scaleFactor,
      displayCount: allDisplays.length,
      imageScale,
      gridApplied,
      windowTitle: options.windowTitle ?? undefined,
      windowRect: reportedRect,
      displays: allDisplays.map((display) => {
        const rect = toPhysicalRect(display)
        return {
          id: display.id,
          primary: display.id === primaryDisplay.id,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          scaleFactor: display.scaleFactor > 0 ? display.scaleFactor : 1
        }
      }),
      mediaType: 'image/png'
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function describeRect(rect: PhysicalRect): string {
  return `(${rect.x},${rect.y}) ${rect.width}x${rect.height}`
}

function clampRectToImage(
  rect: PhysicalRect,
  size: { width: number; height: number }
): PhysicalRect {
  const x = Math.max(0, Math.min(rect.x, size.width))
  const y = Math.max(0, Math.min(rect.y, size.height))
  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.width, size.width - x)),
    height: Math.max(0, Math.min(rect.height, size.height - y))
  }
}
