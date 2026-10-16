import { describe, expect, it } from 'vitest'
import { DataFromRenderer, DataToRenderer } from './data'

describe('data messages', () => {
  it('accepts Uint8Array payloads', () => {
    expect(
      DataToRenderer.safeParse({ type: 'data', seq: 0, bytes: new Uint8Array([104, 105]) }).success,
    ).toBe(true)
    expect(DataFromRenderer.safeParse({ type: 'input', bytes: new Uint8Array([10]) }).success).toBe(
      true,
    )
  })
  it('rejects plain arrays as bytes', () => {
    expect(DataFromRenderer.safeParse({ type: 'input', bytes: [10] }).success).toBe(false)
  })
  it('requires positive ack counts', () => {
    expect(DataFromRenderer.safeParse({ type: 'ack', bytes: 0 }).success).toBe(false)
    expect(DataFromRenderer.safeParse({ type: 'ack', bytes: 512 }).success).toBe(true)
  })
  it('accepts exit with null code', () => {
    expect(DataToRenderer.safeParse({ type: 'exit', code: null }).success).toBe(true)
  })
})
