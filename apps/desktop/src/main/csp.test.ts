import { describe, expect, it } from 'vitest'
import { buildCsp } from './csp'

describe('buildCsp', () => {
  it('builds the strict production policy from the spec', () => {
    expect(buildCsp(false)).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
  })
  it('allows the vite HMR websocket and inline preamble only in dev', () => {
    const dev = buildCsp(true)
    expect(dev).toContain("connect-src 'self' ws://localhost:*")
    expect(dev).toContain("script-src 'self' 'unsafe-inline'")
    expect(buildCsp(false)).not.toContain('ws://')
  })
})
