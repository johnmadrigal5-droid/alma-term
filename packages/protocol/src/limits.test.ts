import { describe, expect, it } from 'vitest'
import { clampSize, SIZE_LIMITS } from './limits'

describe('clampSize', () => {
  it('keeps valid sizes', () => {
    expect(clampSize(120, 32)).toEqual({ cols: 120, rows: 32 })
  })
  it('raises zero sizes to the minimum (hidden panel)', () => {
    expect(clampSize(0, 0)).toEqual({ cols: SIZE_LIMITS.minCols, rows: SIZE_LIMITS.minRows })
  })
  it('falls back to defaults for NaN and Infinity', () => {
    expect(clampSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      cols: SIZE_LIMITS.defaultCols,
      rows: SIZE_LIMITS.defaultRows,
    })
  })
  it('floors fractions and caps huge values', () => {
    expect(clampSize(80.9, 9999)).toEqual({ cols: 80, rows: SIZE_LIMITS.maxRows })
  })
})
