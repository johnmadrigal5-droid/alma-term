/** Below this work area width the side panel goes under the terminal (spec §4). */
export const SIDE_BREAKPOINT = 880
export const SIDE_WIDTH = { initial: 320, min: 240, max: 560 } as const
export const SIDE_HEIGHT = 240

export function sideLayout(workAreaWidth: number): 'right' | 'below' {
  return workAreaWidth < SIDE_BREAKPOINT ? 'below' : 'right'
}

export function clampSideWidth(width: number): number {
  return Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, Math.round(width)))
}
