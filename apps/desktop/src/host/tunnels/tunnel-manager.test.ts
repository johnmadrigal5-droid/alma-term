// @vitest-environment node
import type { Duplex } from 'node:stream'
import {
  TIMEOUTS,
  TUNNEL,
  TunnelSpec,
  type TunnelEvent,
  type TunnelSpecInput,
} from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { FakeScheduler } from '../test/fake-scheduler'
import { FakeTunnelConnection, FakeTunnelNet, netError } from '../test/fake-tunnel-net'
import { REPLY, socksReply } from './socks5'
import { TunnelFailure, TunnelManager } from './tunnel-manager'

const S1 = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const S2 = '8d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const id = (n: number) => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n).padStart(2, '0')}`

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

function setup() {
  const net = new FakeTunnelNet()
  const conn = new FakeTunnelConnection()
  const scheduler = new FakeScheduler()
  const events: TunnelEvent[] = []
  const manager = new TunnelManager({ net, scheduler, send: (e) => events.push(e) })
  const open = (n: number, spec: TunnelSpecInput, sessionId = S1, c = conn) =>
    manager.open(sessionId, id(n), TunnelSpec.parse(spec), c)
  const last = (n: number) => events.filter((e) => e.tunnelId === id(n)).at(-1)
  return { net, conn, scheduler, events, manager, open, last }
}

const L = {
  type: 'L',
  bindHost: '127.0.0.1',
  bindPort: 0,
  targetHost: 'db',
  targetPort: 5432,
} as const
const D = { type: 'D', bindHost: '127.0.0.1', bindPort: 0 } as const
const R = {
  type: 'R',
  bindHost: '127.0.0.1',
  bindPort: 0,
  targetHost: 'localhost',
  targetPort: 3000,
} as const

/** The channel the manager asked for at `index`; fails the test if there is none. */
function out(conn: FakeTunnelConnection, index = 0) {
  const found = conn.outs[index]
  if (!found) throw new Error(`no channel #${index}`)
  return found
}

function outbound(net: FakeTunnelNet, index = 0) {
  const found = net.outbound[index]
  if (!found) throw new Error(`no outbound connection #${index}`)
  return found
}

const readBytes = (stream: Duplex): Promise<Buffer> =>
  new Promise((resolve) => stream.once('data', (d: Buffer) => resolve(d)))
const read = async (stream: Duplex): Promise<string> => (await readBytes(stream)).toString()

describe('TunnelManager local forward', () => {
  it('listens, reports the bound port and bridges a client to the target through the channel', async () => {
    const { net, conn, open, last } = setup()
    const port = await open(1, L)
    expect(port).toBe(40_000)
    expect(net.listened).toEqual([{ host: '127.0.0.1', port: 40_000 }])
    expect(last(1)).toMatchObject({ state: 'open', boundPort: 40_000, connections: 0 })

    const client = net.client()
    await settle()
    expect(conn.outs).toHaveLength(1)
    expect(conn.outs[0]).toMatchObject({ dstHost: 'db', dstPort: 5432 })
    expect(last(1)).toMatchObject({ connections: 1 })

    client.write('ping')
    expect(await read(out(conn, 0).remote)).toBe('ping')
    out(conn, 0).remote.write('pong')
    expect(await read(client)).toBe('pong')

    client.destroy()
    await settle()
    expect(last(1)).toMatchObject({ connections: 0 })
  })

  it('drops the client when the channel cannot be opened', async () => {
    const { net, conn, open } = setup()
    conn.forwardOutError = new Error('administratively prohibited')
    await open(1, L)
    const client = net.client()
    await settle()
    expect(client.destroyed).toBe(true)
  })

  it('refuses connections above the per-tunnel limit without opening a channel', async () => {
    const { net, conn, open } = setup()
    await open(1, L)
    const clients = Array.from({ length: TUNNEL.maxConnections }, () => net.client())
    await settle()
    expect(conn.outs).toHaveLength(TUNNEL.maxConnections)
    const extra = net.client()
    await settle()
    expect(conn.outs).toHaveLength(TUNNEL.maxConnections)
    expect(extra.destroyed).toBe(true)
    expect(clients.every((c) => !c.destroyed)).toBe(true)
  })

  it('one failing connection does not affect the others of the tunnel', async () => {
    const { net, conn, open } = setup()
    await open(1, L)
    const a = net.client()
    const b = net.client()
    await settle()
    out(conn, 0).remote.on('error', () => undefined)
    out(conn, 0).remote.destroy(new Error('boom'))
    await settle()
    expect(a.destroyed).toBe(true)
    expect(b.destroyed).toBe(false)
  })
})

