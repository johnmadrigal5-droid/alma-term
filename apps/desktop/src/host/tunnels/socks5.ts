export interface SocksRequest {
  host: string
  port: number
}

export type SocksStep =
  | { kind: 'need-more' }
  /** Send these bytes; when `close` is set the client is done and the socket must end. */
  | { kind: 'reply'; bytes: Uint8Array; close?: boolean }
  /** Handshake complete. `rest` is what the client already sent after the request. */
  | { kind: 'connect'; request: SocksRequest; rest: Uint8Array }

export const REPLY = {
  succeeded: 0,
  general: 1,
  notAllowed: 2,
  netUnreachable: 3,
  hostUnreachable: 4,
  refused: 5,
  ttl: 6,
  commandUnsupported: 7,
  addressUnsupported: 8,
} as const

const NO_AUTH = 0
const NO_ACCEPTABLE_METHOD = 0xff
const CMD_CONNECT = 1

/** The reply to a request: VER 5, REP, RSV 0, ATYP IPv4 with a 0.0.0.0:0 bound address. */
export function socksReply(code: number): Uint8Array {
  return Uint8Array.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])
}

const refuse = (code: number): SocksStep => ({
  kind: 'reply',
  bytes: socksReply(code),
  close: true,
})

function formatIpv6(b: Uint8Array): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push((((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)).toString(16))
  return groups.join(':')
}

/**
 * Server side of a SOCKS5 handshake (RFC 1928): no authentication, CONNECT only. Fed with
 * whatever the client sends, in any chunking; never throws. After a `reply` that is not final,
 * push an empty chunk to continue with bytes already buffered. Domain names stay unresolved so
 * the SSH server resolves them (nothing leaks through the local DNS).
 */
export class Socks5Handshake {
  private buffer = new Uint8Array(0)
  private phase: 'greeting' | 'request' | 'done' = 'greeting'

  push(chunk: Uint8Array): SocksStep {
    if (this.phase === 'done') return { kind: 'need-more' }
    const merged = new Uint8Array(this.buffer.length + chunk.length)
    merged.set(this.buffer)
    merged.set(chunk, this.buffer.length)
    this.buffer = merged
    if (this.phase === 'greeting') return this.greeting()
    return this.request()
  }

  private finish<T extends SocksStep>(step: T): T {
    this.phase = 'done'
    return step
  }

  private greeting(): SocksStep {
    const b = this.buffer
    if (b.length < 2) return { kind: 'need-more' }
    if (b[0] !== 5) return this.finish(this.noMethod())
    const count = b[1] ?? 0
    if (count === 0) return this.finish(this.noMethod())
    if (b.length < 2 + count) return { kind: 'need-more' }
    const methods = b.subarray(2, 2 + count)
    if (!methods.includes(NO_AUTH)) return this.finish(this.noMethod())
    this.buffer = b.subarray(2 + count)
    this.phase = 'request'
    // A client may pipeline its request behind the greeting: it stays buffered, and the caller
    // drains it with `push(new Uint8Array(0))` once the reply went out.
    return { kind: 'reply', bytes: Uint8Array.from([5, NO_AUTH]) }
  }

  private noMethod(): SocksStep {
    return { kind: 'reply', bytes: Uint8Array.from([5, NO_ACCEPTABLE_METHOD]), close: true }
  }

  private request(): SocksStep {
    const b = this.buffer
    if (b.length < 4) return { kind: 'need-more' }
    if (b[0] !== 5) return this.finish(refuse(REPLY.general))
    if (b[1] !== CMD_CONNECT) return this.finish(refuse(REPLY.commandUnsupported))
    const atyp = b[3]
    let host: string
    let end: number
    if (atyp === 1) {
      if (b.length < 4 + 4 + 2) return { kind: 'need-more' }
      host = [...b.subarray(4, 8)].join('.')
      end = 8
    } else if (atyp === 3) {
      if (b.length < 5) return { kind: 'need-more' }
      const length = b[4] ?? 0
      if (length === 0) return this.finish(refuse(REPLY.general))
      if (b.length < 5 + length + 2) return { kind: 'need-more' }
      host = Buffer.from(b.subarray(5, 5 + length)).toString('latin1')
      end = 5 + length
    } else if (atyp === 4) {
      if (b.length < 4 + 16 + 2) return { kind: 'need-more' }
      host = formatIpv6(b.subarray(4, 20))
      end = 20
    } else {
      return this.finish(refuse(REPLY.addressUnsupported))
    }
    const port = ((b[end] ?? 0) << 8) | (b[end + 1] ?? 0)
    return this.finish({
      kind: 'connect',
      request: { host, port },
      rest: b.subarray(end + 2),
    })
  }
}
