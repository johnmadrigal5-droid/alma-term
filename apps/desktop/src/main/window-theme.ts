import type { ThemeName } from '@alma/protocol'

/** Window controls drawn over the title bar (Windows and Linux), per theme. */
export const OVERLAY: Record<ThemeName, { color: string; symbolColor: string; height: number }> = {
  dark: { color: '#131312', symbolColor: '#A09F99', height: 40 },
  light: { color: '#F3F2EF', symbolColor: '#5E5D58', height: 40 },
}
