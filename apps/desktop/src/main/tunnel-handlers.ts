import { randomUUID } from 'node:crypto'
import {
  TIMEOUTS,
  TunnelCloseArgs,
  TunnelOpenArgs,
  type ApiResult,
  type ControlRequest,
} from '@alma/protocol'
import type { z } from 'zod'
import type { RequestOptions } from './host-supervisor'
import { toFailure } from './saved-handlers'

export interface TunnelHandlerDeps {
  request(message: ControlRequest, transfer?: never[], options?: RequestOptions): Promise<unknown>
}

const options = { timeoutMs: TIMEOUTS.controlMs }

type Route = (raw: unknown) => Promise<ApiResult<unknown>>

const invalid = (message: string): ApiResult<never> => ({
  ok: false,
  error: { code: 'INVALID_MESSAGE', message },
})

/**
 * Renderer → host routes for tunnels. Main validates (an external bind must be explicitly
 * enabled), stamps the ids and the deadline; the host owns the sockets.
 */
export function createTunnelHandlers({ request }: TunnelHandlerDeps) {
  const route =
    <A>(schema: z.ZodType<A>, run: (args: A) => Promise<unknown>): Route =>
    async (raw) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return invalid('Argumentos inválidos')
      try {
        return { ok: true, data: await run(parsed.data) }
      } catch (error) {
        return toFailure(error)
      }
    }

  const routes: Record<string, Route> = {
    'tunnels:open': route(TunnelOpenArgs, async (a) => {
      const tunnelId = a.tunnelId ?? randomUUID()
      await request(
        {
          type: 'tunnel.open',
          requestId: randomUUID(),
          tunnelId,
          sessionId: a.sessionId,
          spec: a.spec,
        },
        [],
        options,
      )
      return { tunnelId }
    }),
    'tunnels:close': route(TunnelCloseArgs, async (a) => {
      await request(
        { type: 'tunnel.close', requestId: randomUUID(), tunnelId: a.tunnelId },
        [],
        options,
      )
      return null
    }),
  }

  return {
    channels: Object.keys(routes),
    dispatch(channel: string, raw: unknown): Promise<ApiResult<unknown>> {
      const target = routes[channel]
      return target ? target(raw) : Promise.resolve(invalid('Canal desconocido'))
    },
  }
}
