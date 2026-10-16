import type { HostEvent } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ActivityTracker, closeWarning, createCloseGuard } from './activity-tracker'

const S1 = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const S2 = '8d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const id = (n: number) => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n).padStart(2, '0')}`

const transfer = (n: number, state: string, sessionId = S1): HostEvent =>
  ({
    type: 'event.transfer',
    transferId: id(n),
    sessionId,
    direction: 'upload',
    name: 'a',
    state,
    bytes: 0,
    total: 0,
  }) as HostEvent

const tunnel = (n: number, state: string, sessionId = S1): HostEvent =>
  ({
    type: 'event.tunnel',
    tunnelId: id(n),
    sessionId,
    spec: { type: 'D', bindHost: '127.0.0.1', bindPort: 1080, exposeExternally: false },
    state,
    boundPort: 1080,
    connections: 0,
  }) as HostEvent

describe('ActivityTracker', () => {
  it('counts transfers while they are queued, running or paused', () => {
    const t = new ActivityTracker()
    for (const state of ['queued', 'running', 'paused']) {
      t.apply(transfer(1, state))
      expect(t.counts().transfers).toBe(1)
    }
    for (const state of ['done', 'error', 'cancelled']) {
      t.apply(transfer(1, 'running'))
      t.apply(transfer(1, state))
      expect(t.counts().transfers).toBe(0)
    }
  })

  it('counts open tunnels and forgets closed or failed ones', () => {
    const t = new ActivityTracker()
    t.apply(tunnel(1, 'open'))
    t.apply(tunnel(1, 'open'))
    t.apply(tunnel(2, 'open'))
    expect(t.counts().tunnels).toBe(2)
    t.apply(tunnel(1, 'closed'))
    t.apply(tunnel(2, 'error'))
    expect(t.counts().tunnels).toBe(0)
  })

  it('drops everything of a session that closed or was lost', () => {
    const t = new ActivityTracker()
    t.apply(transfer(1, 'running', S1))
    t.apply(tunnel(2, 'open', S1))
    t.apply(tunnel(3, 'open', S2))
    t.apply({ type: 'event.status', sessionId: S1, state: 'lost', exitCode: null })
    expect(t.counts()).toEqual({ transfers: 0, tunnels: 1 })
    t.apply({ type: 'event.status', sessionId: S2, state: 'closed', exitCode: 0 })
    expect(t.counts()).toEqual({ transfers: 0, tunnels: 0 })
  })

  it('ignores a ready status and clears on demand', () => {
    const t = new ActivityTracker()
    t.apply(tunnel(1, 'open'))
    t.apply({ type: 'event.status', sessionId: S1, state: 'ready', exitCode: null })
    expect(t.counts().tunnels).toBe(1)
    t.clear()
    expect(t.counts()).toEqual({ transfers: 0, tunnels: 0 })
  })
})

describe('closeWarning', () => {
  it('is null when nothing is active', () => {
    expect(closeWarning({ transfers: 0, tunnels: 0 })).toBeNull()
  })

  it('names what is active with the right plurals', () => {
    expect(closeWarning({ transfers: 1, tunnels: 0 })?.message).toBe('Hay 1 transferencia activa')
    expect(closeWarning({ transfers: 3, tunnels: 0 })?.message).toBe('Hay 3 transferencias activas')
    expect(closeWarning({ transfers: 0, tunnels: 1 })?.message).toBe('Hay 1 túnel activo')
    expect(closeWarning({ transfers: 0, tunnels: 2 })?.message).toBe('Hay 2 túneles activos')
    expect(closeWarning({ transfers: 1, tunnels: 2 })?.message).toBe(
      'Hay 1 transferencia y 2 túneles activos',
    )
    expect(closeWarning({ transfers: 1, tunnels: 0 })?.detail).toBe(
      'Si cierras la aplicación se cancelarán.',
    )
  })
})

describe('createCloseGuard', () => {
  const event = () => ({ preventDefault: vi.fn() })

  it('lets the window close when nothing is active', () => {
    const e = event()
    const ask = vi.fn(async () => true)
    createCloseGuard({ counts: () => ({ transfers: 0, tunnels: 0 }), ask }).onClose(e, vi.fn())
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it('holds the close and asks when something is active', async () => {
    const e = event()
    const ask = vi.fn(async () => false)
    const closeAgain = vi.fn()
    createCloseGuard({ counts: () => ({ transfers: 1, tunnels: 0 }), ask }).onClose(e, closeAgain)
    expect(e.preventDefault).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Hay 1 transferencia activa' }),
    )
    await Promise.resolve()
    expect(closeAgain).not.toHaveBeenCalled()
  })

  it('closes again, without asking twice, once the user confirms', async () => {
    const ask = vi.fn(async () => true)
    const closeAgain = vi.fn()
    const guard = createCloseGuard({ counts: () => ({ transfers: 0, tunnels: 2 }), ask })
    guard.onClose(event(), closeAgain)
    await new Promise((r) => setImmediate(r))
    expect(closeAgain).toHaveBeenCalledOnce()
    const second = event()
    guard.onClose(second, closeAgain)
    expect(second.preventDefault).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledOnce()
  })

  it('does not stack questions when the user clicks close again while one is open', async () => {
    let answer: (ok: boolean) => void = () => undefined
    const ask = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const guard = createCloseGuard({ counts: () => ({ transfers: 1, tunnels: 0 }), ask })
    const first = event()
    const second = event()
    guard.onClose(first, vi.fn())
    guard.onClose(second, vi.fn())
    expect(ask).toHaveBeenCalledOnce()
    expect(second.preventDefault).toHaveBeenCalledOnce()
    answer(false)
  })
})
