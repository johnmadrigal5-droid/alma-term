// @vitest-environment node
import type { AlmaApi, ApiResult, ErrorCode, RemoteEntry, TransferEvent } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSftpActions, type OverwriteAnswer } from './sftp-actions'
import { createSftpStore } from './sftp-store'

const S = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const file = (name: string, over: Partial<RemoteEntry> = {}): RemoteEntry => ({
  name,
  kind: 'file',
  size: 1,
  mtimeMs: 0,
  mode: 0o644,
  ...over,
})
const dir = (name: string) => file(name, { kind: 'dir' })
const ok = <T>(data: T) => ({ ok: true as const, data })
const fail = (code: ErrorCode, message: string) => ({
  ok: false as const,
  error: { code, message },
})

function setup(
  listing: Record<string, RemoteEntry[]> = { '/home/a': [dir('d'), file('f')] },
  platform = 'linux',
) {
  const sftp = {
    home: vi.fn(async (): Promise<ApiResult<string>> => ok('/home/a')),
    list: vi.fn(async ({ path }: { path: string }): Promise<ApiResult<RemoteEntry[]>> =>
      listing[path] ? ok(listing[path]) : fail('EACCES', 'Permiso denegado'),
    ),
    stat: vi.fn(async (): Promise<ApiResult<RemoteEntry | null>> => ok(null)),
    mkdir: vi.fn(async (): Promise<ApiResult<null>> => ok(null)),
    rename: vi.fn(async (): Promise<ApiResult<null>> => ok(null)),
    remove: vi.fn(async (): Promise<ApiResult<null>> => ok(null)),
    chmod: vi.fn(async (): Promise<ApiResult<null>> => ok(null)),
  }
  const transfers = {
    start: vi.fn(
      async ({ transferId }: { transferId: string }): Promise<ApiResult<{ transferId: string }>> =>
        ok({ transferId }),
    ),
    localExists: vi.fn(async (): Promise<ApiResult<boolean>> => ok(false)),
  }
  const api = {
    sftp,
    transfers,
    pickUploadFiles: vi.fn(async () => ['/l/x.txt']),
    pickDownloadFolder: vi.fn(async () => '/descargas'),
  } as unknown as Pick<AlmaApi, 'sftp' | 'transfers' | 'pickUploadFiles' | 'pickDownloadFolder'>
  const store = createSftpStore()
  const answers: OverwriteAnswer[] = []
  const askOverwrite = vi.fn(async () => answers.shift() ?? { replace: false, all: false })
  const dismiss = vi.fn()
  const onStarted = vi.fn()
  const onStartFailed = vi.fn()
  let n = 0
  const actions = createSftpActions({
    api,
    store,
    platform,
    askOverwrite,
    dismissTransfer: dismiss,
    onStarted,
    onStartFailed,
    newId: () => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n++).padStart(2, '0')}`,
  })
  const panel = () => store.getState().panels[S]
  return {
    sftp,
    transfers,
    api,
    store,
    actions,
    panel,
    answers,
    askOverwrite,
    dismiss,
    onStarted,
    onStartFailed,
  }
}

describe('sftp actions', () => {
  it('M1: shows a transfer that could not start as a failed entry', async () => {
    const { actions, transfers, onStartFailed } = setup()
    transfers.start.mockResolvedValueOnce(fail('SESSION_NOT_FOUND', 'La sesión no existe'))
    await actions.open(S)
    await actions.upload(S, ['/l/a.txt'])
    expect(onStartFailed).toHaveBeenCalledWith(
      expect.objectContaining({ localPath: '/l/a.txt' }),
      'a.txt',
      { code: 'SESSION_NOT_FOUND', message: 'La sesión no existe' },
    )
  })

  it('M2: ignores a listing that arrives after a newer one', async () => {
    const { actions, sftp, panel } = setup({ '/home/a': [], '/b': [file('de-b')] })
    await actions.open(S)
    let answerA: (v: ApiResult<RemoteEntry[]>) => void = () => undefined
    sftp.list.mockImplementationOnce(() => new Promise((r) => (answerA = r)))
    const first = actions.goto(S, '/a')
    await actions.goto(S, '/b')
    answerA(ok([file('de-a')]))
    await first
    expect(panel()?.path).toBe('/b')
    expect(panel()?.entries.map((e) => e.name)).toEqual(['de-b'])
  })

  it('I6: a failed cd that superseded a refresh does not leave the panel loading', async () => {
    const { actions, sftp, panel } = setup()
    await actions.open(S)
    sftp.list.mockImplementationOnce(() => new Promise(() => undefined))
    void actions.refresh(S)
    expect(panel()?.status).toBe('loading')
    await actions.cd(S, 'nope')
    expect(panel()?.status).toBe('ready')
    expect(panel()?.rowErrors['nope']).toBe('Permiso denegado')
  })

  it('M3: retry after a failed refresh of an empty folder stays in that folder', async () => {
    const { actions, sftp, panel } = setup({ '/home/a': [], '/vacia': [] })
    await actions.open(S)
    await actions.goto(S, '/vacia')
    sftp.list.mockResolvedValueOnce(fail('IO_FAILED', 'x'))
    await actions.refresh(S)
    await actions.retry(S)
    expect(sftp.home).toHaveBeenCalledTimes(1)
    expect(panel()).toMatchObject({ path: '/vacia', status: 'ready' })
  })

  it('M5: refuses to upload over a remote folder of the same name', async () => {
    const { actions, sftp, transfers, panel, askOverwrite } = setup()
    await actions.open(S)
    sftp.stat.mockResolvedValue(ok(dir('a.txt')))
    await actions.upload(S, ['/l/a.txt'])
    expect(askOverwrite).not.toHaveBeenCalled()
    expect(transfers.start).not.toHaveBeenCalled()
    expect(panel()?.rowErrors['a.txt']).toBe('Ya hay una carpeta con ese nombre')
  })

  it('I6: asks before downloading over an existing local file', async () => {
    const { actions, transfers, askOverwrite, answers } = setup()
    await actions.open(S)
    transfers.localExists.mockResolvedValue(ok(true))
    answers.push({ replace: true, all: false })
    await actions.download(S, [file('f')])
    expect(transfers.localExists).toHaveBeenCalledWith({ path: '/descargas/f' })
    expect(askOverwrite).toHaveBeenCalledWith('f', false)
    expect(transfers.start).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }))
  })

  it('I6: skips a download the user does not want to replace', async () => {
    const { actions, transfers } = setup()
    await actions.open(S)
    transfers.localExists.mockResolvedValue(ok(true))
    await actions.download(S, [file('f')])
    expect(transfers.start).not.toHaveBeenCalled()
  })

  it('opens the home folder and lists it', async () => {
    const { actions, panel } = setup()
    const opening = actions.open(S)
    expect(panel()?.status).toBe('loading')
    await opening
    expect(panel()).toMatchObject({ path: '/home/a', status: 'ready' })
    expect(panel()?.entries.map((e) => e.name)).toEqual(['d', 'f'])
  })

  it('shows a listing error in the header with the message', async () => {
    const { actions, panel, sftp } = setup()
    sftp.home.mockResolvedValueOnce(fail('SFTP_UNAVAILABLE', 'El servidor no ofrece SFTP'))
    await actions.open(S)
    expect(panel()).toMatchObject({ status: 'error', error: 'El servidor no ofrece SFTP' })
  })

  it('enters a folder and goes back up', async () => {
    const { actions, panel } = setup({
      '/home/a': [dir('d')],
      '/home/a/d': [file('x')],
      '/home': [],
    })
    await actions.open(S)
    await actions.cd(S, 'd')
    expect(panel()).toMatchObject({ path: '/home/a/d', status: 'ready' })
    await actions.up(S)
    expect(panel()?.path).toBe('/home/a')
  })

  it('keeps the folder and marks the row when entering it is denied', async () => {
    const { actions, panel } = setup({ '/home/a': [dir('privada')] })
    await actions.open(S)
    await actions.cd(S, 'privada')
    expect(panel()?.path).toBe('/home/a')
    expect(panel()?.rowErrors).toEqual({ privada: 'Permiso denegado' })
  })

  it('shows a delete failure on that row', async () => {
    const { actions, panel, sftp } = setup()
    await actions.open(S)
    sftp.remove.mockResolvedValueOnce(fail('EACCES', 'Permiso denegado'))
    await actions.remove(S, file('f'))
    expect(panel()?.rowErrors['f']).toBe('Permiso denegado')
  })

  it('creates a folder in the current one and refreshes', async () => {
    const { actions, sftp } = setup()
    await actions.open(S)
    expect(await actions.mkdir(S, 'nueva')).toBeNull()
    expect(sftp.mkdir).toHaveBeenCalledWith({ sessionId: S, path: '/home/a/nueva' })
    expect(sftp.list).toHaveBeenCalledTimes(2)
  })

  it('uploads into the current folder and asks before replacing', async () => {
    const { actions, sftp, transfers, answers } = setup()
    await actions.open(S)
    sftp.stat.mockResolvedValueOnce(ok(file('a.txt')))
    answers.push({ replace: true, all: false })
    await actions.upload(S, ['/l/a.txt', 'C:\\docs\\b.txt'])
    expect(transfers.start).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: '/home/a/a.txt',
        overwrite: true,
        direction: 'upload',
      }),
    )
    expect(transfers.start).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: '/home/a/b.txt', overwrite: false }),
    )
  })

  it('skips the rest when the user chose skip for all', async () => {
    const { actions, sftp, transfers, answers, askOverwrite } = setup()
    await actions.open(S)
    sftp.stat.mockResolvedValue(ok(file('x')))
    answers.push({ replace: false, all: true })
    await actions.upload(S, ['/l/a', '/l/b', '/l/c'])
    expect(askOverwrite).toHaveBeenCalledOnce()
    expect(transfers.start).not.toHaveBeenCalled()
  })

  it('downloads files to the chosen folder and retries with overwrite after EEXIST', async () => {
    const { actions, transfers, answers, dismiss } = setup()
    await actions.open(S)
    await actions.download(S, [file('f'), dir('d')])
    expect(transfers.start).toHaveBeenCalledOnce()
    const first = transfers.start.mock.calls[0]?.[0] as { transferId: string; localPath: string }
    expect(first).toMatchObject({
      direction: 'download',
      localPath: '/descargas/f',
      remotePath: '/home/a/f',
      overwrite: false,
    })
    answers.push({ replace: true, all: false })
    const event: TransferEvent = {
      type: 'event.transfer',
      transferId: first.transferId,
      sessionId: S,
      direction: 'download',
      name: 'f',
      state: 'error',
      bytes: 0,
      total: 1,
      error: { code: 'EEXIST', message: 'Ya existe' },
    }
    await actions.onTransfer(event)
    expect(dismiss).toHaveBeenCalledWith(first.transferId)
    expect(transfers.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ localPath: '/descargas/f', overwrite: true }),
    )
  })

  it('refuses to download a name that is not a valid local file name on Windows', async () => {
    const { actions, transfers, panel } = setup({ '/home/a': [file('a\\..\\x')] }, 'win32')
    await actions.open(S)
    await actions.download(S, [file('a\\..\\x'), file('con:x')])
    expect(transfers.start).not.toHaveBeenCalled()
    expect(panel()?.rowErrors['a\\..\\x']).toMatch(/no es válido/)
  })

  it('reports each started transfer so Reintentar can repeat it', async () => {
    const { actions, transfers, onStarted } = setup()
    await actions.open(S)
    await actions.upload(S, ['/l/a.txt'])
    expect(onStarted).toHaveBeenCalledWith(transfers.start.mock.calls[0]?.[0])
  })

  it('refreshes the folder when an upload into it finishes', async () => {
    const { actions, sftp, transfers } = setup()
    await actions.open(S)
    await actions.upload(S, ['/l/a.txt'])
    const { transferId } = transfers.start.mock.calls[0]?.[0] as { transferId: string }
    sftp.list.mockClear()
    await actions.onTransfer({
      type: 'event.transfer',
      transferId,
      sessionId: S,
      direction: 'upload',
      name: 'a.txt',
      state: 'done',
      bytes: 1,
      total: 1,
    })
    expect(sftp.list).toHaveBeenCalledWith({ sessionId: S, path: '/home/a' })
  })
})
