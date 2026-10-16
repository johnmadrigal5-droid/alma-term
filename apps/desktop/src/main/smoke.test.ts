import { describe, expect, it, vi } from 'vitest'
import { createSmokeGuard, smokeMode, SMOKE_TIMEOUT_MS } from './smoke'

function setup() {
  const exit = vi.fn()
  const timers: { fn: () => void; ms: number }[] = []
  const guard = createSmokeGuard({
    exit,
    log: vi.fn(),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout: vi.fn(),
  })
  return { exit, guard, timers }
}

describe('smokeMode', () => {
  it('is off unless ALMA_SMOKE_TEST=1', () => {
    expect(smokeMode({})).toBe(false)
    expect(smokeMode({ ALMA_SMOKE_TEST: '0' })).toBe(false)
    expect(smokeMode({ ALMA_SMOKE_TEST: 'true' })).toBe(false)
    expect(smokeMode({ ALMA_SMOKE_TEST: '1' })).toBe(true)
  })
})

describe('createSmokeGuard', () => {
  it('exits 0 once the window loaded and the host answered, in either order', () => {
    for (const order of [
      ['loaded', 'hostReady'],
      ['hostReady', 'loaded'],
    ] as const) {
      const { exit, guard } = setup()
      guard.mark(order[0])
      expect(exit).not.toHaveBeenCalled()
      guard.mark(order[1])
      expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    }
  })

  it('does not count the same step twice', () => {
    const { exit, guard } = setup()
    guard.mark('loaded')
    guard.mark('loaded')
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits 1 when 30 s pass without both steps', () => {
    const { exit, timers } = setup()
    expect(timers[0]?.ms).toBe(SMOKE_TIMEOUT_MS)
    expect(SMOKE_TIMEOUT_MS).toBe(30_000)
    timers[0]?.fn()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('exits 1 at once when a step fails', () => {
    const { exit, guard } = setup()
    guard.fail('el host no respondió')
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('never exits twice', () => {
    const { exit, guard, timers } = setup()
    guard.mark('loaded')
    guard.mark('hostReady')
    timers[0]?.fn()
    guard.fail('tarde')
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
