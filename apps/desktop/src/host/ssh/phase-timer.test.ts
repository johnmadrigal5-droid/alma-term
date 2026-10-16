import { describe, expect, it, vi } from 'vitest'
import { FakeScheduler } from '../test/fake-scheduler'
import { PhaseTimer } from './phase-timer'

describe('PhaseTimer', () => {
  it('expires after the budget without pauses', () => {
    const s = new FakeScheduler()
    const onExpire = vi.fn()
    new PhaseTimer(20_000, onExpire, s).start()
    s.advance(19_999)
    expect(onExpire).not.toHaveBeenCalled()
    s.advance(1)
    expect(onExpire).toHaveBeenCalledOnce()
  })
  it('does not count time spent paused (user reading a prompt)', () => {
    const s = new FakeScheduler()
    const onExpire = vi.fn()
    const t = new PhaseTimer(20_000, onExpire, s)
    t.start()
    s.advance(5_000)
    t.pause()
    s.advance(60_000)
    expect(onExpire).not.toHaveBeenCalled()
    t.resume()
    s.advance(14_999)
    expect(onExpire).not.toHaveBeenCalled()
    s.advance(1)
    expect(onExpire).toHaveBeenCalledOnce()
  })
  it('never fires after stop()', () => {
    const s = new FakeScheduler()
    const onExpire = vi.fn()
    const t = new PhaseTimer(20_000, onExpire, s)
    t.start()
    t.stop()
    s.advance(30_000)
    expect(onExpire).not.toHaveBeenCalled()
  })
})
