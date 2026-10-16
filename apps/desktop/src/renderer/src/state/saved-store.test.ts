import type { AlmaApi, SessionTree } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSavedStore } from './saved-store'

const tree: SessionTree = { folders: [], sessions: [], canRemember: true }

function api(result: Awaited<ReturnType<AlmaApi['saved']['tree']>>): AlmaApi['saved'] {
  return { tree: vi.fn().mockResolvedValue(result) } as unknown as AlmaApi['saved']
}

describe('saved store', () => {
  it('starts loading and becomes ready with the tree', async () => {
    const store = createSavedStore()
    expect(store.getState().status).toBe('loading')
    await store.getState().load(api({ ok: true, data: tree }))
    expect(store.getState()).toMatchObject({ status: 'ready', tree, error: null })
  })

  it('keeps the error message when loading fails', async () => {
    const store = createSavedStore()
    await store
      .getState()
      .load(api({ ok: false, error: { code: 'HOST_UNAVAILABLE', message: 'db rota' } }))
    expect(store.getState()).toMatchObject({ status: 'error', error: 'db rota' })
  })

  it('toggles folders and sets the query', () => {
    const store = createSavedStore()
    store.getState().toggle('f1')
    expect(store.getState().expanded.has('f1')).toBe(true)
    store.getState().toggle('f1')
    expect(store.getState().expanded.has('f1')).toBe(false)
    store.getState().setQuery('prod')
    expect(store.getState().query).toBe('prod')
  })
})
