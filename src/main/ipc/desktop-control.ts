/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { createRequire } from 'module'
import {
  describeDesktopBounds,
  isPointInsideDesktop
} from '../lib/desktop-screen'
import { resolveCoordinatePair } from '../lib/desktop-coordinate'
import { getLastCaptureFrame } from './desktop-screenshot'

export const DESKTOP_INPUT_CLICK = 'desktop:input:click'
export const DESKTOP_INPUT_TYPE = 'desktop:input:type'
export const DESKTOP_INPUT_SCROLL = 'desktop:input:scroll'

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

/**
 * 点击。
 *
 * S-272 第二段：x/y 支持**相对坐标** —— 两个值都落在 0~1、且至少一个是小数时，按「最近
 * 一次截图里的比例」解释，用它乘那张图的物理尺寸再加原点（判定规则见
 * `lib/desktop-coordinate.ts`）。图被上游怎么缩放都不影响落点，整数仍按绝对像素走，
 * 与改动前完全一致。
 */
export function desktopInputClick(
  args: ClickArgs
):
  | { success: true; x: number; y: number; button: string; action: string; relative: boolean }
  | { success: false; error: string } {
  try {
    const robot = getRobot()
    if (!robot) return getRobotUnavailableResult()

    const button = args.button ?? 'left'
    const action = args.action ?? 'click'

    const point = resolveCoordinatePair(Number(args.x), Number(args.y), getLastCaptureFrame())
    if (!point.ok) {
      return { success: false, error: point.error }
    }
    const { x, y } = point

    if (!isPointInsideDesktop(x, y)) {
      return {
        success: false,
        error: `Coordinate (${Math.round(x)}, ${Math.round(y)}) is outside the desktop bounds ${describeDesktopBounds()}.`
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

    return { success: true, x, y, button, action, relative: point.relative }
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
):
  | {
      success: true
      x?: number
      y?: number
      scrollX: number
      scrollY: number
      relative: boolean
    }
  | { success: false; error: string } {
  try {
    const robot = getRobot()
    if (!robot) return getRobotUnavailableResult()

    const hasAnchor = args.x != null || args.y != null
    const scrollX = Number(args.scrollX ?? 0)
    const scrollY = Number(args.scrollY ?? 0)

    if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY)) {
      return { success: false, error: 'Invalid scroll delta.' }
    }

    let anchorX: number | undefined
    let anchorY: number | undefined
    let relative = false

    if (hasAnchor) {
      if (args.x == null || args.y == null) {
        return { success: false, error: 'Invalid scroll anchor coordinates.' }
      }
      const point = resolveCoordinatePair(Number(args.x), Number(args.y), getLastCaptureFrame())
      if (!point.ok) {
        return { success: false, error: point.error }
      }
      if (!isPointInsideDesktop(point.x, point.y)) {
        return {
          success: false,
          error: `Coordinate (${Math.round(point.x)}, ${Math.round(point.y)}) is outside the desktop bounds ${describeDesktopBounds()}.`
        }
      }
      anchorX = point.x
      anchorY = point.y
      relative = point.relative
      robot.setMouseDelay(0)
      robot.moveMouse(Math.round(anchorX), Math.round(anchorY))
    }

    robot.scrollMouse(Math.round(scrollX), Math.round(scrollY))

    return { success: true, x: anchorX, y: anchorY, scrollX, scrollY, relative }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
