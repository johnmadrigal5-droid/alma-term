import { describe, expect, it, vi } from 'vitest'
import { FakeSftp } from '../test/fake-sftp'
import { SftpService } from './sftp-service'

function setup() {
  const fake = new FakeSftp()
  const open = vi.fn(async () => fake)
  return { fake, open, service: new SftpService(open) }
}

describe('SftpService', () => {
  it('resolves the home directory with realpath(".")', async () => {
    const { service } = setup()
    expect(await service.home()).toBe('/home/alma')
  })

  it('lists folders first, then files in natural order', async () => {
    const { fake, service } = setup()
    fake.file('/home/alma/file10', 'x')
    fake.file('/home/alma/file2', 'xy')
    fake.mkdirp('/home/alma/zeta')
    const entries = await service.list('/home/alma')
    expect(entries.map((e) => e.name)).toEqual(['zeta', 'file2', 'file10'])
    expect(entries[1]).toMatchObject({ kind: 'file', size: 2, mode: 0o644 })
  })

  it('drops names a server must never send: with a slash, NUL, or dot components', async () => {
    const { fake, service } = setup()
    fake.file('/home/alma/ok', 'x')
    const readdir = fake.readdir.bind(fake)
    fake.readdir = (path, cb) =>
      readdir(path, (error, list) =>
        cb(error, [
          ...(list ?? []),
          ...['../../etc/x', 'a\0b', '.', '..'].map((filename) => ({
            filename: filename.replace('\\0', '\0'),
            attrs: { mode: 0o100644, size: 1, mtime: 0 },
          })),
        ]),
      )
    expect((await service.list('/home/alma')).map((e) => e.name)).toEqual(['ok'])
  })

  it('keeps one entry per name when the server repeats a name', async () => {
    const { fake, service } = setup()
    fake.file('/d/a', 'x')
    fake.duplicateNames = true
    expect((await service.list('/d')).map((e) => e.name)).toEqual(['a'])
  })

  it('I3: lists a huge folder without quadratic work', async () => {
    const { fake, service } = setup()
    for (let i = 0; i < 40_000; i++) fake.file(`/big/f${i}`, '')
    const started = performance.now()
    expect(await service.list('/big')).toHaveLength(40_000)
    // The host serves every terminal: a listing must not block it for seconds.
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('marks symbolic links', async () => {
    const { fake, service } = setup()
    fake.file('/etc/hosts', 'x')
    fake.link('/home/alma/hosts', '/etc/hosts')
    expect((await service.list('/home/alma'))[0]).toMatchObject({ name: 'hosts', kind: 'link' })
  })

  it('returns null from stat for a missing path', async () => {
    const { fake, service } = setup()
    fake.file('/home/alma/a', 'abc', 1_700_000_000)
    expect(await service.stat('/home/alma/nada')).toBeNull()
    expect(await service.stat('/home/alma/a')).toMatchObject({
      name: 'a',
      kind: 'file',
      size: 3,
      mtimeMs: 1_700_000_000_000,
    })
  })

  it('creates, renames, changes mode and removes', async () => {
    const { fake, service } = setup()
    await service.mkdir('/home/alma/d')
    fake.file('/home/alma/d/f', 'x')
    await service.rename('/home/alma/d/f', '/home/alma/d/g')
    await service.chmod('/home/alma/d/g', 0o600)
    expect((await service.stat('/home/alma/d/g'))?.mode).toBe(0o600)
    await service.remove('/home/alma/d/g', 'file')
    await service.remove('/home/alma/d', 'dir')
    expect(await service.stat('/home/alma/d')).toBeNull()
  })

  it('refuses to remove a folder that is not empty', async () => {
    const { fake, service } = setup()
    fake.file('/home/alma/d/f', 'x')
    await expect(service.remove('/home/alma/d', 'dir')).rejects.toMatchObject({
      code: 'ENOTEMPTY',
    })
  })

  it('maps a denied listing to EACCES', async () => {
    const { fake, service } = setup()
    fake.mkdirp('/root')
    fake.denied.add('/root')
    await expect(service.list('/root')).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('opens the channel once and reopens it after the server closed it', async () => {
    const { fake, open, service } = setup()
    await service.list('/home/alma')
    await service.list('/home/alma')
    expect(open).toHaveBeenCalledTimes(1)
    fake.close()
    await service.list('/home/alma')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('survives a fatal channel error and reopens on the next call', async () => {
    const { fake, open, service } = setup()
    await service.list('/home/alma')
    expect(() => fake.emit('error', new Error('Bad packet'))).not.toThrow()
    await service.list('/home/alma')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('reports SFTP_UNAVAILABLE when the subsystem cannot open, and retries next time', async () => {
    const fake = new FakeSftp()
    const open = vi
      .fn<() => Promise<FakeSftp>>()
      .mockRejectedValueOnce(new Error('Unable to start subsystem: sftp'))
      .mockResolvedValue(fake)
    const service = new SftpService(open)
    await expect(service.home()).rejects.toMatchObject({ code: 'SFTP_UNAVAILABLE' })
    expect(await service.home()).toBe('/home/alma')
  })

  it('ends the channel on dispose', async () => {
    const { fake, service } = setup()
    await service.home()
    await service.dispose()
    expect(fake.ended).toBe(true)
    await expect(service.list('/')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })

  it('I2: a channel that fails to open for another reason is not "no SFTP": retryable IO_FAILED', async () => {
    const fake = new FakeSftp()
    const open = vi
      .fn<() => Promise<FakeSftp>>()
      .mockRejectedValueOnce(new Error('(SSH) Channel open failure: administratively prohibited'))
      .mockResolvedValue(fake)
    const service = new SftpService(open)
    await expect(service.home()).rejects.toMatchObject({ code: 'IO_FAILED' })
    expect(await service.home()).toBe('/home/alma')
    expect(open).toHaveBeenCalledTimes(2)
  })
})
