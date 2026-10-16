import { describe, expect, it } from 'vitest'
import { TunnelEvent, TunnelOpen, TunnelSpec, isLoopback } from './tunnel'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const RID = '2b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const local = {
  type: 'L',
  bindHost: '127.0.0.1',
  bindPort: 8080,
  targetHost: 'db',
  targetPort: 5432,
}

describe('TunnelSpec', () => {
  it('accepts a local forward and defaults exposeExternally to false', () => {
    expect(TunnelSpec.parse(local)).toMatchObject({ exposeExternally: false })
  })

  it('requires a target for L and R and forbids one for D', () => {
    expect(TunnelSpec.safeParse({ ...local, targetHost: undefined }).success).toBe(false)
    expect(TunnelSpec.safeParse({ ...local, type: 'R' }).success).toBe(true)
    expect(TunnelSpec.safeParse({ ...local, type: 'D' }).success).toBe(false)
    expect(TunnelSpec.safeParse({ type: 'D', bindHost: '127.0.0.1', bindPort: 1080 }).success).toBe(
      true,
    )
  })

  it('refuses an external bind without explicit exposure', () => {
    expect(TunnelSpec.safeParse({ ...local, bindHost: '0.0.0.0' }).success).toBe(false)
    expect(
      TunnelSpec.safeParse({ ...local, bindHost: '0.0.0.0', exposeExternally: true }).success,
    ).toBe(true)
  })

  it('treats loopback names as safe', () => {
    for (const h of ['127.0.0.1', '::1', 'localhost']) expect(isLoopback(h)).toBe(true)
    for (const h of ['0.0.0.0', '192.168.1.5', '::', 'example.com'])
      expect(isLoopback(h)).toBe(false)
  })

  it('rejects out-of-range ports and hosts with spaces or control characters', () => {
    expect(TunnelSpec.safeParse({ ...local, bindPort: 70000 }).success).toBe(false)
    expect(TunnelSpec.safeParse({ ...local, targetPort: 0 }).success).toBe(false)
    expect(TunnelSpec.safeParse({ ...local, targetHost: 'a b' }).success).toBe(false)
    expect(TunnelSpec.safeParse({ ...local, targetHost: 'a\u0000b' }).success).toBe(false)
    expect(TunnelSpec.safeParse({ ...local, bindPort: 0 }).success).toBe(true)
  })
})

describe('tunnel messages', () => {
  it('parses an open request', () => {
    expect(
      TunnelOpen.safeParse({
        type: 'tunnel.open',
        requestId: RID,
        tunnelId: TID,
        sessionId: SID,
        spec: local,
      }).success,
    ).toBe(true)
  })

  it('parses an event with the bound port and connection count', () => {
    const event = {
      type: 'event.tunnel',
      tunnelId: TID,
      sessionId: SID,
      spec: TunnelSpec.parse(local),
      state: 'open',
      boundPort: 8080,
      connections: 2,
    }
    expect(TunnelEvent.safeParse(event).success).toBe(true)
    expect(TunnelEvent.safeParse({ ...event, state: 'weird' }).success).toBe(false)
  })
})
