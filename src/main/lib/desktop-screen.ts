/**
 * 屏幕矩形换算 —— 截图与输入两条线共用（S-272 第五点、第二段）。
 *
 * 单独成文件的理由：以前 `toPhysicalRect` 和 `isPointInsideDesktop` 长在
 * `desktop-control.ts` 里，只有点击校验在用。第二段起截图也要按物理像素裁窗口，
 * 再放回去就是「截图 import 输入模块」的怪形状。
 */

import { screen } from 'electron'

export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

type DisplayInfo = ReturnType<typeof screen.getAllDisplays>[number]

/**
 * DIP 矩形 → 物理像素矩形。
 *
 * **为什么必须有这一步**（S-272 ⑤）：点击坐标最后落到 robotjs 的 `SetCursorPos`，它要的是
 * 物理像素（Electron 主进程 per-monitor DPI aware）；而 `Display.bounds` 是 DIP。以前直接
 * 拿 DIP 边界去校验物理像素坐标，150% 缩放的屏上点右半边会被判「outside the desktop
 * bounds」。`docs/plans/iter-v2-23/plan-aux-window-placement/plan.md:28` 早就写过这条规矩，
 * 只是当年只约束了辅助窗口那条线。
 *
 * Electron 43 运行时提供 `screen.dipToScreenRect`，但类型声明里没有 ⇒ 能力检测 + 按
 * `scaleFactor` 回退（回退在混合 DPI 多屏下不精确，但比不换算强）。
 */
export function toPhysicalRect(display: DisplayInfo): PhysicalRect {
  const bounds = display.bounds
  const screenApi = screen as unknown as {
    dipToScreenRect?: (window: null, rect: Electron.Rectangle) => Electron.Rectangle
  }
  if (typeof screenApi.dipToScreenRect === 'function') {
    try {
      const rect = screenApi.dipToScreenRect(null, bounds)
      if (rect && Number.isFinite(rect.width) && rect.width > 0) {
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    } catch {
      // 能力检测通过、运行时抛错 —— 落到下面的换算分支，别让一次点击死在工具自身 API 上
    }
  }
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale)
  }
}

/** 所有屏幕物理像素的并集 —— 校验与报错共用，保证「说的话」和「判的界」是同一套。 */
export function getDesktopPhysicalBounds(): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  return screen.getAllDisplays().reduce(
    (acc, display) => {
      const rect = toPhysicalRect(display)
      return {
        minX: Math.min(acc.minX, rect.x),
        minY: Math.min(acc.minY, rect.y),
        maxX: Math.max(acc.maxX, rect.x + rect.width),
        maxY: Math.max(acc.maxY, rect.y + rect.height)
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
}

export function isPointInsideDesktop(x: number, y: number): boolean {
  const bounds = getDesktopPhysicalBounds()
  return x >= bounds.minX && x < bounds.maxX && y >= bounds.minY && y < bounds.maxY
}

export function describeDesktopBounds(): string {
  const bounds = getDesktopPhysicalBounds()
  if (!Number.isFinite(bounds.minX)) return 'unknown'
  return `(${bounds.minX},${bounds.minY})-(${bounds.maxX},${bounds.maxY})`
}

/**
 * 两块矩形的交集，空集返回 `null`。
 *
 * 用于「窗口在副屏上，但截图只截了主屏」这种局面 —— 硬裁会得到负宽或 0 宽，
 * 交给调用方当错误报出来，别让它变成一张 0×0 的 PNG。
 */
export function intersectRects(a: PhysicalRect, b: PhysicalRect): PhysicalRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}
