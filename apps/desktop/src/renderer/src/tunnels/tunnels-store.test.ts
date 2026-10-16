// @vitest-environment node
import { TunnelSpec, type SavedTunnel, type TunnelEvent } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { createTunnels, isActiveTunnel } from './tunnels-store'

const S = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const T1 = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01'
const T2 = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c02'
const spec = TunnelSpec.parse({
  type: 'L',
  bindPort: 8080,
  targetHost: 'db',
  targetPort: 5432,
})

const event = (over: Partial<TunnelEvent> = {}): TunnelEvent => ({
  type: 'event.tunnel',
  tunnelId: T1,
  sessionId: S,
  spec,
  state: 'open',
  boundPort: 8080,
  connections: 0,
  ...over,
})

describe('tunnels store', () => {
  it('shows a tunnel as opening until the host reports it', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec)
    expect(store.getState().items[T1]).toMatchObject({ state: 'opening', boundPort: 0 })
    store.getState().apply(event({ boundPort: 8080, connections: 2 }))
    expect(store.getState().items[T1]).toMatchObject({
      state: 'open',
      boundPort: 8080,
      connections: 2,
    })
  })

  it('stores the error of a failed tunnel', () => {
    const store = createTunnels()
    store
      .getState()
      .apply(event({ state: 'error', error: { code: 'TUNNEL_FAILED', message: 'se cayó' } }))
    expect(store.getState().items[T1]).toMatchObject({
      state: 'error',
      error: { code: 'TUNNEL_FAILED' },
    })
  })

  it('counts opening and open tunnels as active', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec)
    store.getState().apply(event({ tunnelId: T2, state: 'closed' }))
    expect(store.getState().activeCount()).toBe(1)
    expect(Object.values(store.getState().items).filter(isActiveTunnel)).toHaveLength(1)
  })

  it('removes a tunnel and clears the closed or failed ones', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec)
    store.getState().apply(event({ tunnelId: T2, state: 'closed' }))
    store.getState().clearClosed()
    expect(Object.keys(store.getState().items)).toEqual([T1])
    store.getState().remove(T1)
    expect(store.getState().items).toEqual({})
  })

  it('marks the open tunnels of lost sessions as closed', () => {
    const store = createTunnels()
    store.getState().apply(event())
    store.getState().closeSessions([S])
    expect(store.getState().items[T1]).toMatchObject({ state: 'closed', connections: 0 })
  })

  it('lists newest first', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec)
    store.getState().begin(T2, S, spec)
    expect(
      store
        .getState()
        .views()
        .map((v) => v.tunnelId),
    ).toEqual([T2, T1])
  })

  it('remembers which saved tunnel a row belongs to, through later host events', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec, 'saved-1')
    expect(store.getState().items[T1]?.savedTunnelId).toBe('saved-1')
    store.getState().apply(event())
    expect(store.getState().items[T1]?.savedTunnelId).toBe('saved-1')
    store.getState().markSaved(T1, null)
    expect(store.getState().items[T1]?.savedTunnelId).toBeNull()
  })

  it('I3: keeps a row for a saved tunnel that failed to open, with its error', () => {
    const store = createTunnels()
    store.getState().begin(T1, S, spec, 'saved-1')
    store.getState().markFailed(T1, { code: 'TUNNEL_BIND_IN_USE', message: 'en uso' })
    expect(store.getState().items[T1]).toMatchObject({
      state: 'error',
      savedTunnelId: 'saved-1',
      error: { code: 'TUNNEL_BIND_IN_USE' },
    })
  })

  it('I3: remembers the saved tunnels of each saved session and lets one be forgotten', () => {
    const store = createTunnels()
    const saved = (n: number): SavedTunnel => ({
      id: `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c0${n}`,
      savedId: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
      spec,
      autoStart: false,
    })
    store.getState().setSaved('s1', [saved(1), saved(2)])
    store.getState().addSaved('s1', saved(3))
    expect(store.getState().saved['s1']?.map((t) => t.id.slice(-1))).toEqual(['1', '2', '3'])
    store.getState().removeSaved(saved(2).id)
    expect(store.getState().saved['s1']?.map((t) => t.id.slice(-1))).toEqual(['1', '3'])
  })
})