describe('TunnelManager bind errors', () => {
  it('maps EADDRINUSE to TUNNEL_BIND_IN_USE and leaves nothing behind', async () => {
    const { net, manager, open } = setup()
    net.listenError = netError('EADDRINUSE')
    await expect(open(1, { ...L, bindPort: 8080 })).rejects.toMatchObject({
      error: { code: 'TUNNEL_BIND_IN_USE' },
    })
    expect(manager.countFor(S1)).toBe(0)
    net.listenError = null
    await expect(open(1, { ...L, bindPort: 8080 })).resolves.toBe(8080)
  })

  it('explains a permission failure in Spanish with the reason', async () => {
    const { net, open } = setup()
    net.listenError = netError('EACCES', 'listen EACCES: permission denied')
    const error = await open(1, { ...L, bindPort: 80 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TunnelFailure)
    expect(error).toMatchObject({
      error: { code: 'TUNNEL_FAILED', message: expect.stringContaining('Sin permiso') },
    })
  })

  it('keeps the system message for other bind failures', async () => {
    const { net, open } = setup()
    net.listenError = netError('EADDRNOTAVAIL', 'listen EADDRNOTAVAIL: address not available')
    await expect(open(1, L)).rejects.toMatchObject({
      error: { code: 'TUNNEL_FAILED', message: expect.stringContaining('address not available') },
    })
  })
})

describe('TunnelManager dynamic forward', () => {
  const greet = [5, 1, 0]
  const connectTo = (host: string, port: number) => [
    5,
    1,
    0,
    3,
    host.length,
    ...Buffer.from(host),
    port >> 8,
    port & 255,
  ]

  it('speaks SOCKS5, opens the requested destination and bridges the traffic', async () => {
    const { net, conn, open } = setup()
    await open(1, D)
    const client = net.client()
    client.write(Buffer.from(greet))
    expect([...(await readBytes(client))]).toEqual([5, 0])
    client.write(Buffer.from(connectTo('example.com', 80)))
    const reply = await readBytes(client)
    expect([...reply]).toEqual([...socksReply(REPLY.succeeded)])
    expect(conn.outs[0]).toMatchObject({ dstHost: 'example.com', dstPort: 80 })
    client.write('GET /')
    expect(await read(out(conn, 0).remote)).toBe('GET /')
  })

  it('answers connection refused when the channel fails', async () => {
    const { net, conn, open } = setup()
    conn.forwardOutError = new Error('Connection refused')
    await open(1, D)
    const client = net.client()
    client.write(Buffer.from([...greet, ...connectTo('x.test', 1)]))
    const chunks: Buffer[] = []
    client.on('data', (d: Buffer) => chunks.push(d))
    await settle()
    const all = Buffer.concat(chunks)
    expect([...all.subarray(0, 2)]).toEqual([5, 0])
    expect([...all.subarray(2, 12)]).toEqual([...socksReply(REPLY.refused)])
  })

  it('destroys a client that never finishes the handshake', async () => {
    const { net, scheduler, open } = setup()
    await open(1, D)
    const client = net.client()
    client.write(Buffer.from([5]))
    await settle()
    scheduler.advance(TUNNEL.socksHandshakeMs)
    await settle()
    expect(client.destroyed).toBe(true)
  })

  it('closes a client that speaks something else', async () => {
    const { net, open } = setup()
    await open(1, D)
    const client = net.client()
    const chunks: Buffer[] = []
    client.on('data', (d: Buffer) => chunks.push(d))
    client.write('GET / HTTP/1.1\r\n\r\n')
    await settle()
    expect([...Buffer.concat(chunks)]).toEqual([5, 0xff])
    expect(client.readableEnded).toBe(true)
  })
})

describe('TunnelManager remote forward', () => {
  it('asks the server to listen and bridges incoming connections to the local target', async () => {
    const { net, conn, open, last } = setup()
    const port = await open(1, R)
    expect(port).toBe(5000)
    expect(conn.forwarded).toEqual([{ host: '127.0.0.1', port: 5000 }])
    expect(last(1)).toMatchObject({ state: 'open', boundPort: 5000 })

    const { accepted, peer } = conn.incoming(5000)
    expect(accepted).toBe(true)
    expect(net.outbound[0]).toMatchObject({ host: 'localhost', port: 3000 })
    peer?.write('hello')
    expect(await read(outbound(net).peer)).toBe('hello')
  })

  it('delivers the last reply of a target that answers and closes right away', async () => {
    const { net, conn, open } = setup()
    await open(1, R)
    const { peer } = conn.incoming(5000)
    outbound(net).peer.end('adios')
    const chunks: Buffer[] = []
    peer?.on('data', (d: Buffer) => chunks.push(d))
    await settle()
    expect(Buffer.concat(chunks).toString()).toBe('adios')
  })

  it('rejects connections for ports no tunnel owns', async () => {
    const { conn, open } = setup()
    await open(1, R)
    expect(conn.incoming(9999).accepted).toBe(false)
  })

  it('reports a denied remote forward and does not leave the tunnel active', async () => {
    const { conn, manager, open, last } = setup()
    conn.forwardInError = new Error('Administratively prohibited')
    await expect(open(1, R)).rejects.toMatchObject({
      error: { code: 'TUNNEL_FAILED', message: expect.stringContaining('no permite') },
    })
    expect(manager.countFor(S1)).toBe(0)
    expect(last(1)).toBeUndefined()
  })
})

describe('TunnelManager closing', () => {
  it('close() stops the listener, ends live connections and reports closed', async () => {
    const { net, conn, manager, open, last } = setup()
    await open(1, L)
    const client = net.client()
    await settle()
    manager.close(id(1))
    await settle()
    expect(net.serversClosed).toBe(1)
    expect(client.destroyed).toBe(true)
    expect(out(conn, 0).remote.destroyed).toBe(true)
    expect(last(1)).toMatchObject({ state: 'closed', connections: 0 })
    expect(manager.countFor(S1)).toBe(0)
  })

  it('closing a session closes its tunnels and their sockets, and only theirs', async () => {
    const { net, manager, conn, open, last } = setup()
    const other = new FakeTunnelConnection()
    await open(1, L)
    await open(2, R)
    const client = net.client()
    await settle()
    await open(3, L, S2, other)
    manager.closeSession(S1)
    await settle()
    expect(client.destroyed).toBe(true)
    expect(conn.unforwarded).toEqual([{ host: '127.0.0.1', port: 5000 }])
    expect(last(1)?.state).toBe('closed')
    expect(last(2)?.state).toBe('closed')
    expect(last(3)?.state).toBe('open')
    expect(manager.countFor(S1)).toBe(0)
    expect(manager.countFor(S2)).toBe(1)
  })

  it('close() of an unknown tunnel is a no-op', () => {
    const { manager } = setup()
    expect(() => manager.close(id(9))).not.toThrow()
  })

  it('refuses to reuse a tunnel id that is still open', async () => {
    const { open } = setup()
    await open(1, L)
    await expect(open(1, L)).rejects.toMatchObject({ error: { code: 'INVALID_MESSAGE' } })
  })
})

describe('TunnelManager review fixes', () => {
  const gate = () => {
    let release: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }

  it('I3: a session that closes while its tunnel is opening does not leave a listener behind', async () => {
    const { net, manager, open } = setup()
    const g = gate()
    net.listenGate = g.promise
    const opening = open(1, L)
    manager.closeSession(S1)
    g.release()
    await expect(opening).rejects.toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } })
    expect(net.serversClosed).toBe(1)
    expect(manager.countFor(S1)).toBe(0)
  })

  it('I3: a remote forward granted after the session closed is given back', async () => {
    const { conn, manager, open } = setup()
    const g = gate()
    conn.forwardInGate = g.promise
    const opening = open(1, R)
    manager.closeSession(S1)
    g.release()
    await expect(opening).rejects.toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } })
    await settle()
    expect(conn.unforwarded).toEqual([{ host: '127.0.0.1', port: 5000 }])
    expect(conn.incoming(5000).accepted).toBe(false)
  })

  it('I4: a finished -R connection leaves nothing behind in the tunnel', async () => {
    const { net, conn, manager, open } = setup()
    await open(1, R)
    conn.incoming(5000)
    expect(manager.streamCount(id(1))).toBeGreaterThan(0)
    outbound(net).peer.destroy()
    await settle()
    expect(manager.streamCount(id(1))).toBe(0)
  })

  it('I5: a second -R tunnel on the same server port is refused and keeps the first one routed', async () => {
    const { conn, manager, open } = setup()
    await open(1, { ...R, bindPort: 7000 })
    await expect(open(2, { ...R, bindHost: '::1', bindPort: 7000 })).rejects.toMatchObject({
      error: { code: 'TUNNEL_BIND_IN_USE' },
    })
    expect(conn.incoming(7000).accepted).toBe(true)
    manager.close(id(2))
    expect(conn.incoming(7000).accepted).toBe(true)
    manager.close(id(1))
    expect(conn.incoming(7000).accepted).toBe(false)
  })

  it('I6: a listener that dies after it started reports an error and closes the tunnel', async () => {
    const { net, manager, open, last } = setup()
    await open(1, L)
    net.failServer(netError('EIO', 'the interface went away'))
    expect(last(1)).toMatchObject({ state: 'error', error: { code: 'TUNNEL_FAILED' } })
    expect(net.serversClosed).toBe(1)
    expect(manager.countFor(S1)).toBe(0)
  })

  it('I7: gives up on a server that never answers forwardIn and returns a late grant', async () => {
    const { conn, scheduler, manager, open } = setup()
    const g = gate()
    conn.forwardInGate = g.promise
    const opening = open(1, R)
    const outcome = opening.catch((e: unknown) => e)
    scheduler.advance(TIMEOUTS.controlMs)
    expect(await outcome).toMatchObject({ error: { code: 'TUNNEL_FAILED' } })
    g.release()
    await settle()
    expect(conn.unforwarded).toEqual([{ host: '127.0.0.1', port: 5000 }])
    expect(manager.countFor(S1)).toBe(0)
  })

  it('I7: drops a client whose channel never opens, and closes the channel if it opens late', async () => {
    const { net, conn, scheduler, open } = setup()
    await open(1, L)
    const g = gate()
    conn.forwardOutGate = g.promise
    const client = net.client()
    await settle()
    scheduler.advance(TIMEOUTS.controlMs)
    await settle()
    expect(client.destroyed).toBe(true)
    g.release()
    await settle()
    expect(out(conn).remote.destroyed).toBe(true)
  })
})
