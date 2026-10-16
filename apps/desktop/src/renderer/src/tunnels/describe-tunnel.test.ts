// @vitest-environment node
import { TunnelSpec } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { describeTunnel, tunnelErrorCopy, TYPE_LABEL } from './describe-tunnel'

describe('describeTunnel', () => {
  it('shows the bound port and the target of a local or remote forward', () => {
    const spec = TunnelSpec.parse({ type: 'L', bindPort: 0, targetHost: 'db', targetPort: 5432 })
    expect(describeTunnel(spec, 40_123)).toBe('127.0.0.1:40123 → db:5432')
    const remote = TunnelSpec.parse({
      type: 'R',
      bindPort: 9000,
      targetHost: 'localhost',
      targetPort: 3000,
    })
    expect(describeTunnel(remote, 9000)).toBe('127.0.0.1:9000 → localhost:3000')
  })

  it('shows a dynamic tunnel as a SOCKS5 proxy', () => {
    expect(describeTunnel(TunnelSpec.parse({ type: 'D', bindPort: 1080 }), 1080)).toBe(
      '127.0.0.1:1080 · SOCKS5',
    )
  })

  it('falls back to the asked port while the tunnel is still opening', () => {
    const spec = TunnelSpec.parse({ type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 1 })
    expect(describeTunnel(spec, 0)).toBe('127.0.0.1:8080 → db:1')
  })

  it('names the three types', () => {
    expect(TYPE_LABEL).toEqual({ L: 'Local', R: 'Remoto', D: 'Dinámico' })
  })
})

describe('tunnelErrorCopy', () => {
  it('says a port in use and offers to pick another', () => {
    expect(tunnelErrorCopy({ code: 'TUNNEL_BIND_IN_USE', message: 'x' })).toEqual({
      title: 'Puerto local en uso',
      action: 'Elegir otro puerto',
    })
  })

  it('keeps the host message for other failures', () => {
    expect(
      tunnelErrorCopy({
        code: 'TUNNEL_FAILED',
        message: 'El servidor no permite reenviar puertos',
      }),
    ).toEqual({
      title: 'El servidor no permite reenviar puertos',
    })
    expect(tunnelErrorCopy({ code: 'SESSION_NOT_FOUND', message: 'x' }).title).toBe(
      'La sesión ya no está abierta',
    )
  })
})
