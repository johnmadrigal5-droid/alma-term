import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import { SURFACE_TOKENS, TEXT_TOKENS, tokens, type ThemeName } from './tokens'

const themes: ThemeName[] = ['dark', 'light']

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2)
  })
})

describe('theme tokens', () => {
  for (const theme of themes) {
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACE_TOKENS) {
        it(`${theme}: ${text} on ${surface} is at least 4.5:1`, () => {
          expect(contrastRatio(tokens[theme][text], tokens[theme][surface])).toBeGreaterThanOrEqual(
            4.5,
          )
        })
      }
    }
    it(`${theme}: white on accent button is at least 4.5:1`, () => {
      expect(contrastRatio('#FFFFFF', tokens[theme].accent)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: terminal text is at least 4.5:1`, () => {
      expect(contrastRatio(tokens[theme].termFg, tokens[theme].termBg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
