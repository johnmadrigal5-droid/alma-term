import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../renderer/src/theme/contrast'
import { tokens } from '../renderer/src/theme/tokens'
import { OVERLAY } from './window-theme'

describe('title bar overlay', () => {
  it('matches the canvas of each theme', () => {
    expect(OVERLAY.dark.color).toBe(tokens.dark.canvas)
    expect(OVERLAY.light.color).toBe(tokens.light.canvas)
  })

  it('keeps the window controls readable in both themes', () => {
    for (const theme of ['dark', 'light'] as const)
      expect(
        contrastRatio(OVERLAY[theme].symbolColor, OVERLAY[theme].color),
      ).toBeGreaterThanOrEqual(4.5)
  })
})
