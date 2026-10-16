// @vitest-environment node
import type { AlmaApi, ApiResult } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createTunnelActions } from './tunnels-actions'
import { createTunnels } from './tunnels-store'

const S = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const T = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01'
const SAVED = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c77'
const SAVED_SESSION = '5d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const input = { type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 5432 } as const

function setup(open: () => Promise<ApiResult<{ tunnelId: string }>>) {
  const api = {
    open: vi.fn(open),
    close: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
    saved: {
      save: vi.fn(async (a: { autoStart: boolean }) => ({
        ok: true as const,
        data: { id: SAVED, savedId: SAVED_SESSION, spec: {}, autoStart: a.autoStart },
      })),
      remove: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
      list: vi.fn(),
    },
  } as unknown as AlmaApi['tunnels']
  const store = createTunnels()
  return { api, store, actions: createTunnelActions({ api, store, newId: () => T }) }
}

describe('tunnel actions', () => {
  it('leaves no stuck row when the open call rejects', async () => {
    const { store, actions } = setup(async () => {
      throw new Error('ipc down')
    })
    const result = await actions.open(S, input)
    expect(result.ok).toBe(false)
    expect(Object.keys(store.getState().items)).toHaveLength(0)
  })

  it('opens a tunnel with the generated id and fills in the schema defaults', async () => {
    const { api, store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    const result = await actions.open(S, input)
    expect(result).toEqual({ ok: true })
    expect(api.open).toHaveBeenCalledWith({
      sessionId: S,
      tunnelId: T,
      spec: expect.objectContaining({ bindHost: '127.0.0.1', exposeExternally: false }),
    })
    expect(store.getState().items[T]?.state).toBe('opening')
  })

  it('returns the error and leaves no row when the host refuses', async () => {
    const { store, actions } = setup(async () => ({
      ok: false,
      error: { code: 'TUNNEL_BIND_IN_USE', message: 'El puerto 8080 ya está en uso' },
    }))
    expect(await actions.open(S, input)).toEqual({
      ok: false,
      error: { code: 'TUNNEL_BIND_IN_USE', message: 'El puerto 8080 ya está en uso' },
    })
    expect(store.getState().items).toEqual({})
  })

  it('refuses an invalid spec without calling the api', async () => {
    const { api, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    const result = await actions.open(S, { ...input, bindHost: '0.0.0.0' })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
    expect(api.open).not.toHaveBeenCalled()
  })

  it('closes a tunnel through the api', async () => {
    const { api, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    await actions.close(T)
    expect(api.close).toHaveBeenCalledWith({ tunnelId: T })
  })

  it('keeps the tunnel with the saved session when asked, and marks its row', async () => {
    const { api, store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    await actions.open(S, input, { keep: { savedId: SAVED_SESSION, autoStart: true } })
    expect(api.saved.save).toHaveBeenCalledWith({
      savedId: SAVED_SESSION,
      spec: expect.objectContaining({ bindPort: 8080 }),
      autoStart: true,
    })
    expect(store.getState().items[T]?.savedTunnelId).toBe(SAVED)
  })

  it('does not save a tunnel that failed to open', async () => {
    const { api, actions } = setup(async () => ({
      ok: false,
      error: { code: 'TUNNEL_FAILED', message: 'x' },
    }))
    await actions.open(S, input, { keep: { savedId: SAVED_SESSION, autoStart: false } })
    expect(api.saved.save).not.toHaveBeenCalled()
  })

  it('marks a row opened from a saved tunnel without saving it again', async () => {
    const { api, store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    await actions.open(S, input, { savedTunnelId: SAVED })
    expect(api.saved.save).not.toHaveBeenCalled()
    expect(store.getState().items[T]?.savedTunnelId).toBe(SAVED)
  })

  it('forgets a saved tunnel and unmarks the row, keeping it open', async () => {
    const { api, store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    await actions.open(S, input, { savedTunnelId: SAVED })
    await actions.forget(T)
    expect(api.saved.remove).toHaveBeenCalledWith({ id: SAVED })
    expect(store.getState().items[T]).toMatchObject({ savedTunnelId: null, state: 'opening' })
  })

  it('I3: keeps an error row when a saved tunnel fails to open on its own', async () => {
    const { store, actions } = setup(async () => ({
      ok: false,
      error: { code: 'TUNNEL_BIND_IN_USE', message: 'en uso' },
    }))
    const result = await actions.open(S, input, { savedTunnelId: SAVED })
    expect(result).toMatchObject({ ok: false })
    expect(store.getState().items[T]).toMatchObject({
      state: 'error',
      savedTunnelId: SAVED,
      error: { code: 'TUNNEL_BIND_IN_USE' },
    })
  })

  it('I3: opens a saved tunnel from the list and forgets one that is not running', async () => {
    const { api, store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    const saved = { id: SAVED, savedId: SAVED_SESSION, spec: {}, autoStart: false } as never
    store.getState().setSaved(SAVED_SESSION, [saved])
    await actions.forgetSaved(saved)
    expect(api.saved.remove).toHaveBeenCalledWith({ id: SAVED })
    expect(store.getState().saved[SAVED_SESSION]).toEqual([])
  })

  it('I3: records a freshly saved tunnel in the list of its session', async () => {
    const { store, actions } = setup(async () => ({ ok: true, data: { tunnelId: T } }))
    await actions.open(S, input, { keep: { savedId: SAVED_SESSION, autoStart: false } })
    expect(store.getState().saved[SAVED_SESSION]?.map((t) => t.id)).toEqual([SAVED])
  })
})
