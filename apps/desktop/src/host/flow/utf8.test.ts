import { describe, expect, it } from 'vitest'
import { incompleteUtf8TailLength } from './utf8'

const bytes = (...b: number[]) => new Uint8Array(b)

describe('incompleteUtf8TailLength', () => {
  it('returns 0 for ascii and empty input', () => {
    expect(incompleteUtf8TailLength(bytes(0x61, 0x62))).toBe(0)
    expect(incompleteUtf8TailLength(bytes())).toBe(0)
  })
  it('detects a cut 3-byte char (euro sign)', () => {
    expect(incompleteUtf8TailLength(bytes(0x41, 0xe2, 0x82))).toBe(2)
    expect(incompleteUtf8TailLength(bytes(0x41, 0xe2))).toBe(1)
  })
  it('returns 0 for a complete char', () => {
    expect(incompleteUtf8TailLength(bytes(0xe2, 0x82, 0xac))).toBe(0)
  })
  it('detects a cut 4-byte char (emoji)', () => {
    expect(incompleteUtf8TailLength(bytes(0xf0, 0x9f, 0x98))).toBe(3)
  })
  it('ignores stray continuation bytes', () => {
    expect(incompleteUtf8TailLength(bytes(0x80, 0x80))).toBe(0)
  })
})
