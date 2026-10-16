// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { AutoFiles } from './auto-files'
import type { RemoteFiles } from './remote-files'
import { SftpFailure } from './sftp-errors'

const unavailable = () =>
  new SftpFailure({ code: 'SFTP_UNAVAILABLE', message: 'El servidor no ofrece SFTP' })

function fakeFiles(name: string, stream = async () => ({}) as never): RemoteFiles {
  return {
    home: vi.fn(async () => `/home/${name}`),
    list: vi.fn(async () => []),
    stat: vi.fn(async () => null),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    stream: vi.fn(stream),
    dispose: vi.fn(),
  }
}

describe('AutoFiles', () => {
  it('uses SFTP when the server has it and says so once', async () => {
    const sftp = fakeFiles('sftp')
    const scp = fakeFiles('scp')
    const onMode = vi.fn()
    const files = new AutoFiles(sftp, scp, onMode)
    expect(await files.home()).toBe('/home/sftp')
    await files.list('/')
    expect(onMode).toHaveBeenCalledExactlyOnceWith('sftp')
    expect(scp.home).not.toHaveBeenCalled()
  })

  it('falls back to scp when the server has no SFTP, and stays there', async () => {
    const sftp = fakeFiles('sftp', async () => {
      throw unavailable()
    })
    const scp = fakeFiles('scp')
    const onMode = vi.fn()
    const files = new AutoFiles(sftp, scp, onMode)
    expect(await files.home()).toBe('/home/scp')
    await files.mkdir('/x')
    expect(onMode).toHaveBeenCalledExactlyOnceWith('scp')
    expect(sftp.stream).toHaveBeenCalledOnce()
    expect(scp.mkdir).toHaveBeenCalledWith('/x')
  })

  it('gives transfers the scp backend in that mode', async () => {
    const backend = { marker: 'scp' } as never
    const files = new AutoFiles(
      fakeFiles('sftp', async () => {
        throw unavailable()
      }),
      fakeFiles('scp', async () => backend),
      vi.fn(),
    )
    expect(await files.stream()).toBe(backend)
  })

  it('does not remember a failure that is not "no SFTP": the next call tries again', async () => {
    let calls = 0
    const sftp = fakeFiles('sftp', async () => {
      calls += 1
      if (calls === 1) throw new SftpFailure({ code: 'IO_FAILED', message: 'se cortó' })
      return {} as never
    })
    const onMode = vi.fn()
    const files = new AutoFiles(sftp, fakeFiles('scp'), onMode)
    await expect(files.home()).rejects.toMatchObject({ code: 'IO_FAILED' })
    expect(onMode).not.toHaveBeenCalled()
    expect(await files.home()).toBe('/home/sftp')
    expect(onMode).toHaveBeenCalledExactlyOnceWith('sftp')
  })

  it('reports the missing SFTP when there is no scp to fall back to', async () => {
    const sftp = fakeFiles('sftp', async () => {
      throw unavailable()
    })
    const files = new AutoFiles(sftp, null, vi.fn())
    await expect(files.home()).rejects.toMatchObject({ code: 'SFTP_UNAVAILABLE' })
  })

  it('disposes both sides', () => {
    const sftp = fakeFiles('sftp')
    const scp = fakeFiles('scp')
    new AutoFiles(sftp, scp, vi.fn()).dispose()
    expect(sftp.dispose).toHaveBeenCalled()
    expect(scp.dispose).toHaveBeenCalled()
  })
})
