import { describe, expect, it } from 'vitest'
import { applyTheme, currentTokens } from './apply-theme'
import { tokens } from './tokens'

describe('applyTheme', () => {
  it('writes css variables and the theme attribute', () => {
    const root = document.createElement('div')
    applyTheme('light', root)
    expect(root.style.getPropertyValue('--alma-canvas')).toBe(tokens.light.canvas)
    expect(root.style.getPropertyValue('--alma-accent-text')).toBe(tokens.light.accentText)
    expect(root.dataset['theme']).toBe('light')
    expect(currentTokens(root)).toBe(tokens.light)
  })
  it('defaults to dark tokens', () => {
    expect(currentTokens(document.createElement('div'))).toBe(tokens.dark)
  })
})
