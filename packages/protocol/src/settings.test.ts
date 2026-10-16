import { describe, expect, it } from 'vitest'
import { ThemeName } from './settings'

describe('ThemeName', () => {
  it('accepts the two themes and nothing else', () => {
    expect(ThemeName.safeParse('dark').success).toBe(true)
    expect(ThemeName.safeParse('light').success).toBe(true)
    expect(ThemeName.safeParse('sepia').success).toBe(false)
  })
})
