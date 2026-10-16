import { describe, expect, it } from 'vitest'
import { ByteRing } from './ring-buffer'

const b = (...n: number[]) => new Uint8Array(n)

describe('ByteRing', () => {
  it('returns everything while under capacity', () => {
    const r = new ByteRing(8)
    r.append(b(1, 2, 3))
    r.append(b(4))
    expect(r.snapshot()).toEqual(b(1, 2, 3, 4))
  })
  it('keeps only the newest bytes after wrapping', () => {
    const r = new ByteRing(4)
    r.append(b(1, 2, 3))
    r.append(b(4, 5, 6))
    expect(r.snapshot()).toEqual(b(3, 4, 5, 6))
  })
  it('handles a chunk larger than the capacity', () => {
    const r = new ByteRing(3)
    r.append(b(1))
    r.append(b(2, 3, 4, 5, 6))
    expect(r.snapshot()).toEqual(b(4, 5, 6))
  })
  it('matches the tail of the full stream after many appends', () => {
    const r = new ByteRing(10)
    const all: number[] = []
    for (let i = 0; i < 57; i++) {
      const chunk = b(i % 256, (i * 3) % 256)
      all.push(...chunk)
      r.append(chunk)
    }
    expect(r.snapshot()).toEqual(new Uint8Array(all.slice(-10)))
  })
})
