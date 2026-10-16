// @vitest-environment node
import type { AlmaApi, TransferEvent, TransferStartArgs } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createTransfers } from './transfers-store'

const S = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const T1 = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01'
const T2 = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c02'
const T3 = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c03'
const NEW = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c99'

const event = (over: Partial<TransferEvent>): TransferEvent => ({
  type: 'event.transfer',
  transferId: T1,
  sessionId: S,
  direction: 'upload',
  name: 'a.txt',
  state: 'running',
  bytes: 0,
  total: 100,
  ...over,
})

function setup() {
  const api = {
    start: vi.fn(async (args: TransferStartArgs) => ({
      ok: true as const,
      data: { transferId: args.transferId ?? NEW },
    })),
    pause: vi.fn(async () => ({ ok: true as const, data: null })),
    resume: vi.fn(async () => ({ ok: true as const, data: null })),
    cancel: vi.fn(async () => ({ ok: true as const, data: null })),
  } as unknown as AlmaApi['transfers']
  let now = 0
  const store = createTransfers(api, { now: () => now, newId: () => NEW })
  return { api, store, tick: (ms: number) => (now += ms) }
}

describe('transfers store', () => {
  it('M1: keeps a retry that could not start as a failed entry', async () => {
    const { api, store } = setup()
    const args = {
      transferId: T1,
      sessionId: S,
      direction: 'upload' as const,
      localPath: '/l/a.txt',
      remotePath: '/r/a.txt',
      overwrite: false,
    }
    store.getState().remember(args)
    store.getState().apply(event({ state: 'error', error: { code: 'IO_FAILED', message: 'x' } }))
    vi.mocked(api.start).mockResolvedValueOnce({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'La sesión no existe' },
    })
    await store.getState().retry(T1)
    expect(store.getState().items[NEW]).toMatchObject({
      name: 'a.txt',
      state: 'error',
      error: { code: 'SESSION_NOT_FOUND' },
    })
  })

  it('M1: shows a transfer rejected at start', () => {
    const { store } = setup()
    store.getState().reject(
      {
        transferId: T2,
        sessionId: S,
        direction: 'download',
        localPath: '/d/b',
        remotePath: '/r/b',
        overwrite: false,
      },
      'b',
      { code: 'SESSION_NOT_FOUND', message: 'La sesión no existe' },
    )
    expect(store.getState().items[T2]).toMatchObject({
      name: 'b',
      state: 'error',
      direction: 'download',
    })
  })

  it('updates a transfer from running to done', () => {
    const { store } = setup()
    store.getState().apply(event({ state: 'running', bytes: 50 }))
    expect(store.getState().views()[0]).toMatchObject({ state: 'running', bytes: 50 })
    store.getState().apply(event({ state: 'done', bytes: 100 }))
    expect(store.getState().views()[0]).toMatchObject({ state: 'done', bytes: 100 })
    expect(store.getState().views()).toHaveLength(1)
  })

  it('counts only queued, running and paused as active', () => {
    const { store } = setup()
    store.getState().apply(event({ transferId: T1, state: 'queued' }))
    store.getState().apply(event({ transferId: T2, state: 'paused' }))
    store.getState().apply(event({ transferId: T3, state: 'error' }))
    expect(store.getState().activeCount()).toBe(2)
  })

  it('computes the speed between two progress events', () => {
    const { store, tick } = setup()
    store.getState().apply(event({ bytes: 0 }))
    tick(1000)
    store.getState().apply(event({ bytes: 2048 }))
    expect(store.getState().views()[0]?.speed).toBe(2048)
  })

  it('retries a failed transfer with a new id and the original paths', async () => {
    const { api, store } = setup()
    store.getState().remember({
      transferId: T1,
      sessionId: S,
      direction: 'upload',
      localPath: '/l/a.txt',
      remotePath: '/r/a.txt',
      overwrite: false,
    })
    store
      .getState()
      .apply(event({ state: 'error', bytes: 40, error: { code: 'ENOSPC', message: 'x' } }))
    await store.getState().retry(T1)
    expect(api.start).toHaveBeenCalledWith({
      transferId: NEW,
      sessionId: S,
      direction: 'upload',
      localPath: '/l/a.txt',
      remotePath: '/r/a.txt',
      overwrite: true,
    })
    expect(
      store
        .getState()
        .views()
        .map((v) => v.transferId),
    ).toEqual([])
  })

  it('pauses through the api and clears finished transfers', async () => {
    const { api, store } = setup()
    store.getState().apply(event({ transferId: T1, state: 'running' }))
    store.getState().apply(event({ transferId: T2, state: 'done' }))
    await store.getState().pause(T1)
    expect(api.pause).toHaveBeenCalledWith({ transferId: T1 })
    store.getState().clearDone()
    expect(
      store
        .getState()
        .views()
        .map((v) => v.transferId),
    ).toEqual([T1])
  })
})
