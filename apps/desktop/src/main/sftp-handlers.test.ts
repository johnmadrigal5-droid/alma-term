import type { ControlRequest } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { RequestOptions } from './host-supervisor'
import { HostRequestError } from './host-supervisor'
import { createSftpHandlers } from './sftp-handlers'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const UUID = /^[0-9a-f-]{36}$/

function setup(reply: unknown = null) {
  const calls: { message: ControlRequest; options: RequestOptions | undefined }[] = []
  const request = vi.fn(async (message: ControlRequest, _t?: never[], options?: RequestOptions) => {
    calls.push({ message, options })
    return reply
  })
  return {
    calls,
    request,
    handlers: createSftpHandlers({ request, localExists: async (p) => p === '/d/a' }),
  }
}

describe('sftp handlers', () => {
  it('M6: refuses network (UNC) paths so a stat never opens an SMB connection', async () => {
    const { handlers } = setup()
    expect(
      await handlers.dispatch('transfers:localExists', { path: '\\\\host\\share\\a' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE', message: 'No se admiten rutas de red' },
    })
  })

  it('answers whether a local path exists without asking the host', async () => {
    const { request, handlers } = setup()
    expect(await handlers.dispatch('transfers:localExists', { path: '/d/a' })).toEqual({
      ok: true,
      data: true,
    })
    expect(await handlers.dispatch('transfers:localExists', { path: '/d/b' })).toEqual({
      ok: true,
      data: false,
    })
    expect(await handlers.dispatch('transfers:localExists', { path: 'relativa' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE' },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('lists with the 60 s deadline and validates the entries', async () => {
    const entry = { name: 'a', kind: 'file', size: 1, mtimeMs: 0, mode: 0o644 }
    const { calls, handlers } = setup([entry])
    expect(await handlers.dispatch('sftp:list', { sessionId: SID, path: '/' })).toEqual({
      ok: true,
      data: [entry],
    })
    expect(calls[0]?.message).toMatchObject({ type: 'sftp.list', sessionId: SID, path: '/' })
    expect(calls[0]?.options).toEqual({ timeoutMs: 60_000 })
  })

  it('creates a folder with the 30 s deadline', async () => {
    const { calls, handlers } = setup()
    await handlers.dispatch('sftp:mkdir', { sessionId: SID, path: '/a' })
    expect(calls[0]?.options).toEqual({ timeoutMs: 30_000 })
  })

  it('generates a transfer id when the renderer sends none and returns it', async () => {
    const { calls, handlers } = setup({ transferId: 'ignored' })
    const result = await handlers.dispatch('transfers:start', {
      sessionId: SID,
      direction: 'upload',
      localPath: '/l/a',
      remotePath: '/r/a',
      overwrite: false,
    })
    const sent = calls[0]?.message
    expect(sent?.type).toBe('transfer.start')
    const transferId = sent?.type === 'transfer.start' ? sent.transferId : ''
    expect(transferId).toMatch(UUID)
    expect(result).toEqual({ ok: true, data: { transferId } })
  })

  it('keeps the transfer id chosen by the renderer', async () => {
    const { handlers } = setup()
    expect(
      await handlers.dispatch('transfers:start', {
        transferId: TID,
        sessionId: SID,
        direction: 'download',
        localPath: '/l/a',
        remotePath: '/r/a',
        overwrite: true,
      }),
    ).toEqual({ ok: true, data: { transferId: TID } })
  })

  it('refuses an invalid path before reaching the host', async () => {
    const { request, handlers } = setup()
    expect(await handlers.dispatch('sftp:stat', { sessionId: SID, path: 'a\0b' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE' },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('passes the host error through', async () => {
    const request = vi.fn(async () => {
      throw new HostRequestError('EACCES', 'Permiso denegado')
    })
    const handlers = createSftpHandlers({ request, localExists: async () => false })
    expect(await handlers.dispatch('sftp:list', { sessionId: SID, path: '/root' })).toEqual({
      ok: false,
      error: { code: 'EACCES', message: 'Permiso denegado' },
    })
  })
})
