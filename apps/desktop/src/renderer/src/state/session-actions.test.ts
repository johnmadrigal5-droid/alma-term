import type { AlmaApi } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSessionActions } from './session-actions'
import { createSessionsStore } from './sessions-store'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'

function fakeApi(overrides: Partial<AlmaApi['session']> = {}): AlmaApi['session'] {
  return {
    openLocal: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { sessionId: SID, kind: 'local', title: 'local' } }),
    openSsh: vi.fn().mockResolvedValue({ ok: false, error: { code: 'TIMEOUT', message: 'x' } }),
    answerPrompt: vi.fn().mockResolvedValue({ ok: true, data: null }),
    resize: vi.fn().mockResolvedValue({ ok: true, data: null }),
    close: vi.fn().mockResolvedValue({ ok: true, data: null }),
    openSaved: vi.fn().mockResolvedValue({ ok: false, error: { code: 'TIMEOUT', message: 'x' } }),
    reattachAll: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    ...overrides,
  }
}

describe('session actions', () => {
  it('openLocal adds a ready tab', async () => {
    const store = createSessionsStore()
    await createSessionActions(fakeApi(), store).openLocal()
    expect(store.getState().tabs[0]).toMatchObject({ sessionId: SID, status: 'ready' })
  })

  it('openLocal stores the error message on failure', async () => {
    const store = createSessionsStore()
    const api = fakeApi({
      openLocal: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: 'SPAWN_FAILED', message: 'sin shell' } }),
    })
    await createSessionActions(api, store).openLocal()
    expect(store.getState().openError).toBe('sin shell')
    expect(store.getState().tabs).toEqual([])
  })

  it('closeTab closes ready sessions in the host and removes the tab', async () => {
    const store = createSessionsStore()
    const api = fakeApi()
    const actions = createSessionActions(api, store)
    await actions.openLocal()
    await actions.closeTab(SID)
    expect(api.close).toHaveBeenCalledWith({ sessionId: SID })
    expect(store.getState().tabs).toEqual([])
  })

  it('closeTab skips the host for closed sessions', async () => {
    const store = createSessionsStore()
    const api = fakeApi()
    const actions = createSessionActions(api, store)
    await actions.openLocal()
    store.getState().setStatus(SID, 'closed', 0)
    await actions.closeTab(SID)
    expect(api.close).not.toHaveBeenCalled()
  })

  it('reopen replaces the tab with a new session', async () => {
    const store = createSessionsStore()
    const api = fakeApi()
    const actions = createSessionActions(api, store)
    await actions.openLocal()
    store.getState().setStatus(SID, 'closed', 0)
    await actions.reopen(SID)
    expect(api.openLocal).toHaveBeenCalledTimes(2)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0]?.status).toBe('ready')
  })

  describe('ssh', () => {
    const SSH_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
    const SSH_ID2 = '2c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
    const target = { host: 'srv', port: 22, username: 'alma' }
    const live = { sessionId: SSH_ID, kind: 'ssh' as const, title: 'alma@srv' }
    const ids = () => {
      const queue = [SSH_ID, SSH_ID2]
      return () => queue.shift() ?? 'exhausted'
    }

    it('openSsh shows a connecting tab, then ready on success', async () => {
      const store = createSessionsStore()
      let resolve: (v: unknown) => void = () => {}
      const api = fakeApi({ openSsh: vi.fn(() => new Promise((r) => (resolve = r))) as never })
      const pending = createSessionActions(api, store, ids()).openSsh({
        target,
        auth: { type: 'password', password: 's3cret' },
      })
      expect(store.getState().tabs[0]).toMatchObject({ sessionId: SSH_ID, status: 'connecting' })
      expect(api.openSsh).toHaveBeenCalledWith({
        sessionId: SSH_ID,
        target,
        auth: { type: 'password', password: 's3cret' },
        cols: 120,
        rows: 32,
      })
      resolve({ ok: true, data: live })
      await pending
      expect(store.getState().tabs[0]?.status).toBe('ready')
    })

    it('keeps the request without the password for retry and edit', async () => {
      const store = createSessionsStore()
      await createSessionActions(fakeApi(), store, ids()).openSsh({
        target,
        auth: { type: 'password', password: 's3cret' },
      })
      expect(store.getState().tabs[0]?.request).toEqual({
        target,
        auth: { type: 'password' },
        savedId: null,
      })
    })

    it('marks the tab with the typed error on failure', async () => {
      const store = createSessionsStore()
      const api = fakeApi({
        openSsh: vi
          .fn()
          .mockResolvedValue({ ok: false, error: { code: 'AUTH_FAILED', message: 'no' } }),
      })
      await createSessionActions(api, store, ids()).openSsh({ target, auth: { type: 'agent' } })
      expect(store.getState().tabs[0]).toMatchObject({
        status: 'error',
        error: { code: 'AUTH_FAILED' },
      })
    })

    it('ignores the result when the tab was closed while connecting', async () => {
      const store = createSessionsStore()
      let resolve: (v: unknown) => void = () => {}
      const api = fakeApi({ openSsh: vi.fn(() => new Promise((r) => (resolve = r))) as never })
      const actions = createSessionActions(api, store, ids())
      const pending = actions.openSsh({ target, auth: { type: 'agent' } })
      await actions.closeTab(SSH_ID)
      expect(api.close).toHaveBeenCalledWith({ sessionId: SSH_ID })
      resolve({ ok: false, error: { code: 'PROMPT_CANCELLED', message: 'x' } })
      await pending
      expect(store.getState().tabs).toEqual([])
    })

    it('retry replaces a failed tab with a new connection', async () => {
      const store = createSessionsStore()
      const api = fakeApi()
      const actions = createSessionActions(api, store, ids())
      await actions.openSsh({ target, auth: { type: 'agent' } })
      await actions.retry(SSH_ID)
      expect(api.openSsh).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: SSH_ID2, target, auth: { type: 'agent' } }),
      )
      expect(store.getState().tabs.map((t) => t.sessionId)).toEqual([SSH_ID2])
    })

    it('edit opens the connect dialog prefilled for that tab', async () => {
      const store = createSessionsStore()
      const actions = createSessionActions(fakeApi(), store, ids())
      await actions.openSsh({ target, auth: { type: 'agent' } })
      actions.edit(SSH_ID)
      expect(store.getState().connectDialog).toEqual({
        initial: { target, auth: { type: 'agent' }, savedId: null },
        replaceId: SSH_ID,
        saved: null,
        folderId: null,
      })
    })

    it('answerPrompt drops the prompt locally and forwards the answer', async () => {
      const store = createSessionsStore()
      const api = fakeApi()
      const actions = createSessionActions(api, store, ids())
      void actions.openSsh({ target, auth: { type: 'agent' } })
      store.getState().addPrompt({
        sessionId: SSH_ID,
        promptId: 'p1',
        prompt: { kind: 'auth', title: 't', instructions: '', fields: [] },
      })
      await actions.answerPrompt('p1', { type: 'auth', responses: ['x'] })
      expect(store.getState().prompts).toEqual([])
      expect(api.answerPrompt).toHaveBeenCalledWith({
        promptId: 'p1',
        answer: { type: 'auth', responses: ['x'] },
      })
    })
  })
})

