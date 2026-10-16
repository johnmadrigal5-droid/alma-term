import { describe, expect, it } from 'vitest'
import { ControlRequest, ControlResponse } from './control'

const ids = {
  requestId: '6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f',
  sessionId: '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d',
}

describe('ControlRequest', () => {
  it('accepts local.open', () => {
    const r = ControlRequest.safeParse({ type: 'local.open', ...ids, cols: 80, rows: 24 })
    expect(r.success).toBe(true)
  })
  it('rejects unknown types', () => {
    expect(ControlRequest.safeParse({ type: 'ssh.open', ...ids }).success).toBe(false)
  })
  it('rejects zero columns', () => {
    const r = ControlRequest.safeParse({ type: 'session.resize', ...ids, cols: 0, rows: 24 })
    expect(r.success).toBe(false)
  })
  it('rejects non-uuid session ids', () => {
    const r = ControlRequest.safeParse({
      type: 'session.close',
      requestId: ids.requestId,
      sessionId: 'x',
    })
    expect(r.success).toBe(false)
  })
})

describe('ControlResponse', () => {
  it('accepts ok and error variants', () => {
    expect(
      ControlResponse.safeParse({
        type: 'response',
        requestId: ids.requestId,
        ok: true,
        data: null,
      }).success,
    ).toBe(true)
    expect(
      ControlResponse.safeParse({
        type: 'response',
        requestId: ids.requestId,
        ok: false,
        error: { code: 'TIMEOUT', message: 'x' },
      }).success,
    ).toBe(true)
  })
  it('rejects unknown error codes', () => {
    const r = ControlResponse.safeParse({
      type: 'response',
      requestId: ids.requestId,
      ok: false,
      error: { code: 'NOPE', message: 'x' },
    })
    expect(r.success).toBe(false)
  })
})
