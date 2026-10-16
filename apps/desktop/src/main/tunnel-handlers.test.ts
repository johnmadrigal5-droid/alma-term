import type { ControlRequest } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { RequestOptions } from './host-supervisor'
import { HostRequestError } from './host-supervisor'
import { createTunnelHandlers } from './tunnel-handlers'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const UUID = /^[0-9a-f-]{36}$/
const spec = { type: 'L', bindPort: 8080, targetHost: 'db', targetPort: 5432 }

function setup(reply: unknown = { boundPort: 8080 }) {
  const calls: { message: ControlRequest; options: RequestOptions | undefined }[] = []
  const request = vi.fn(async (message: ControlRequest, _t?: never[], options?: RequestOptions) => {
    calls.push({ message, options })
    return reply
  })
  return { calls, request, handlers: createTunnelHandlers({ request }) }
}

describe('tunnel handlers', () => {
  it('opens a tunnel with a generated id, the defaults filled in and the 30 s deadline', async () => {
    const { calls, handlers } = setup()
    const result = await handlers.dispatch('tunnels:open', { sessionId: SID, spec })
    expect(result).toMatchObject({ ok: true, data: { tunnelId: expect.stringMatching(UUID) } })
    expect(calls[0]?.message).toMatchObject({
      type: 'tunnel.open',
      sessionId: SID,
      spec: { type: 'L', bindHost: '127.0.0.1', exposeExternally: false },
    })
    expect(calls[0]?.options).toEqual({ timeoutMs: 30_000 })
  })

  it('keeps the id the renderer chose', async () => {
    const { calls, handlers } = setup()
    const result = await handlers.dispatch('tunnels:open', { sessionId: SID, spec, tunnelId: TID })
    expect(result).toEqual({ ok: true, data: { tunnelId: TID } })
    expect(calls[0]?.message).toMatchObject({ tunnelId: TID })
  })

  it('refuses an external bind without explicit exposure before asking the host', async () => {
    const { request, handlers } = setup()
    const result = await handlers.dispatch('tunnels:open', {
      sessionId: SID,
      spec: { ...spec, bindHost: '0.0.0.0' },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('closes a tunnel by id', async () => {
    const { calls, handlers } = setup(null)
    expect(await handlers.dispatch('tunnels:close', { tunnelId: TID })).toEqual({
      ok: true,
      data: null,
    })
    expect(calls[0]?.message).toMatchObject({ type: 'tunnel.close', tunnelId: TID })
  })

  it('passes the host error through', async () => {
    const request = vi.fn(async () => {
      throw new HostRequestError('TUNNEL_BIND_IN_USE', 'El puerto 8080 ya está en uso')
    })
    const handlers = createTunnelHandlers({ request })
    expect(await handlers.dispatch('tunnels:open', { sessionId: SID, spec })).toEqual({
      ok: false,
      error: { code: 'TUNNEL_BIND_IN_USE', message: 'El puerto 8080 ya está en uso' },
    })
  })

  it('rejects malformed arguments and unknown channels', async () => {
    const { handlers } = setup()
    expect(await handlers.dispatch('tunnels:open', { nope: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE' },
    })
    expect(await handlers.dispatch('tunnels:zap', {})).toMatchObject({ ok: false })
    expect(handlers.channels).toEqual(['tunnels:open', 'tunnels:close'])
  })
})
