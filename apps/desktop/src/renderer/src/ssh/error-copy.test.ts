import { describe, expect, it } from 'vitest'
import { errorCopy } from './error-copy'

describe('errorCopy', () => {
  it('maps auth failures to retry and edit', () => {
    expect(errorCopy('AUTH_FAILED')).toMatchObject({
      title: 'No se pudo autenticar',
      actions: ['retry', 'edit'],
    })
  })

  it.each(['ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'] as const)(
    'maps %s to an unreachable host with retry and edit',
    (code) => {
      expect(errorCopy(code).actions).toEqual(['retry', 'edit'])
      expect(errorCopy(code).title).toMatch(/No se pudo/)
    },
  )

  it('falls back to a generic message for unknown codes', () => {
    expect(errorCopy('HOST_UNAVAILABLE').title).toBe('No se pudo conectar')
  })
})
