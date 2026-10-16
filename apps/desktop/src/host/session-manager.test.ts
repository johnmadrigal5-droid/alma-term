import { TIMEOUTS, type HostToMain } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { FakePort } from './test/fake-port'
import { FakePty } from './test/fake-pty'
import { FakeScheduler } from './test/fake-scheduler'
import { SessionManager } from './session-manager'
import type { PtySpawnOptions } from './pty-types'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const rid = (n: number) => `6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n).padStart(2, '0')}`

function setup(factory?: (o: PtySpawnOptions) => FakePty) {
  const sent: HostToMain[] = []
  const ptys: FakePty[] = []
  const spawned: PtySpawnOptions[] = []
  const scheduler = new FakeScheduler()
  const manager = new SessionManager({
    ptyFactory: (o) => {
      spawned.push(o)
      const pty = factory ? factory(o) : new FakePty()
      ptys.push(pty)
      return pty
    },
    shell: () => ({ shell: '/bin/bash', args: ['-l'] }),
    env: () => ({ TERM: 'xterm-256color' }),
    cwd: () => '/home/test',
    send: (m) => sent.push(m),
    scheduler,
    warn: vi.fn(),
  })
  return { manager, sent, ptys, spawned, scheduler }
}

function open(manager: SessionManager, port = new FakePort()) {
  manager.handle({ type: 'local.open', requestId: rid(1), sessionId: SID, cols: 80, rows: 24 }, [
    port,
  ])
  return port
}

describe('SessionManager', () => {
  it('opens a local session, reports ready and answers ok', () => {
    const { manager, sent, spawned } = setup()
    open(manager)
    expect(spawned[0]).toMatchObject({
      shell: '/bin/bash',
      args: ['-l'],
      cols: 80,
      rows: 24,
      cwd: '/home/test',
    })
    expect(sent).toEqual([
      { type: 'event.status', sessionId: SID, state: 'ready', exitCode: null },
      { type: 'response', requestId: rid(1), ok: true, data: { sessionId: SID } },
    ])
  })

  it('rejects invalid messages with INVALID_MESSAGE and closes their ports', () => {
    const { manager, sent } = setup()
    const port = new FakePort()
    manager.handle({ type: 'local.open', requestId: rid(2), sessionId: SID, cols: 0, rows: 24 }, [
      port,
    ])
    expect(sent).toEqual([
      {
        type: 'response',
        requestId: rid(2),
        ok: false,
        error: { code: 'INVALID_MESSAGE', message: 'Mensaje de control inválido' },
      },
    ])
    expect(port.closed).toBe(true)
  })

  it('requires a port to open a session', () => {
    const { manager, sent } = setup()
    manager.handle(
      { type: 'local.open', requestId: rid(3), sessionId: SID, cols: 80, rows: 24 },
      [],
    )
    expect(sent[0]).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
  })

  it('reports SPAWN_FAILED when the pty cannot start', () => {
    const { manager, sent } = setup(() => {
      throw new Error('no such shell')
    })
    open(manager)
    expect(sent[0]).toMatchObject({
      ok: false,
      error: { code: 'SPAWN_FAILED', message: 'no such shell' },
    })
    expect(manager.size).toBe(0)
  })

  it('answers SESSION_NOT_FOUND for unknown sessions', () => {
    const { manager, sent } = setup()
    manager.handle(
      { type: 'session.resize', requestId: rid(4), sessionId: SID, cols: 80, rows: 24 },
      [],
    )
    expect(sent[0]).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })

  it('keeps a detached session alive when reattached within the grace period', () => {
    const { manager, sent, ptys, scheduler } = setup()
    const port = open(manager)
    ptys[0]?.emitData('prompt$ ')
    port.close()
    scheduler.advance(TIMEOUTS.reattachGraceMs - 1)
    const next = new FakePort()
    manager.handle({ type: 'session.reattach', requestId: rid(5), sessionId: SID }, [next])
    scheduler.advance(TIMEOUTS.reattachGraceMs)
    expect(ptys[0]?.kills).toBe(0)
    expect(sent.at(-1)).toEqual({
      type: 'response',
      requestId: rid(5),
      ok: true,
      data: { sessionId: SID },
    })
    expect(next.sent[0]).toMatchObject({ type: 'data' })
  })

  it('kills a detached session after the grace period', () => {
    const { manager, ptys, scheduler } = setup()
    const port = open(manager)
    port.close()
    scheduler.advance(TIMEOUTS.reattachGraceMs)
    expect(ptys[0]?.kills).toBe(1)
  })

  it('removes the session and reports closed when the shell exits', () => {
    const { manager, sent, ptys } = setup()
    open(manager)
    ptys[0]?.emitExit(130)
    expect(sent.at(-1)).toEqual({
      type: 'event.status',
      sessionId: SID,
      state: 'closed',
      exitCode: 130,
    })
    expect(manager.size).toBe(0)
  })
})
