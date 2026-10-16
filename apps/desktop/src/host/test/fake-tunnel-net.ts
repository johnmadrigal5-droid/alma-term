import { duplexPair, type Duplex } from 'node:stream'
import type { TunnelConnection, TunnelNet, TunnelSocket } from '../tunnels/tunnel-manager'

type Failure = Error & { code?: string }

/** Two ends of a connection: like TCP, destroying one end takes the other down. */
export function socketPair(): [Duplex, Duplex] {
  const [a, b] = duplexPair({ allowHalfOpen: false })
  a.once('close', () => b.destroy())
  b.once('close', () => a.destroy())
  return [a, b]
}

export const netError = (code: string, message = code): Failure =>
  Object.assign(new Error(message), { code })

/** The local side of the tunnel manager: listening servers and outgoing connections, by hand. */
export class FakeTunnelNet implements TunnelNet {
  listenError: Failure | null = null
  readonly listened: { host: string; port: number }[] = []
  serversClosed = 0
  nextPort = 40_000
  /** listen() waits for this before answering (the session may die meanwhile). */
  listenGate: Promise<void> | null = null
  private serverError: ((error: Error) => void) | null = null
  /** Connections the manager opened toward a -R target, with the test's end of each. */
  readonly outbound: { host: string; port: number; peer: Duplex }[] = []
  private onSocket: ((socket: TunnelSocket) => void) | null = null

  async listen(
    host: string,
    port: number,
    onSocket: (socket: TunnelSocket) => void,
    onError?: (error: Error) => void,
  ) {
    await this.listenGate
    if (this.listenError) throw this.listenError
    this.serverError = onError ?? null
    const bound = port === 0 ? this.nextPort++ : port
    this.listened.push({ host, port: bound })
    this.onSocket = onSocket
    return {
      port: bound,
      close: () => {
        this.serversClosed += 1
      },
    }
  }

  connect(host: string, port: number): Duplex {
    const [local, peer] = socketPair()
    this.outbound.push({ host, port, peer })
    return local
  }

  /** The listening server fails after it started (the interface went away, say). */
  failServer(error: Error): void {
    this.serverError?.(error)
  }

  /** A client connecting to the listening port; returns the client's end of the socket. */
  client(): Duplex {
    const [clientEnd, serverEnd] = socketPair()
    this.onSocket?.(serverEnd as TunnelSocket)
    return clientEnd
  }
}

/** The SSH side: channels the manager asked for, with the test's end of each. */
export class FakeTunnelConnection implements TunnelConnection {
  forwardOutError: Error | null = null
  forwardInError: Error | null = null
  nextRemotePort = 5000
  /** forwardIn / forwardOut wait for these before answering (a server that never replies). */
  forwardInGate: Promise<void> | null = null
  forwardOutGate: Promise<void> | null = null
  readonly outs: {
    srcHost: string
    srcPort: number
    dstHost: string
    dstPort: number
    remote: Duplex
  }[] = []
  readonly forwarded: { host: string; port: number }[] = []
  readonly unforwarded: { host: string; port: number }[] = []
  private tcpListener: Parameters<TunnelConnection['onTcpConnection']>[0] | null = null

  forwardOut = async (srcHost: string, srcPort: number, dstHost: string, dstPort: number) => {
    await this.forwardOutGate
    if (this.forwardOutError) throw this.forwardOutError
    const [local, remote] = socketPair()
    this.outs.push({ srcHost, srcPort, dstHost, dstPort, remote })
    return local
  }

  forwardIn = async (host: string, port: number) => {
    await this.forwardInGate
    if (this.forwardInError) throw this.forwardInError
    const bound = port === 0 ? this.nextRemotePort++ : port
    this.forwarded.push({ host, port: bound })
    return bound
  }

  unforwardIn = async (host: string, port: number) => {
    this.unforwarded.push({ host, port })
  }

  onTcpConnection: TunnelConnection['onTcpConnection'] = (listener) => {
    this.tcpListener = listener
  }

  /** The server delivers a connection that arrived on a remotely forwarded port. */
  incoming(destPort: number): { accepted: boolean; peer: Duplex | null } {
    let peer: Duplex | null = null
    let accepted = false
    this.tcpListener?.(
      { destHost: '127.0.0.1', destPort, srcHost: '10.0.0.9', srcPort: 51_000 },
      () => {
        accepted = true
        const [local, remote] = socketPair()
        peer = remote
        return local
      },
      () => undefined,
    )
    return { accepted, peer }
  }
}
