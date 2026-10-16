import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  LocalExistsArgs,
  RemoteEntry,
  SftpChmodArgs,
  SftpPathArgs,
  SftpRemoveArgs,
  SftpRenameArgs,
  SftpSessionArgs,
  TIMEOUTS,
  TransferIdArgs,
  TransferStartArgs,
  type ApiResult,
  type ControlRequest,
} from '@alma/protocol'
import { z } from 'zod'
import type { RequestOptions } from './host-supervisor'
import { toFailure } from './saved-handlers'

export interface SftpHandlerDeps {
  request(message: ControlRequest, transfer?: never[], options?: RequestOptions): Promise<unknown>
  localExists(path: string): Promise<boolean>
}

const list = { timeoutMs: TIMEOUTS.sftpListMs }
const op = { timeoutMs: TIMEOUTS.sftpOpMs }
const Done = z.null()

type Route = (raw: unknown) => Promise<ApiResult<unknown>>

const invalid = (message: string): ApiResult<never> => ({
  ok: false,
  error: { code: 'INVALID_MESSAGE', message },
})

/** Arguments that passed the schema but still make no sense. */
class SftpRouteError extends Error {}

/**
 * Renderer → host routes for the file browser and the transfer queue. Main only validates,
 * stamps request ids and deadlines; the host does all file I/O. Pure so tests skip Electron.
 */
export function createSftpHandlers({ request, localExists }: SftpHandlerDeps) {
  const ask = async <T>(
    message: ControlRequest,
    options: RequestOptions,
    reply: z.ZodType<T>,
  ): Promise<T> => reply.parse(await request(message, [], options))
  const rid = () => randomUUID()

  const route =
    <A>(schema: z.ZodType<A>, run: (args: A) => Promise<unknown>): Route =>
    async (raw) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return invalid('Argumentos inválidos')
      try {
        return { ok: true, data: await run(parsed.data) }
      } catch (error) {
        if (error instanceof SftpRouteError) return invalid(error.message)
        return toFailure(error)
      }
    }

  const routes: Record<string, Route> = {
    'sftp:home': route(SftpSessionArgs, (a) =>
      ask({ type: 'sftp.home', requestId: rid(), ...a }, list, z.string()),
    ),
    'sftp:list': route(SftpPathArgs, (a) =>
      ask({ type: 'sftp.list', requestId: rid(), ...a }, list, z.array(RemoteEntry)),
    ),
    'sftp:stat': route(SftpPathArgs, (a) =>
      ask({ type: 'sftp.stat', requestId: rid(), ...a }, list, RemoteEntry.nullable()),
    ),
    'sftp:mkdir': route(SftpPathArgs, (a) =>
      ask({ type: 'sftp.mkdir', requestId: rid(), ...a }, op, Done),
    ),
    'sftp:rename': route(SftpRenameArgs, (a) =>
      ask({ type: 'sftp.rename', requestId: rid(), ...a }, op, Done),
    ),
    'sftp:remove': route(SftpRemoveArgs, (a) =>
      ask({ type: 'sftp.rm', requestId: rid(), ...a }, op, Done),
    ),
    'sftp:chmod': route(SftpChmodArgs, (a) =>
      ask({ type: 'sftp.chmod', requestId: rid(), ...a }, op, Done),
    ),
    'transfers:start': route(TransferStartArgs, async (a) => {
      const transferId = a.transferId ?? randomUUID()
      await request({ type: 'transfer.start', requestId: rid(), ...a, transferId }, [], op)
      return { transferId }
    }),
    'transfers:pause': route(TransferIdArgs, (a) =>
      ask({ type: 'transfer.pause', requestId: rid(), ...a }, op, Done),
    ),
    'transfers:resume': route(TransferIdArgs, (a) =>
      ask({ type: 'transfer.resume', requestId: rid(), ...a }, op, Done),
    ),
    'transfers:cancel': route(TransferIdArgs, (a) =>
      ask({ type: 'transfer.cancel', requestId: rid(), ...a }, op, Done),
    ),
    'transfers:localExists': route(LocalExistsArgs, async (a) => {
      // A stat on \\host\share would open an SMB connection to wherever the path points.
      if (a.path.startsWith('\\\\')) throw new SftpRouteError('No se admiten rutas de red')
      if (!isAbsolute(a.path)) throw new SftpRouteError('La ruta local debe ser absoluta')
      return localExists(a.path)
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
