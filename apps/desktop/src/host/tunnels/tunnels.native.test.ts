import { once } from 'node:events'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { TunnelSpec, type TunnelEvent } from '@alma/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { realScheduler } from '../flow/scheduler'
import type { SshConnection } from '../ssh/connector-types'
import { ssh2Connector } from '../ssh/ssh2-connector'
import {
  dockerAvailable,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from '../ssh/test/ssh-server'
import { realTunnelNet } from './real-net'
import { TunnelManager, type TunnelConnection } from './tunnel-manager'

const hasDocker = dockerAvailable()
if (!hasDocker) console.warn('[tunnels] Docker no disponible: tests de túneles omitidos')

const SID = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const id = (n: number) => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n).padStart(2, '0')}`

function firstData(socket: Socket, timeoutMs = 8000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sin datos')), timeoutMs)
    socket.once('data', (d) => {
      clearTimeout(timer)
      resolve(d)
    })
    socket.once('error', reject)
  })
}

describe.skipIf(!hasDocker)('tunnels (native, Docker)', () => {
  let server: TestSshServer
  let connection: SshConnection
  let tunnelConn: TunnelConnection
  /** Connected before forwarding was enabled: the server denies its forwards. */
  let deniedConn: TunnelConnection
  const events: TunnelEvent[] = []
  const manager = new TunnelManager({
    net: realTunnelNet,
    scheduler: realScheduler,
    send: (e) => events.push(e),
  })

  const connectSsh = () =>
    ssh2Connector.connect({
      target: { host: server.host, port: server.port, username: SSH_TEST_USER },
      auth: { type: 'password', password: SSH_TEST_PASSWORD },
      cols: 80,
      rows: 24,
      rememberable: false,
      signal: new AbortController().signal,
      hooks: {
        step: () => {},
        verifyHostKey: async () => true,
        askAuth: async () => ({ responses: [], remember: false }),
      },
    })

  function forwardingOf(c: SshConnection): TunnelConnection {
    const { forwardOut, forwardIn, unforwardIn, onTcpConnection } = c
    if (!forwardOut || !forwardIn || !unforwardIn || !onTcpConnection)
      throw new Error('el conector no ofrece reenvío')
    return {
      forwardOut: forwardOut.bind(c),
      forwardIn: forwardIn.bind(c),
      unforwardIn: unforwardIn.bind(c),
      onTcpConnection: onTcpConnection.bind(c),
    }
  }

  let deniedSsh: SshConnection

  beforeAll(async () => {
    server = await startTestSshServer()
    deniedSsh = await connectSsh()
    deniedConn = forwardingOf(deniedSsh)
    await server.allowTcpForwarding()
    connection = await connectSsh()
    tunnelConn = forwardingOf(connection)
  }, 120_000)

  afterAll(() => {
    manager.dispose()
    connection?.end()
    deniedSsh?.end()
    server?.stop()
  })

  it('-R: a server that forbids forwarding is reported and leaves nothing active', async () => {
    const spec = TunnelSpec.parse({
      type: 'R',
      bindPort: 0,
      targetHost: '127.0.0.1',
      targetPort: 9,
    })
    await expect(manager.open(SID, id(9), spec, deniedConn)).rejects.toMatchObject({
      error: { code: 'TUNNEL_FAILED' },
    })
    expect(manager.countFor(SID)).toBe(0)
  }, 30_000)

  it('-L: a local port reaches a service seen from the server', async () => {
    // From the container, sshd itself listens on 2222.
    const spec = TunnelSpec.parse({
      type: 'L',
      bindPort: 0,
      targetHost: '127.0.0.1',
      targetPort: 2222,
    })
    const port = await manager.open(SID, id(1), spec, tunnelConn)
    expect(port).toBeGreaterThan(0)
    const socket = connect(port, '127.0.0.1')
    expect((await firstData(socket)).toString()).toMatch(/^SSH-/)
    socket.destroy()
  }, 30_000)

  it('-D: a SOCKS5 client reaches a service seen from the server', async () => {
    const spec = TunnelSpec.parse({ type: 'D', bindPort: 0 })
    const port = await manager.open(SID, id(2), spec, tunnelConn)
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(Buffer.from([5, 1, 0]))
    expect([...(await firstData(socket))]).toEqual([5, 0])
    socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 2222 >> 8, 2222 & 255]))
    const reply = await firstData(socket)
    expect([...reply.subarray(0, 2)]).toEqual([5, 0])
    // The banner may arrive with the reply or right after it.
    const banner = reply.length > 10 ? reply.subarray(10) : await firstData(socket)
    expect(banner.toString()).toMatch(/^SSH-/)
    socket.destroy()
  }, 30_000)

  it('-D: a SOCKS5 request to a closed port is answered as refused', async () => {
    const spec = TunnelSpec.parse({ type: 'D', bindPort: 0 })
    const port = await manager.open(SID, id(3), spec, tunnelConn)
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(Buffer.from([5, 1, 0]))
    await firstData(socket)
    socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 1, 1]))
    const reply = await firstData(socket)
    expect(reply[1]).not.toBe(0)
    socket.destroy()
  }, 30_000)

  it('-R: a port on the server reaches a service on this machine', async () => {
    const local: Server = createServer((s) => s.end('hola'))
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve))
    const address = local.address()
    const localPort = typeof address === 'object' && address ? address.port : 0
    const spec = TunnelSpec.parse({
      type: 'R',
      bindPort: 0,
      targetHost: '127.0.0.1',
      targetPort: localPort,
    })
    const remotePort = await manager.open(SID, id(4), spec, tunnelConn)
    expect(remotePort).toBeGreaterThan(0)
    const out = await server.exec(`sleep 2 | nc -w 3 127.0.0.1 ${remotePort}`)
    expect(out).toContain('hola')
    local.close()
  }, 30_000)

  it('closing a tunnel stops its port, and a session close ends the rest', async () => {
    const spec = TunnelSpec.parse({
      type: 'L',
      bindPort: 0,
      targetHost: '127.0.0.1',
      targetPort: 2222,
    })
    const port = await manager.open(SID, id(5), spec, tunnelConn)
    manager.close(id(5))
    const refused = await new Promise<boolean>((resolve) => {
      const probe = connect(port, '127.0.0.1')
      probe.once('connect', () => {
        probe.destroy()
        resolve(false)
      })
      probe.once('error', () => resolve(true))
    })
    expect(refused).toBe(true)
    expect(events.filter((e) => e.state === 'closed').map((e) => e.tunnelId)).toContain(id(5))
    manager.closeSession(SID)
    expect(manager.countFor(SID)).toBe(0)
  }, 30_000)
})
