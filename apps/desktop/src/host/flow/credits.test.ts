import { describe, expect, it } from 'vitest'
import { CreditGate } from './credits'

function setup() {
  const calls: string[] = []
  const gate = new CreditGate(
    100,
    25,
    () => calls.push('pause'),
    () => calls.push('resume'),
  )
  return { gate, calls }
}

describe('CreditGate', () => {
  it('does not pause at or below the high-water mark', () => {
    const { gate, calls } = setup()
    gate.sent(100)
    expect(calls).toEqual([])
    expect(gate.isPaused).toBe(false)
  })
  it('pauses once above the high-water mark', () => {
    const { gate, calls } = setup()
    gate.sent(60)
    gate.sent(60)
    gate.sent(60)
    expect(calls).toEqual(['pause'])
    expect(gate.pending).toBe(180)
  })
  it('resumes only below the low-water mark', () => {
    const { gate, calls } = setup()
    gate.sent(120)
    gate.acked(90)
    expect(calls).toEqual(['pause'])
    gate.acked(10)
    expect(calls).toEqual(['pause', 'resume'])
  })
  it('reset clears pending bytes and resumes if paused', () => {
    const { gate, calls } = setup()
    gate.sent(150)
    gate.reset()
    expect(gate.pending).toBe(0)
    expect(calls).toEqual(['pause', 'resume'])
  })
  it('never goes below zero on extra acks', () => {
    const { gate } = setup()
    gate.acked(50)
    expect(gate.pending).toBe(0)
  })
})
