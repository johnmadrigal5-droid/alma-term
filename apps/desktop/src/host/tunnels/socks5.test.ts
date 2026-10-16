// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { REPLY, Socks5Handshake, socksReply, type SocksStep } from './socks5'

const bytes = (...n: number[]) => Uint8Array.from(n)
const text = (s: string) => [...Buffer.from(s)]
const GREETING = bytes(5, 1, 0)
const ipv4 = (port = 80) => bytes(5, 1, 0, 1, 93, 184, 216, 34, port >> 8, port & 255)

function replyOf(step: SocksStep): number[] {
  if (step.kind !== 'reply') throw new Error(`expected reply, got ${step.kind}`)
  return [...step.bytes]
}

describe('Socks5Handshake', () => {
  it('accepts the no-auth method and then an IPv4 CONNECT', () => {
    const s = new Socks5Handshake()
    expect(replyOf(s.push(GREETING))).toEqual([5, 0])
    expect(s.push(ipv4())).toEqual({
      kind: 'connect',
      request: { host: '93.184.216.34', port: 80 },
      rest: new Uint8Array(0),
    })
  })

  it('reads a domain name and sends it unresolved', () => {
    const s = new Socks5Handshake()
    s.push(GREETING)
    const name = text('example.com')
    const step = s.push(bytes(5, 1, 0, 3, name.length, ...name, 1, 187))
    expect(step).toMatchObject({ kind: 'connect', request: { host: 'example.com', port: 443 } })
  })

  it('reads an IPv6 address', () => {
    const s = new Socks5Handshake()
    s.push(GREETING)
    const addr = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    const step = s.push(bytes(5, 1, 0, 4, ...addr, 0, 22))
    expect(step).toMatchObject({
      kind: 'connect',
      request: { host: '2001:db8:0:0:0:0:0:1', port: 22 },
    })
  })

  it('waits for more bytes when the request is truncated, one byte at a time', () => {
    const s = new Socks5Handshake()
    const all = [...GREETING, ...ipv4(8080)]
    const steps = all.map((b) => s.push(bytes(b)))
    expect(steps.slice(0, -1).filter((x) => x.kind === 'connect')).toEqual([])
    expect(steps.at(-1)).toMatchObject({ kind: 'connect', request: { port: 8080 } })
  })

  it('answers the greeting first when the request is pipelined behind it', () => {
    const s = new Socks5Handshake()
    expect(replyOf(s.push(bytes(...GREETING, ...ipv4())))).toEqual([5, 0])
    // The caller drains the buffered request after sending the greeting reply.
    expect(s.push(new Uint8Array(0))).toMatchObject({
      kind: 'connect',
      request: { host: '93.184.216.34', port: 80 },
    })
  })

  it('returns bytes the client sent right after the request', () => {
    const s = new Socks5Handshake()
    s.push(GREETING)
    const step = s.push(bytes(...ipv4(), 0x47, 0x45, 0x54))
    expect(step).toMatchObject({ kind: 'connect', rest: bytes(0x47, 0x45, 0x54) })
  })

  it('rejects a version other than 5 in the greeting and closes', () => {
    const step = new Socks5Handshake().push(bytes(4, 1, 0))
    expect(step).toMatchObject({ kind: 'reply', close: true })
    expect(replyOf(step)).toEqual([5, 0xff])
  })

  it('rejects a greeting with no methods or without the no-auth method', () => {
    expect(replyOf(new Socks5Handshake().push(bytes(5, 0)))).toEqual([5, 0xff])
    const step = new Socks5Handshake().push(bytes(5, 2, 1, 2))
    expect(step).toMatchObject({ kind: 'reply', close: true })
    expect(replyOf(step)).toEqual([5, 0xff])
  })

  it('answers command not supported for BIND and UDP ASSOCIATE', () => {
    for (const cmd of [2, 3]) {
      const s = new Socks5Handshake()
      s.push(GREETING)
      const step = s.push(bytes(5, cmd, 0, 1, 1, 2, 3, 4, 0, 80))
      expect(step).toMatchObject({ kind: 'reply', close: true })
      expect(replyOf(step)).toEqual([...socksReply(REPLY.commandUnsupported)])
    }
  })

  it('answers address type not supported for an unknown ATYP', () => {
    const s = new Socks5Handshake()
    s.push(GREETING)
    const step = s.push(bytes(5, 1, 0, 9, 0, 0))
    expect(replyOf(step)).toEqual([...socksReply(REPLY.addressUnsupported)])
  })

  it('answers a general failure for an empty domain name', () => {
    const s = new Socks5Handshake()
    s.push(GREETING)
    const step = s.push(bytes(5, 1, 0, 3, 0, 0, 80))
    expect(step).toMatchObject({ kind: 'reply', close: true })
    expect(replyOf(step)).toEqual([...socksReply(REPLY.general)])
  })

  it('ignores anything pushed after the handshake ended', () => {
    const s = new Socks5Handshake()
    s.push(bytes(4, 1, 0))
    expect(s.push(GREETING)).toEqual({ kind: 'need-more' })
  })

  it('builds a reply with a zero bound address', () => {
    expect([...socksReply(REPLY.refused)]).toEqual([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
  })
})
