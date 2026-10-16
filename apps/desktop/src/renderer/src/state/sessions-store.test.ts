import { describe, expect, it } from 'vitest'
import { createSessionsStore } from './sessions-store'

describe('sessions store', () => {
  it('adds numbered tabs and activates the newest', () => {
    const s = createSessionsStore()
    s.getState().addTab({ sessionId: 'a', title: 'local' })
    s.getState().addTab({ sessionId: 'b', title: 'local' })
    expect(s.getState().tabs.map((t) => t.title)).toEqual(['local 1', 'local 2'])
    expect(s.getState().activeId).toBe('b')
  })

  it('re-adding an existing tab bumps its generation (reattach)', () => {
    const s = createSessionsStore()
    s.getState().addTab({ sessionId: 'a', title: 'local' })
    s.getState().addTab({ sessionId: 'a', title: 'local' })
    expect(s.getState().tabs).toHaveLength(1)
    expect(s.getState().tabs[0]?.generation).toBe(1)
  })

  it('ignores status for unknown tabs', () => {
    const s = createSessionsStore()
    s.getState().setStatus('nope', 'closed', 0)
    expect(s.getState().tabs).toEqual([])
  })

  it('records exit codes', () => {
    const s = createSessionsStore()
    s.getState().addTab({ sessionId: 'a', title: 'local' })
    s.getState().setStatus('a', 'closed', 127)
    expect(s.getState().tabs[0]).toMatchObject({ status: 'closed', exitCode: 127 })
  })

  it('activates a neighbour when the active tab is removed', () => {
    const s = createSessionsStore()
    for (const id of ['a', 'b', 'c']) s.getState().addTab({ sessionId: id, title: 'local' })
    s.getState().setActive('b')
    s.getState().removeTab('b')
    expect(s.getState().activeId).toBe('c')
    s.getState().removeTab('c')
    expect(s.getState().activeId).toBe('a')
    s.getState().removeTab('a')
    expect(s.getState().activeId).toBeNull()
  })

  it('cycles and selects tabs by index', () => {
    const s = createSessionsStore()
    for (const id of ['a', 'b']) s.getState().addTab({ sessionId: id, title: 'local' })
    s.getState().cycle(1)
    expect(s.getState().activeId).toBe('a')
    s.getState().cycle(-1)
    expect(s.getState().activeId).toBe('b')
    s.getState().selectIndex(0)
    expect(s.getState().activeId).toBe('a')
    s.getState().selectIndex(8)
    expect(s.getState().activeId).toBe('a')
  })

  it('marks host-lost sessions', () => {
    const s = createSessionsStore()
    for (const id of ['a', 'b']) s.getState().addTab({ sessionId: id, title: 'local' })
    s.getState().markLost(['a'], 'host')
    expect(s.getState().tabs.map((t) => t.status)).toEqual(['lost', 'ready'])
    expect(s.getState().tabs[0]?.lostBy).toBe('host')
  })

  describe('ssh tabs', () => {
    const request = {
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'password' as const },
    }
    const hostkey = {
      kind: 'hostkey' as const,
      status: 'new' as const,
      host: 'srv',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:x',
    }

    it('adds a connecting ssh tab with its exact title and tracks steps', () => {
      const s = createSessionsStore()
      s.getState().addSshTab({ sessionId: 'a', title: 'alma@srv', request })
      s.getState().setStep('a', 'auth')
      expect(s.getState().tabs[0]).toMatchObject({
        title: 'alma@srv',
        kind: 'ssh',
        status: 'connecting',
        step: 'auth',
        request,
      })
    })

    it('stores the open error on the tab', () => {
      const s = createSessionsStore()
      s.getState().addSshTab({ sessionId: 'a', title: 'alma@srv', request })
      s.getState().setError('a', { code: 'AUTH_FAILED', message: 'no' })
      expect(s.getState().tabs[0]).toMatchObject({
        status: 'error',
        error: { code: 'AUTH_FAILED' },
      })
    })

    it('removes a prompt on prompt-closed and when its tab closes', () => {
      const s = createSessionsStore()
      s.getState().addSshTab({ sessionId: 'a', title: 'alma@srv', request })
      s.getState().addPrompt({ sessionId: 'a', promptId: 'p1', prompt: hostkey })
      s.getState().addPrompt({ sessionId: 'a', promptId: 'p2', prompt: hostkey })
      s.getState().removePrompt('p1')
      expect(s.getState().prompts.map((p) => p.promptId)).toEqual(['p2'])
      s.getState().removeTab('a')
      expect(s.getState().prompts).toEqual([])
    })

    it('ignores prompts for unknown tabs', () => {
      const s = createSessionsStore()
      s.getState().addPrompt({ sessionId: 'zz', promptId: 'p1', prompt: hostkey })
      expect(s.getState().prompts).toEqual([])
    })
  })
})
