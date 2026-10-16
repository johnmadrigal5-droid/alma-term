import type { AlmaApi, SavedSession, SaveSessionInput } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSavedActions } from './saved-actions'
import { createSavedStore } from './saved-store'

const SAVED: SavedSession = {
  id: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
  folderId: null,
  name: 'prod',
  host: 'srv',
  port: 22,
  username: 'alma',
  auth: 'password',
  keyPath: null,
  hasPassword: true,
  hasPassphrase: false,
}
const input: SaveSessionInput = {
  folderId: null,
  name: 'prod',
  host: 'srv',
  port: 22,
  username: 'alma',
  auth: 'password',
  keyPath: null,
}

function setup() {
  const saved = {
    tree: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { folders: [], sessions: [SAVED], canRemember: true } }),
    save: vi.fn().mockResolvedValue({ ok: true, data: SAVED }),
    remove: vi.fn().mockResolvedValue({ ok: true, data: null }),
  } as unknown as AlmaApi['saved']
  const sessions = { openSaved: vi.fn(async () => {}), openSsh: vi.fn(async () => {}) }
  const store = createSavedStore()
  return { saved, sessions, store, actions: createSavedActions(saved, store, sessions) }
}

describe('saved actions', () => {
  it('connect opens the bookmark by id without secrets', async () => {
    const { actions, sessions } = setup()
    await actions.connect(SAVED)
    expect(sessions.openSaved).toHaveBeenCalledWith({
      title: 'prod',
      request: {
        target: { host: 'srv', port: 22, username: 'alma' },
        auth: { type: 'password' },
        savedId: SAVED.id,
      },
    })
  })

  it('save reloads the tree and connects by id when nothing was typed', async () => {
    const { actions, saved, sessions, store } = setup()
    expect(await actions.save(input, { connect: true })).toEqual({ ok: true, data: SAVED })
    expect(saved.tree).toHaveBeenCalled()
    expect(store.getState().tree?.sessions).toEqual([SAVED])
    expect(sessions.openSaved).toHaveBeenCalledOnce()
  })

  it('save uses the typed password for the first connection', async () => {
    const { actions, sessions } = setup()
    await actions.save(input, { connect: true, password: 'pw' })
    expect(sessions.openSsh).toHaveBeenCalledWith(
      {
        target: { host: 'srv', port: 22, username: 'alma' },
        auth: { type: 'password', password: 'pw' },
        savedId: SAVED.id,
      },
      'prod',
    )
  })

  it('does not connect when saving fails', async () => {
    const { actions, saved, sessions } = setup()
    vi.mocked(saved.save).mockResolvedValue({
      ok: false,
      error: { code: 'CREDENTIALS_UNAVAILABLE', message: 'x' },
    })
    expect(await actions.save(input, { connect: true })).toMatchObject({ ok: false })
    expect(sessions.openSaved).not.toHaveBeenCalled()
  })
})
