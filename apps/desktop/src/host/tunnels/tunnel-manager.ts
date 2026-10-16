import { pipeline, type Duplex } from 'node:stream'
import {
  TIMEOUTS,
  TUNNEL,
  TunnelSpec,
  type ProtocolError,
  type TunnelEvent,
  type TunnelState,
} from '@alma/protocol'
import type { Scheduler } from '../flow/scheduler'
import type { SshConnection } from '../ssh/connector-types'
import { REPLY, Socks5Handshake, socksReply, type SocksStep } from './socks5'

export interface TunnelSocket extends Duplex {
  remoteAddress?: string
  remotePort?: number
}

/** The local TCP side, injectable so tests run without sockets. */
export interface TunnelNet {
  listen(
    host: string,
    port: number,
    onSocket: (socket: TunnelSocket) => void,
    /** The server failed after it started listening. */
    onError?: (error: Error) => void,
  ): Promise<{ port: number; close(): void }>
  connect(host: string, port: number): Duplex
}

export type TunnelConnection = Required<
  Pick<SshConnection, 'forwardOut' | 'forwardIn' | 'unforwardIn' | 'onTcpConnection'>
>

export class TunnelFailure extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.message)
  }
}

const failure = (code: ProtocolError['code'], message: string) =>
  new TunnelFailure({ code, message })

interface Tunnel {
  id: string
  sessionId: string
  spec: TunnelSpec
  conn: TunnelConnection
  boundPort: number
  closed: boolean
  server: { close(): void } | null
  /** Clients (local sockets, or channels of a -R) still open: what the counter shows. */
  live: Set<Duplex>
  /** Every stream to destroy on close, clients and their channels. */
  streams: Set<Duplex>
}

interface Deps {
  net: TunnelNet
  scheduler: Scheduler
  send(event: TunnelEvent): void
}

function refusalFor(error: unknown): number {
  const message = error instanceof Error ? error.message : ''
  if (/refused/i.test(message)) return REPLY.refused
  if (/unreach|no route|not known|ENOTFOUND/i.test(message)) return REPLY.hostUnreachable
  return REPLY.general
}

/**
 * Local (-L), remote (-R) and dynamic (-D, SOCKS5) forwards over SSH connections. A tunnel lives
 * as long as its session: closing the session closes its listeners, channels and sockets.
 */
export class TunnelManager {
  private readonly tunnels = new Map<string, Tunnel>()
  /** -R routes by the port the server reports, per session. */
  private readonly routes = new Map<string, Map<number, Tunnel>>()
  private readonly subscribed = new WeakSet<object>()
  /** Bumped when a session closes: an open() that started before it must not register. */
  private readonly generations = new Map<string, number>()

  constructor(private readonly deps: Deps) {}

  private generation(sessionId: string): number {
    return this.generations.get(sessionId) ?? 0
  }

  /** Streams still held by a tunnel (clients and channels). */
  streamCount(tunnelId: string): number {
    return this.tunnels.get(tunnelId)?.streams.size ?? 0
  }

  countFor(sessionId: string): number {
    return [...this.tunnels.values()].filter((t) => t.sessionId === sessionId).length
  }

  /** Opens the tunnel and resolves with the port it listens on (locally for L and D). */
  async open(
    sessionId: string,
    tunnelId: string,
    rawSpec: TunnelSpec,
    conn: TunnelConnection,
  ): Promise<number> {
    const parsed = TunnelSpec.safeParse(rawSpec)
    if (!parsed.success) throw failure('INVALID_MESSAGE', 'Túnel inválido')
    const spec = parsed.data
    if (this.tunnels.has(tunnelId)) throw failure('INVALID_MESSAGE', 'El túnel ya existe')
    const generation = this.generation(sessionId)
    const tunnel: Tunnel = {
      id: tunnelId,
      sessionId,
      spec,
      conn,
      boundPort: 0,
      closed: false,
      server: null,
      live: new Set(),
      streams: new Set(),
    }
    if (spec.type === 'R') await this.openRemote(tunnel)
    else await this.openLocal(tunnel)
    // The session closed or dropped while the server was answering: give everything back.
    if (this.generation(sessionId) !== generation) {
      this.abandon(tunnel)
      throw failure('SESSION_NOT_FOUND', 'La sesión se cerró mientras se abría el túnel')
    }
    this.tunnels.set(tunnelId, tunnel)
    this.emit(tunnel, 'open')
    return tunnel.boundPort
  }

