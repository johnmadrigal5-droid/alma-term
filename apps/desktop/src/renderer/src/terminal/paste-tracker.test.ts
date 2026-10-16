import { describe, expect, it } from 'vitest'
import { trackPaste } from './paste-tracker'

describe('trackPaste', () => {
  it('is active only while the paste event runs', async () => {
    const outer = document.createElement('div')
    const inner = document.createElement('textarea')
    outer.append(inner)
    const tracker = trackPaste(outer)
    let during = false
    inner.addEventListener('paste', () => {
      during = tracker.active()
    })
    inner.dispatchEvent(new Event('paste', { bubbles: true }))
    expect(during).toBe(true)
    await Promise.resolve()
    expect(tracker.active()).toBe(false)
    tracker.dispose()
  })
})
