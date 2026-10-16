import { describe, expect, it } from 'vitest'
import { mapSshError } from './ssh-errors'

const err = (message: string, code?: string) => Object.assign(new Error(message), { code })

describe('mapSshError', () => {
  it.each([
    [err('connect ECONNREFUSED 127.0.0.1:22', 'ECONNREFUSED'), 'ECONNREFUSED'],
    [err('getaddrinfo ENOTFOUND nope', 'ENOTFOUND'), 'EHOSTUNREACH'],
    [err('connect EHOSTUNREACH', 'EHOSTUNREACH'), 'EHOSTUNREACH'],
    [err('connect ENETUNREACH', 'ENETUNREACH'), 'EHOSTUNREACH'],
    [err('connect ETIMEDOUT', 'ETIMEDOUT'), 'ETIMEDOUT'],
    [err('Timed out while waiting for handshake'), 'ETIMEDOUT'],
    [err('All configured authentication methods failed'), 'AUTH_FAILED'],
  ])('maps %s to %s', (error, code) => {
    expect(mapSshError(error).code).toBe(code)
  })
  it('keeps unknown messages under HOST_UNAVAILABLE', () => {
    expect(mapSshError(err('boom'))).toEqual({ code: 'HOST_UNAVAILABLE', message: 'boom' })
  })
  it('handles non-Error values', () => {
    expect(mapSshError('weird').code).toBe('HOST_UNAVAILABLE')
  })
})
