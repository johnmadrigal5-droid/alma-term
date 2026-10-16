import { describe, expect, it } from 'vitest'
import { createMultiExecStore, HISTORY_LIMIT } from './multiexec-store'

describe('multiexec store', () => {
  it('closing the composer turns broadcast off', () => {
    const s = createMultiExecStore()
    s.getState().setOpen(true)
    s.getState().toggleBroadcast()
    s.getState().setOpen(false)
    expect(s.getState().broadcast).toBe(false)
  })

  it('keeps 30 commands, newest first, without repeats', () => {
    const s = createMultiExecStore()
    for (let i = 0; i < 40; i++) s.getState().remember(`c${i}`)
    s.getState().remember('c35')
    expect(s.getState().history).toHaveLength(HISTORY_LIMIT)
    expect(s.getState().history.slice(0, 2)).toEqual(['c35', 'c39'])
  })

  it('drops targets of closed tabs', () => {
    const s = createMultiExecStore()
    s.getState().setTargets(['a', 'b'])
    s.getState().prune(new Set(['b']))
    expect(s.getState().targets).toEqual(['b'])
  })

  it('toggles a target', () => {
    const s = createMultiExecStore()
    s.getState().toggleTarget('a')
    s.getState().toggleTarget('b')
    s.getState().toggleTarget('a')
    expect(s.getState().targets).toEqual(['b'])
  })
})
