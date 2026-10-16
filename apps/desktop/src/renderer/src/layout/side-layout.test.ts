// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clampSideWidth, sideLayout } from './side-layout'

describe('side panel layout', () => {
  it('goes right of the terminal from 880 px and below it under that', () => {
    expect(sideLayout(880)).toBe('right')
    expect(sideLayout(879)).toBe('below')
  })

  it('keeps the width between 240 and 560 px', () => {
    expect(clampSideWidth(100)).toBe(240)
    expect(clampSideWidth(400)).toBe(400)
    expect(clampSideWidth(900)).toBe(560)
  })
})
