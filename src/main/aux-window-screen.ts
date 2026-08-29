import { screen, type Rectangle } from 'electron'
import {
  centerRectInWorkArea,
  isValidPoint,
  isValidRect,
  placeBelowOrAboveAnchor,
  selectPlacementTarget,
  type AuxiliaryPoint,
  type AuxiliaryRect,
  type WindowPlacementContext
} from './aux-window-placement'
import { logDebug } from './lib/logger'
import type { ShortcutContext, ShortcutPoint, ShortcutRect } from './priority-shortcuts'

type ScreenWithOptionalConversion = typeof screen & {
  screenToDipPoint?: (point: Electron.Point) => Electron.Point
  screenToDipRect?: (display: null, rect: Rectangle) => Rectangle
}

function toAuxiliaryRect(rect: ShortcutRect): AuxiliaryRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function toAuxiliaryPoint(point: Electron.Point | ShortcutPoint): AuxiliaryPoint {
  return { x: point.x, y: point.y }
}

function containsPoint(rect: AuxiliaryRect, point: AuxiliaryPoint): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

function convertPhysicalRectWithScale(rect: AuxiliaryRect, display: Electron.Display): AuxiliaryRect {
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1
  return {
    x: display.bounds.x + rect.x / scale,
    y: display.bounds.y + rect.y / scale,
    width: rect.width / scale,
    height: rect.height / scale
  }
}

function convertPhysicalRect(rect: AuxiliaryRect, displays: Electron.Display[]): AuxiliaryRect | null {
  if (!isValidRect(rect)) return null
  const screenApi = screen as ScreenWithOptionalConversion
  if (screenApi.screenToDipRect) {
    try {
      const converted = screenApi.screenToDipRect(null, rect)
      if (isValidRect(converted)) return converted
    } catch {
      // Fall through to point conversion or the explicit scale fallback.
    }
  }

  if (screenApi.screenToDipPoint) {
    try {
      const topLeft = screenApi.screenToDipPoint({ x: rect.x, y: rect.y })
      const bottomRight = screenApi.screenToDipPoint({ x: rect.x + rect.width, y: rect.y + rect.height })
      const converted = {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y
      }
      if (isValidRect(converted)) return converted
    } catch {
      // Fall through to the explicit scale fallback.
    }
  }

  // Without Electron's conversion API, a multi-monitor physical coordinate
  // cannot be safely mapped to DIP because each display may have a different
  // scale and origin. Only retain the deterministic one-display fallback.
  if (displays.length !== 1) return null
  return convertPhysicalRectWithScale(rect, displays[0])
}

function convertPhysicalPoint(point: AuxiliaryPoint, displays: Electron.Display[]): AuxiliaryPoint | null {
  const converter = (screen as ScreenWithOptionalConversion).screenToDipPoint
  if (converter) {
    try {
      const converted = converter(point)
      if (isValidPoint(converted)) return converted
    } catch {
      // Fall through to the explicit scale fallback.
    }
  }

  if (displays.length !== 1) return null
  const display = displays[0]
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1
  return {
    x: display.bounds.x + point.x / scale,
    y: display.bounds.y + point.y / scale
  }
}

function convertContext(context: ShortcutContext, displays: Electron.Display[]): WindowPlacementContext {
  const bridgeMousePoint = context.mousePoint ? convertPhysicalPoint(toAuxiliaryPoint(context.mousePoint), displays) : null
  return {
    caretRect: context.caretRect ? convertPhysicalRect(toAuxiliaryRect(context.caretRect), displays) : null,
    focusWindowRect: context.focusWindowRect ? convertPhysicalRect(toAuxiliaryRect(context.focusWindowRect), displays) : null,
    foregroundWindowRect: context.foregroundWindowRect
      ? convertPhysicalRect(toAuxiliaryRect(context.foregroundWindowRect), displays)
      : null,
    mousePoint: bridgeMousePoint ?? toAuxiliaryPoint(screen.getCursorScreenPoint())
  }
}

export type AuxiliaryWindowKind = 'clipboard' | 'launcher'

export function getAuxiliaryWindowBounds(
  context: ShortcutContext,
  width: number,
  height: number,
  kind: AuxiliaryWindowKind
): Rectangle {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const preferCaret = kind === 'clipboard'
  const placementContext = convertContext(context, displays)
  const target = selectPlacementTarget(
    placementContext,
    displays.map((display) => ({
      workArea: display.workArea,
      containsPoint: (point: AuxiliaryPoint) => containsPoint(display.bounds, point)
    })),
    primary.workArea,
    preferCaret
  )

  logDebug('main', `Auxiliary ${kind} placement source: ${target.source}`, {
    extra: {
      target,
      caretRect: placementContext.caretRect,
      focusWindowRect: placementContext.focusWindowRect,
      foregroundWindowRect: placementContext.foregroundWindowRect,
      mousePoint: placementContext.mousePoint
    }
  })

  if (preferCaret && target.source === 'caret' && isValidRect(placementContext.caretRect)) {
    return placeBelowOrAboveAnchor(placementContext.caretRect, width, height, target.workArea)
  }

  const centered = centerRectInWorkArea(width, height, target.workArea)
  if (isValidPoint(target.anchor)) {
    return {
      x: Math.max(target.workArea.x, Math.min(target.anchor.x - width / 2, target.workArea.x + target.workArea.width - width)),
      y: Math.max(target.workArea.y, Math.min(target.anchor.y - height / 2, target.workArea.y + target.workArea.height - height)),
      width: centered.width,
      height: centered.height
    }
  }
  return centered
}
