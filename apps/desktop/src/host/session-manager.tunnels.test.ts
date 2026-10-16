import { EventEmitter } from 'node:events'
import type { HostToMain, TunnelEvent } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from './session-manager'
import type { ChannelLike } from './ssh/channel-pty'
import type { SshConnection } from './ssh/connector-types'
import { FakePort } from './test/fake-port'
import { FakePty } from './test/fake-pty'
import { FakeScheduler } from './test/fake-scheduler'
import { FakeTunnelConnection, FakeTunnelNet, netError } from './test/fake-tunnel-net'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const LOCAL = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '2b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const rid = (n: number) => `6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n).padStart(2, '0')}`

class FakeChannel extends EventEmitter implements ChannelLike {
  readonly stderr = new EventEmitter()
  write(): boolean {
    return true
  }
  setWindow(): void {}
  close(): void {
    this.emit('close')
  }
  pause(): void {}
  resume(): void {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

const spec = { type: 'L', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'db', targetPort: 5432 }

function setup() {
  const sent: HostToMain[] = []
  const net = new FakeTunnelNet()
  const forwarding = new FakeTunnelConnection()
  const lostListeners: (() => void)[] = []
  const connection: SshConnection = {
    channel: new FakeChannel(),
    end: vi.fn(),
    openSftp: async () => {
      throw new Error('sin sftp')
    },
    remembered: null,
    onLost: (listener) => lostListeners.push(listener),
    forwardOut: forwarding.forwardOut,
    forwardIn: forwarding.forwardIn,
    unforwardIn: forwarding.unforwardIn,
    onTcpConnection: forwarding.onTcpConnection,
  }
  const manager = new SessionManager({
    ptyFactory: () => new FakePty(),
    shell: () => ({ shell: '/bin/sh', args: [] }),
    env: () => ({}),
    cwd: () => '/',
    send: (m) => sent.push(m),
    scheduler: new FakeScheduler(),
    warn: vi.fn(),
    sshConnector: { connect: async () => connection },
    readKnownHostsFile: () => '',
    tunnelNet: net,
  })
  manager.handle(
    {
      type: 'ssh.open',
      requestId: rid(1),
      sessionId: SID,
      cols: 80,
      rows: 24,
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'agent' },
      trusted: [],
      rememberable: false,
    },
    [new FakePort()],
  )
  const response = (n: number) => sent.find((m) => m.type === 'response' && m.requestId === rid(n))
  const tunnelEvents = () => sent.filter((m): m is TunnelEvent => m.type === 'event.tunnel')
  const open = (n: number, over: Record<string, unknown> = {}) =>
    manager.handle(
      { type: 'tunnel.open', requestId: rid(n), tunnelId: TID, sessionId: SID, spec, ...over },
      [],
    )
  return {
    manager,
    sent,
    net,
    forwarding,
    response,
    tunnelEvents,
    open,
    loseConnection: () => lostListeners.forEach((l) => l()),
  }
}

describe('SessionManager tunnels', () => {
  it('opens a local forward on an ssh session and answers the bound port', async () => {
    const { response, tunnelEvents, open } = setup()
    await settle()
    open(2)
    await settle()
    expect(response(2)).toMatchObject({ ok: true, data: { tunnelId: TID, boundPort: 40_000 } })
    expect(tunnelEvents().at(-1)).toMatchObject({ state: 'open', sessionId: SID })
  })

  it('answers SESSION_NOT_FOUND for a local session', async () => {
    const { manager, response } = setup()
    manager.handle(
      { type: 'local.open', requestId: rid(2), sessionId: LOCAL, cols: 80, rows: 24 },
      [new FakePort()],
    )
    manager.handle(
      { type: 'tunnel.open', requestId: rid(3), tunnelId: TID, sessionId: LOCAL, spec },
      [],
    )
    await settle()
    expect(response(3)).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })

  it('rejects an external bind that is not explicitly enabled', async () => {
    const { response, open } = setup()
    await settle()
    open(2, { spec: { ...spec, bindHost: '0.0.0.0' } })
    await settle()
    expect(response(2)).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
  })

  it('reports a port in use as TUNNEL_BIND_IN_USE', async () => {
    const { net, response, open } = setup()
    await settle()
    net.listenError = netError('EADDRINUSE')
    open(2, { spec: { ...spec, bindPort: 8080 } })
    await settle()
    expect(response(2)).toMatchObject({ ok: false, error: { code: 'TUNNEL_BIND_IN_USE' } })
  })

  it('refuses a tunnel id that already exists', async () => {
    const { response, open } = setup()
    await settle()
    open(2)
    await settle()
    open(3)
    await settle()
    expect(response(3)).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
  })

  it('closes a tunnel on request, and closing an unknown one is a no-op', async () => {
    const { manager, response, tunnelEvents, open } = setup()
    await settle()
    open(2)
    await settle()
    manager.handle({ type: 'tunnel.close', requestId: rid(3), tunnelId: TID }, [])
    manager.handle(
      { type: 'tunnel.close', requestId: rid(4), tunnelId: '3b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d' },
      [],
    )
    await settle()
    expect(response(3)).toMatchObject({ ok: true })
    expect(response(4)).toMatchObject({ ok: true })
    expect(tunnelEvents().at(-1)).toMatchObject({ state: 'closed' })
  })

  it('closes the tunnels of a session when it closes', async () => {
    const { manager, net, tunnelEvents, open } = setup()
    await settle()
    open(2)
    await settle()
    manager.handle({ type: 'session.close', requestId: rid(3), sessionId: SID }, [])
    await settle()
    expect(net.serversClosed).toBe(1)
    expect(tunnelEvents().at(-1)).toMatchObject({ state: 'closed' })
  })

  it('closes the tunnels of a session when its connection is lost', async () => {
    const { net, tunnelEvents, open, loseConnection } = setup()
    await settle()
    open(2)
    await settle()
    loseConnection()
    await settle()
    expect(net.serversClosed).toBe(1)
    expect(tunnelEvents().at(-1)).toMatchObject({ state: 'closed' })
  })
})