  close(tunnelId: string, error?: ProtocolError): void {
    const tunnel = this.tunnels.get(tunnelId)
    if (!tunnel) return
    this.tunnels.delete(tunnelId)
    this.abandon(tunnel)
    this.emit(tunnel, error ? 'error' : 'closed', error)
  }

  /** Releases everything a tunnel holds: listener, route, server-side forward and streams. */
  private abandon(tunnel: Tunnel): void {
    tunnel.closed = true
    tunnel.server?.close()
    if (tunnel.spec.type === 'R' && tunnel.boundPort > 0) {
      const routes = this.routes.get(tunnel.sessionId)
      // Only our own route: another tunnel may own that port number under another address.
      if (routes?.get(tunnel.boundPort) === tunnel) routes.delete(tunnel.boundPort)
      if (routes?.size === 0) this.routes.delete(tunnel.sessionId)
      // The connection may be gone already (that is why we are closing).
      void tunnel.conn.unforwardIn(tunnel.spec.bindHost, tunnel.boundPort).catch(() => undefined)
    }
    for (const stream of tunnel.streams) stream.destroy()
    tunnel.streams.clear()
    tunnel.live.clear()
  }

  closeSession(sessionId: string): void {
    this.generations.set(sessionId, this.generation(sessionId) + 1)
    for (const tunnel of [...this.tunnels.values()])
      if (tunnel.sessionId === sessionId) this.close(tunnel.id)
  }

  dispose(): void {
    for (const id of [...this.tunnels.keys()]) this.close(id)
  }

