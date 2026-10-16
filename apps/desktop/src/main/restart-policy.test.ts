import { describe, expect, it } from 'vitest'
import { RestartPolicy } from './restart-policy'

describe('RestartPolicy', () => {
  it('restarts up to 3 crashes within 60 s and gives up on the 4th', () => {
    let t = 0
    const policy = new RestartPolicy(3, 60_000, () => t)
    expect(policy.recordCrash()).toBe('restart')
    t = 10_000
    expect(policy.recordCrash()).toBe('restart')
    t = 20_000
    expect(policy.recordCrash()).toBe('restart')
    t = 30_000
    expect(policy.recordCrash()).toBe('give-up')
  })
  it('forgets crashes older than the window', () => {
    let t = 0
    const policy = new RestartPolicy(3, 60_000, () => t)
    policy.recordCrash()
    policy.recordCrash()
    policy.recordCrash()
    t = 61_000
    expect(policy.recordCrash()).toBe('restart')
  })
})
