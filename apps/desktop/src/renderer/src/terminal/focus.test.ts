import { describe, expect, it } from 'vitest'
import { mayTakeFocus } from './focus'

describe('mayTakeFocus', () => {
  it('I5: never steals focus from a field that keeps it (the MultiExec composer)', () => {
    document.body.innerHTML =
      '<section data-keeps-focus><input id="cmd" /></section><button id="tab">tab</button>'
    expect(mayTakeFocus(document.getElementById('cmd'))).toBe(false)
    expect(mayTakeFocus(document.getElementById('tab'))).toBe(true)
    expect(mayTakeFocus(document.body)).toBe(true)
    expect(mayTakeFocus(null)).toBe(true)
  })
})
