export interface AuxiliaryRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AuxiliaryPoint {
  x: number
  y: number
}

export interface WorkArea extends AuxiliaryRect {}

export interface WindowPlacementContext {
  caretRect?: AuxiliaryRect | null
  focusWindowRect?: AuxiliaryRect | null
  foregroundWindowRect?: AuxiliaryRect | null
  mousePoint?: AuxiliaryPoint | null
}

export interface DisplayPlacementTarget {
  workArea: WorkArea
  anchor: AuxiliaryPoint
  source: 'caret' | 'focus-window' | 'foreground-window' | 'mouse' | 'primary'
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

export function isValidRect(rect: AuxiliaryRect | null | undefined): rect is AuxiliaryRect {
  return Boolean(
    rect &&
      isFiniteNumber(rect.x) &&
      isFiniteNumber(rect.y) &&
      isFiniteNumber(rect.width) &&
      isFiniteNumber(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
  )
}

export function isValidPoint(point: AuxiliaryPoint | null | undefined): point is AuxiliaryPoint {
  return Boolean(point && isFiniteNumber(point.x) && isFiniteNumber(point.y))
}

export function rectCenter(rect: AuxiliaryRect): AuxiliaryPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function pointInRect(point: AuxiliaryPoint, rect: AuxiliaryRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

export function clampRectToWorkArea(rect: AuxiliaryRect, workArea: WorkArea): AuxiliaryRect {
  const width = Math.min(rect.width, workArea.width)
  const height = Math.min(rect.height, workArea.height)
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - width
  const minY = workArea.y
  const maxY = workArea.y + workArea.height - height
  return {
    x: Math.max(minX, Math.min(rect.x, maxX)),
    y: Math.max(minY, Math.min(rect.y, maxY)),
    width,
    height
  }
}

export function centerRectInWorkArea(width: number, height: number, workArea: WorkArea): AuxiliaryRect {
  return clampRectToWorkArea(
    {
      x: workArea.x + (workArea.width - width) / 2,
      y: workArea.y + (workArea.height - height) / 2,
      width,
      height
    },
    workArea
  )
}

export function placeBelowOrAboveAnchor(
  anchorRect: AuxiliaryRect,
  width: number,
  height: number,
  workArea: WorkArea,
  gap = 8
): AuxiliaryRect {
  const below = {
    x: anchorRect.x,
    y: anchorRect.y + anchorRect.height + gap,
    width,
    height
  }
  const belowSpace = workArea.y + workArea.height - below.y
  const candidate = belowSpace >= height
    ? below
    : {
        x: anchorRect.x,
        y: anchorRect.y - height - gap,
        width,
        height
      }
  return clampRectToWorkArea(candidate, workArea)
}

export function selectPlacementTarget(
  context: WindowPlacementContext,
  displays: Array<{ workArea: WorkArea; containsPoint: (point: AuxiliaryPoint) => boolean }>,
  primaryWorkArea: WorkArea,
  preferCaret: boolean
): DisplayPlacementTarget {
  const candidates: Array<{ rect: AuxiliaryRect; source: DisplayPlacementTarget['source'] }> = []
  if (preferCaret && isValidRect(context.caretRect)) candidates.push({ rect: context.caretRect, source: 'caret' })
  if (isValidRect(context.focusWindowRect)) candidates.push({ rect: context.focusWindowRect, source: 'focus-window' })
  if (isValidRect(context.foregroundWindowRect)) candidates.push({ rect: context.foregroundWindowRect, source: 'foreground-window' })

  for (const candidate of candidates) {
    const center = rectCenter(candidate.rect)
    const display = displays.find((item) => item.containsPoint(center))
    if (display) return { workArea: display.workArea, anchor: center, source: candidate.source }
  }

  if (isValidPoint(context.mousePoint)) {
    const display = displays.find((item) => item.containsPoint(context.mousePoint!))
    if (display) return { workArea: display.workArea, anchor: context.mousePoint, source: 'mouse' }
  }

  return {
    workArea: primaryWorkArea,
    anchor: rectCenter(primaryWorkArea),
    source: 'primary'
  }
}
