/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { desktopCapturer, screen } from 'electron'
import { createRequire } from 'module'
import { persistImageBuffer } from '../lib/image-persist'
import { resolveDataDir } from '../lib/data-dir'
import { resolveScreenshotDir, screenshotFileNameFromBuffer } from '../lib/screenshot-dir'

export const DESKTOP_SCREENSHOT_CAPTURE = 'desktop:screenshot:capture'
export const DESKTOP_INPUT_CLICK = 'desktop:input:click'
export const DESKTOP_INPUT_TYPE = 'desktop:input:type'
export const DESKTOP_INPUT_SCROLL = 'desktop:input:scroll'

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

export interface ClickArgs {
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  action?: 'click' | 'double_click' | 'down' | 'up'
}

export interface TypeArgs {
  text?: string | null
  key?: string | null
  hotkey?: string[] | null
}

export interface ScrollArgs {
  x?: number | null
  y?: number | null
  scrollX?: number | null
  scrollY?: number | null
}

const KEY_MAP: Record<string, string> = {
  Enter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Space: 'space',
  Control: 'control',
  Shift: 'shift',
  Alt: 'alt',
  Meta: 'command'
}

function resolveRobotKey(name: string): string | null {
  if (KEY_MAP[name]) return KEY_MAP[name]
  if (/^[a-zA-Z0-9]$/.test(name)) return name.toLowerCase()
  const fMatch = name.match(/^F([1-9]|1[0-2])$/)
  if (fMatch) return `f${fMatch[1]}`
  return null
}

const require = createRequire(import.meta.url)

type RobotJsModule = typeof import('@jitsi/robotjs')

let robotModule: RobotJsModule | null | undefined
let robotLoadError: string | null = null

function getRobot(): RobotJsModule | null {
  if (robotModule !== undefined) {
    return robotModule
  }

  try {
    robotModule = require('@jitsi/robotjs') as RobotJsModule
    robotLoadError = null
  } catch (error) {
    robotModule = null
    robotLoadError = error instanceof Error ? error.message : String(error)
    console.error('[DesktopControl] Failed to load @jitsi/robotjs:', error)
  }

  return robotModule
}

function getRobotUnavailableResult(): { success: false; error: string } {
  const reason = robotLoadError ? ` ${robotLoadError}` : ''
  return {
    success: false,
    error: `Desktop input is unavailable on this platform or build.${reason}`
  }
}

type DisplayInfo = ReturnType<typeof screen.getAllDisplays>[number]

interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

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
function toPhysicalRect(display: DisplayInfo): PhysicalRect {
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
function getDesktopPhysicalBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
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

function isPointInsideDesktop(x: number, y: number): boolean {
  const bounds = getDesktopPhysicalBounds()
  return x >= bounds.minX && x < bounds.maxX && y >= bounds.minY && y < bounds.maxY
}

function describeDesktopBounds(): string {
  const bounds = getDesktopPhysicalBounds()
  if (!Number.isFinite(bounds.minX)) return 'unknown'
  return `(${bounds.minX},${bounds.minY})-(${bounds.maxX},${bounds.maxY})`
}

export async function captureDesktopScreenshot(): Promise<DesktopScreenshotResult> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const allDisplays = screen.getAllDisplays()
    const scaleFactor = primaryDisplay.scaleFactor
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

    const pngBuffer = primarySource.thumbnail.toPNG()
    const actualSize = primarySource.thumbnail.getSize()

    // S-283：落盘。base64 照旧随报文返回（模型要看得见图），但**同时**留一份在
    // 数据目录 —— 按内容哈希命名，同一帧重复捕获落到同一个文件，不涨盘。
    const persisted = persistImageBuffer(pngBuffer, 'image/png', {
      defaultDir: resolveScreenshotDir(resolveDataDir(), new Date()),
      fileName: screenshotFileNameFromBuffer(pngBuffer)
    })

    return {
      success: true,
      data: pngBuffer.toString('base64'),
      filePath: persisted.filePath,
      width: actualSize.width,
      height: actualSize.height,
      originX: primaryDisplay.bounds.x,
      originY: primaryDisplay.bounds.y,
      scaleFactor,
      displayCount: allDisplays.length,
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

export function desktopInputClick(
  args: ClickArgs
): { success: true; x: number; y: number; button: string; action: string } | { success: false; error: string } {
  try {
    const robot = getRobot()
    if (!robot) return getRobotUnavailableResult()

    const x = Number(args.x)
    const y = Number(args.y)
    const button = args.button ?? 'left'
    const action = args.action ?? 'click'

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, error: 'Invalid click coordinates.' }
    }

    if (!isPointInsideDesktop(x, y)) {
      return {
        success: false,
        error: `Coordinate (${x}, ${y}) is outside the desktop bounds ${describeDesktopBounds()}.`
      }
    }

    robot.setMouseDelay(0)
    robot.moveMouse(Math.round(x), Math.round(y))

    if (action === 'double_click') {
      robot.mouseClick(button, true)
    } else if (action === 'down') {
      robot.mouseToggle('down', button)
    } else if (action === 'up') {
      robot.mouseToggle('up', button)
    } else {
      robot.mouseClick(button)
    }

    return { success: true, x, y, button, action }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function desktopInputType(
  args: TypeArgs
):
  | { success: true; mode: 'text'; textLength: number }
  | { success: true; mode: 'key'; key: string }
  | { success: true; mode: 'hotkey'; hotkey: string[] | null }
  | { success: false; error: string } {
  try {
    const robot = getRobot()
    if (!robot) return getRobotUnavailableResult()

    if (typeof args.text === 'string') {
      robot.setKeyboardDelay(0)
      robot.typeString(args.text)
      return { success: true, mode: 'text', textLength: args.text.length }
    }

    if (typeof args.key === 'string') {
      const resolved = resolveRobotKey(args.key)
      if (!resolved) {
        return { success: false, error: `Unsupported key: ${args.key}.` }
      }
      robot.keyTap(resolved)
      return { success: true, mode: 'key', key: args.key }
    }

    if (Array.isArray(args.hotkey) && args.hotkey.length > 1) {
      const resolvedKeys = args.hotkey.map(resolveRobotKey)
      const unsupported = args.hotkey.filter((_, i) => resolvedKeys[i] === null)
      if (unsupported.length > 0) {
        return { success: false, error: `Hotkey contains unsupported key name(s): ${unsupported.join(', ')}.` }
      }
      const keys = resolvedKeys as string[]
      const modifiers = keys.slice(0, -1)
      const mainKey = keys[keys.length - 1]
      robot.keyTap(mainKey, modifiers.length === 1 ? modifiers[0] : modifiers)
      return { success: true, mode: 'hotkey', hotkey: args.hotkey }
    }

    return { success: false, error: 'Desktop input requires text, key, or hotkey.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function desktopInputScroll(
  args: ScrollArgs
): { success: true; x?: number; y?: number; scrollX: number; scrollY: number } | { success: false; error: string } {
  try {
    const robot = getRobot()
    if (!robot) return getRobotUnavailableResult()

    const x = args.x == null ? null : Number(args.x)
    const y = args.y == null ? null : Number(args.y)
    const scrollX = Number(args.scrollX ?? 0)
    const scrollY = Number(args.scrollY ?? 0)

    if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY)) {
      return { success: false, error: 'Invalid scroll delta.' }
    }

    if (x !== null || y !== null) {
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { success: false, error: 'Invalid scroll anchor coordinates.' }
      }
      if (!isPointInsideDesktop(x, y)) {
        return {
          success: false,
          error: `Coordinate (${x}, ${y}) is outside the desktop bounds ${describeDesktopBounds()}.`
        }
      }
      robot.setMouseDelay(0)
      robot.moveMouse(Math.round(x), Math.round(y))
    }

    robot.scrollMouse(Math.round(scrollX), Math.round(scrollY))

    return { success: true, x: x ?? undefined, y: y ?? undefined, scrollX, scrollY }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