describe('saved session actions', () => {
  const SAVED_ID = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
  const SSH_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const SSH_ID2 = '2c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const request = {
    target: { host: 'srv', port: 22, username: 'alma' },
    auth: { type: 'password' as const },
    savedId: SAVED_ID,
  }
  const ids = () => {
    const queue = [SSH_ID, SSH_ID2]
    return () => queue.shift() ?? 'exhausted'
  }

  it('openSaved creates a connecting tab named after the bookmark and opens it by id', async () => {
    const store = createSessionsStore()
    const api = fakeApi()
    await createSessionActions(api, store, ids()).openSaved({ title: 'prod', request })
    expect(api.openSaved).toHaveBeenCalledWith({
      sessionId: SSH_ID,
      savedId: SAVED_ID,
      cols: 120,
      rows: 32,
    })
    expect(store.getState().tabs[0]).toMatchObject({ title: 'prod', status: 'error' })
  })

  it('retry of a saved tab opens the bookmark again', async () => {
    const store = createSessionsStore()
    const api = fakeApi()
    const actions = createSessionActions(api, store, ids())
    await actions.openSaved({ title: 'prod', request })
    await actions.retry(SSH_ID)
    expect(api.openSaved).toHaveBeenCalledTimes(2)
    expect(api.openSsh).not.toHaveBeenCalled()
    expect(store.getState().tabs.map((t) => t.title)).toEqual(['prod'])
  })

  it('closeTab drops the data port of the session', async () => {
    const store = createSessionsStore()
    const dropPort = vi.fn()
    const actions = createSessionActions(fakeApi(), store, ids(), dropPort)
    await actions.openSaved({ title: 'prod', request })
    await actions.closeTab(SSH_ID)
    expect(dropPort).toHaveBeenCalledWith(SSH_ID)
  })
})
