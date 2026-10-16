import { describe, expect, it } from 'vitest'
import { FakeScheduler } from '../test/fake-scheduler'
import { Coalescer } from './coalescer'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

function setup() {
  const scheduler = new FakeScheduler()
  const out: Uint8Array[] = []
  const c = new Coalescer((b) => out.push(b.slice()), 12, scheduler)
  return { scheduler, out, c }
}

describe('Coalescer', () => {
  it('emits immediately when idle', () => {
    const { out, c } = setup()
    c.push(enc('a'))
    expect(out.map(dec)).toEqual(['a'])
  })

  it('batches chunks that arrive inside the window', () => {
    const { scheduler, out, c } = setup()
    c.push(enc('a'))
    scheduler.advance(2)
    c.push(enc('b'))
    scheduler.advance(2)
    c.push(enc('c'))
    expect(out.map(dec)).toEqual(['a'])
    scheduler.advance(12)
    expect(out.map(dec)).toEqual(['a', 'bc'])
  })

  it('holds an incomplete UTF-8 char until it is completed', () => {
    const { out, c } = setup()
    c.push(new Uint8Array([0xe2, 0x82]))
    expect(out).toHaveLength(0)
    c.push(new Uint8Array([0xac]))
    expect(out.map(dec)).toEqual(['€'])
  })

  it('force-flushes a lone lead byte after one window (binary output)', () => {
    const { scheduler, out, c } = setup()
    c.push(new Uint8Array([0x41, 0xe2]))
    expect(out).toEqual([new Uint8Array([0x41])])
    scheduler.advance(12)
    expect(out).toEqual([new Uint8Array([0x41]), new Uint8Array([0xe2])])
  })

  it('never loses or reorders bytes in a flood', () => {
    const { scheduler, out, c } = setup()
    const input = new Uint8Array(100_000)
    let seed = 7
    for (let i = 0; i < input.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      input[i] = seed & 0xff
    }
    for (let i = 0; i < 100; i++) {
      c.push(input.subarray(i * 1000, (i + 1) * 1000))
      scheduler.advance(1)
    }
    c.dispose()
    const total = out.reduce((n, b) => n + b.length, 0)
    const joined = new Uint8Array(total)
    let offset = 0
    for (const b of out) {
      joined.set(b, offset)
      offset += b.length
    }
    expect(joined).toEqual(input)
  })
})