  private async openLocal(tunnel: Tunnel): Promise<void> {
    const { spec } = tunnel
    try {
      const server = await this.deps.net.listen(
        spec.bindHost,
        spec.bindPort,
        (socket) =>
          spec.type === 'D' ? this.onSocks(tunnel, socket) : this.onLocal(tunnel, socket),
        (error) =>
          // The listener died on its own: say so instead of showing an active tunnel.
          this.close(tunnel.id, { code: 'TUNNEL_FAILED', message: error.message }),
      )
      tunnel.server = server
      tunnel.boundPort = server.port
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === 'EADDRINUSE')
        throw failure('TUNNEL_BIND_IN_USE', `El puerto ${spec.bindPort} ya está en uso`)
      if (code === 'EACCES')
        throw failure(
          'TUNNEL_FAILED',
          `Sin permiso para escuchar en el puerto ${spec.bindPort}; los puertos bajos suelen estar reservados`,
        )
      throw failure('TUNNEL_FAILED', error instanceof Error ? error.message : 'No se pudo escuchar')
    }
  }

  private async openRemote(tunnel: Tunnel): Promise<void> {
    const { spec, conn } = tunnel
    try {
      tunnel.boundPort = await this.withDeadline(
        conn.forwardIn(spec.bindHost, spec.bindPort),
        // The grant came after we gave up: hand the port back.
        (port) => void conn.unforwardIn(spec.bindHost, port).catch(() => undefined),
      )
    } catch (error) {
      if (error instanceof TunnelFailure) throw error
      throw failure('TUNNEL_FAILED', 'El servidor no permite reenviar puertos')
    }
    let routes = this.routes.get(tunnel.sessionId)
    if (!routes) this.routes.set(tunnel.sessionId, (routes = new Map()))
    // Routing is by port: another tunnel already owns this one under a different address.
    if (routes.has(tunnel.boundPort)) {
      void conn.unforwardIn(spec.bindHost, tunnel.boundPort).catch(() => undefined)
      tunnel.boundPort = 0
      throw failure('TUNNEL_BIND_IN_USE', 'Ese puerto del servidor ya lo usa otro túnel')
    }
    routes.set(tunnel.boundPort, tunnel)
    if (this.subscribed.has(conn)) return
    this.subscribed.add(conn)
    conn.onTcpConnection((info, accept, reject) => {
      const target = this.routes.get(tunnel.sessionId)?.get(info.destPort)
      if (!target || target.closed || target.live.size >= TUNNEL.maxConnections) return reject()
      const channel = accept()
      const local = this.deps.net.connect(target.spec.targetHost ?? '', target.spec.targetPort ?? 0)
      this.track(target, channel)
      target.streams.add(local)
      local.once('close', () => {
        target.streams.delete(local)
      })
      this.bridge(channel, local)
    })
  }

  private onLocal(tunnel: Tunnel, socket: TunnelSocket): void {
    if (!this.admit(tunnel, socket)) return
    const { targetHost, targetPort } = tunnel.spec
    this.channelFor(tunnel, socket, targetHost ?? '', targetPort ?? 0).then(
      (channel) => this.attach(tunnel, socket, channel),
      () => socket.destroy(),
    )
  }

  private onSocks(tunnel: Tunnel, socket: TunnelSocket): void {
    if (!this.admit(tunnel, socket)) return
    const handshake = new Socks5Handshake()
    const timer = this.deps.scheduler.setTimeout(() => socket.destroy(), TUNNEL.socksHandshakeMs)
    const stop = () => {
      this.deps.scheduler.clearTimeout(timer)
      socket.off('data', onData)
      socket.pause()
    }
    const send = (bytes: Uint8Array) => {
      if (!socket.destroyed) socket.write(bytes)
    }
    const handle = (step: SocksStep): void => {
      if (step.kind === 'need-more') return
      if (step.kind === 'reply') {
        send(step.bytes)
        if (step.close) {
          stop()
          socket.end()
          return
        }
        return handle(handshake.push(new Uint8Array(0)))
      }
      stop()
      const { host, port } = step.request
      this.channelFor(tunnel, socket, host, port).then(
        (channel) => {
          if (socket.destroyed || tunnel.closed) return channel.destroy()
          send(socksReply(REPLY.succeeded))
          if (step.rest.length > 0) channel.write(step.rest)
          this.attach(tunnel, socket, channel)
        },
        (error: unknown) => {
          send(socksReply(refusalFor(error)))
          socket.end()
        },
      )
    }
    const onData = (chunk: Buffer) => handle(handshake.push(chunk))
    socket.on('data', onData)
  }

  /** A channel to the target; a server that never answers is given up on, and a late one closed. */
  private channelFor(tunnel: Tunnel, socket: TunnelSocket, host: string, port: number) {
    return this.withDeadline(
      tunnel.conn.forwardOut(
        socket.remoteAddress ?? '127.0.0.1',
        socket.remotePort ?? 0,
        host,
        port,
      ),
      (channel) => channel.destroy(),
    )
  }

  /**
   * Waits for `work` at most the control deadline. When it answers after that, `onLate` gets
   * the value so what it opened can be released.
   */
  private withDeadline<T>(work: Promise<T>, onLate: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let late = false
      const timer = this.deps.scheduler.setTimeout(() => {
        late = true
        reject(failure('TUNNEL_FAILED', 'El servidor no respondió a tiempo'))
      }, TIMEOUTS.controlMs)
      work.then(
        (value) => {
          this.deps.scheduler.clearTimeout(timer)
          if (late) onLate(value)
          else resolve(value)
        },
        (error: unknown) => {
          this.deps.scheduler.clearTimeout(timer)
          if (!late) reject(error)
        },
      )
    })
  }

  /** Counts a client against the limit; false (and destroyed) when the tunnel is full. */
  private admit(tunnel: Tunnel, socket: TunnelSocket): boolean {
    // Without a listener an error on the socket would be thrown on the host process.
    socket.on('error', () => socket.destroy())
    if (tunnel.closed || tunnel.live.size >= TUNNEL.maxConnections) {
      socket.destroy()
      return false
    }
    this.track(tunnel, socket)
    return true
  }

  private track(tunnel: Tunnel, client: Duplex): void {
    tunnel.live.add(client)
    tunnel.streams.add(client)
    this.emit(tunnel, 'open')
    client.once('close', () => {
      tunnel.streams.delete(client)
      if (tunnel.live.delete(client) && !tunnel.closed) this.emit(tunnel, 'open')
    })
  }

  private attach(tunnel: Tunnel, socket: Duplex, channel: Duplex): void {
    if (socket.destroyed || tunnel.closed) {
      channel.destroy()
      return
    }
    tunnel.streams.add(channel)
    channel.once('close', () => {
      tunnel.streams.delete(channel)
    })
    this.bridge(socket, channel)
  }

  /**
   * Both directions. `pipeline` lets each direction flush what it holds before ending (a server
   * that answers and closes must not lose its reply) and takes both sides down on an error or a
   * premature close.
   */
  private bridge(a: Duplex, b: Duplex): void {
    const onDone = (error: Error | null) => {
      if (!error) return
      a.destroy()
      b.destroy()
    }
    pipeline(a, b, onDone)
    pipeline(b, a, onDone)
  }

  private emit(tunnel: Tunnel, state: TunnelState, error?: ProtocolError): void {
    this.deps.send({
      type: 'event.tunnel',
      tunnelId: tunnel.id,
      sessionId: tunnel.sessionId,
      spec: tunnel.spec,
      state,
      boundPort: tunnel.boundPort,
      connections: tunnel.live.size,
      ...(error ? { error } : {}),
    })
  }
}
