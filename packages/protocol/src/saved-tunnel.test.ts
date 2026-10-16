import { describe, expect, it } from 'vitest'
import { SavedTunnel, SavedTunnelInput } from './saved-tunnel'

const ID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01'
const SID = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const spec = { type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 5432 }

describe('saved tunnels', () => {
  it('accepts a valid tunnel and fills the spec defaults', () => {
    const parsed = SavedTunnel.parse({ id: ID, savedId: SID, spec, autoStart: true })
    expect(parsed.spec).toMatchObject({ bindHost: '127.0.0.1', exposeExternally: false })
  })

  it('refuses an external bind without explicit exposure, and a dynamic tunnel with a target', () => {
    const bad = (s: object) =>
      SavedTunnelInput.safeParse({ savedId: SID, spec: s, autoStart: false }).success
    expect(bad({ ...spec, bindHost: '0.0.0.0' })).toBe(false)
    expect(bad({ ...spec, bindHost: '0.0.0.0', exposeExternally: true })).toBe(true)
    expect(bad({ type: 'D', bindPort: 1080, targetHost: 'x', targetPort: 1 })).toBe(false)
  })
})
