export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SummonOffset {
  right: number
  bottom: number
}

function intersectionSize(left: Rect, right: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)),
    height: Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)),
  }
}

export function isWindowMeaningfullyVisible(windowBounds: Rect, workAreas: readonly Rect[]): boolean {
  const minimumWidth = Math.min(64, windowBounds.width)
  const minimumHeight = Math.min(64, windowBounds.height)
  return workAreas.some((workArea) => {
    const intersection = intersectionSize(windowBounds, workArea)
    return intersection.width >= minimumWidth && intersection.height >= minimumHeight
  })
}

export function getSummonPosition(
  windowBounds: Rect,
  workAreas: readonly Rect[],
  cursorWorkArea: Rect,
  offset: SummonOffset,
): { x: number; y: number } | undefined {
  if (isWindowMeaningfullyVisible(windowBounds, workAreas)) return undefined
  return {
    x: Math.max(cursorWorkArea.x, cursorWorkArea.x + cursorWorkArea.width - windowBounds.width - offset.right),
    y: Math.max(cursorWorkArea.y, cursorWorkArea.y + cursorWorkArea.height - windowBounds.height - offset.bottom),
  }
}
