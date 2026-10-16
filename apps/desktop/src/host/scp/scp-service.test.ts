// @vitest-environment node
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { describe, expect, it } from 'vitest'
import { FakeScpHost } from '../test/fake-scp-host'
import { ScpService } from './scp-service'
import { shellQuote } from './shell-quote'

function setup() {
  const host = new FakeScpHost()
  return { host, service: new ScpService(host.exec) }
}

const upload = async (
  service: ScpService,
  path: string,
  content: Buffer,
  size = content.length,
) => {
  const backend = await service.stream()
  const stream = backend.createWriteStream(path, { highWaterMark: 16 * 1024, flags: 'w', size })
  await pipeline(Readable.from([content]), stream)
}

const download = async (service: ScpService, path: string): Promise<Buffer> => {
  const backend = await service.stream()
  const chunks: Buffer[] = []
  await pipeline(
    backend.createReadStream(path, { highWaterMark: 16 * 1024 }),
    new Writable({
      write(chunk: Buffer, _e, cb) {
        chunks.push(chunk)
        cb()
      },
    }),
  )
  return Buffer.concat(chunks)
}

describe('ScpService commands', () => {
  it('asks the shell for the home folder', async () => {
    const { service } = setup()
    expect(await service.home()).toBe('/home/alma')
  })

  it('lists a folder: folders first in natural order, odd names dropped, no sizes', async () => {
    const { host, service } = setup()
    host.dirs.add('/home/alma/b')
    host.dirs.add('/home/alma/a')
    host.files.set('/home/alma/f10', Buffer.from('x'))
    host.files.set('/home/alma/f2', Buffer.from('x'))
    const list = await service.list('/home/alma')
    expect(list.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:a',
      'dir:b',
      'file:f2',
      'file:f10',
    ])
    expect(list.every((e) => e.size === 0 && e.mtimeMs === 0)).toBe(true)
    expect(host.commands.at(-1)).toBe("ls -1ApL -- '/home/alma'")
  })

  it('quotes every path, whatever it contains', async () => {
    const { host, service } = setup()
    const path = "/home/alma/a b'$(touch x);"
    host.dirs.add(path)
    await service.list(path)
    expect(host.commands.at(-1)).toBe(`ls -1ApL -- ${shellQuote(path)}`)
    await service.mkdir(`${path}/n`)
    expect(host.commands.at(-1)).toBe(`mkdir -- ${shellQuote(`${path}/n`)}`)
  })

  it('stats a file, a folder and a missing path', async () => {
    const { host, service } = setup()
    host.files.set('/home/alma/f', Buffer.from('hola'))
    expect(await service.stat('/home/alma/f')).toMatchObject({ kind: 'file', size: 4, name: 'f' })
    expect(await service.stat('/home/alma')).toMatchObject({ kind: 'dir' })
    expect(await service.stat('/home/alma/nada')).toBeNull()
  })

  it('creates, renames, removes and changes permissions with plain commands', async () => {
    const { host, service } = setup()
    host.files.set('/home/alma/a', Buffer.from('x'))
    await service.mkdir('/home/alma/d')
    await service.rename('/home/alma/a', '/home/alma/b')
    expect(host.files.has('/home/alma/b')).toBe(true)
    expect(host.commands.at(-1)).toBe("mv -n -- '/home/alma/a' '/home/alma/b'")
    await service.chmod('/home/alma/b', 0o600)
    expect(host.commands.at(-1)).toBe("chmod 600 -- '/home/alma/b'")
    await service.remove('/home/alma/b', 'file')
    expect(host.commands.at(-1)).toBe("rm -- '/home/alma/b'")
    await service.remove('/home/alma/d', 'dir')
    expect(host.commands.at(-1)).toBe("rmdir -- '/home/alma/d'")
  })

  it('refuses paths that climb out, empty paths and NUL before running anything', async () => {
    const { host, service } = setup()
    for (const path of ['', '/home/alma/../etc', '..', 'a\0b'])
      await expect(service.list(path)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(host.commands).toEqual([])
  })

  it('refuses a permission mode that is not a plain number', async () => {
    const { host, service } = setup()
    await expect(service.chmod('/x', -1)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    await expect(service.chmod('/x', 0o10000)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(host.commands).toEqual([])
  })

  it('maps what a failing command says to a typed error', async () => {
    const { host, service } = setup()
    host.failNext = "mkdir: cannot create directory '/root/x': Permission denied\n"
    await expect(service.mkdir('/root/x')).rejects.toMatchObject({ code: 'EACCES' })
    host.dirs.add('/home/alma/full')
    host.files.set('/home/alma/full/f', Buffer.from('x'))
    await expect(service.remove('/home/alma/full', 'dir')).rejects.toMatchObject({
      code: 'ENOTEMPTY',
    })
    await expect(service.list('/home/alma/nada')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('scp transfers', () => {
  it('uploads a file under its own name, announcing the exact size first', async () => {
    const { host, service } = setup()
    await upload(service, '/home/alma/subida.txt', Buffer.from('hola mundo'))
    expect(host.files.get('/home/alma/subida.txt')?.toString()).toBe('hola mundo')
    expect(host.commands.at(-1)).toBe("scp -t -- '/home/alma'")
  })

  it('uploads names with spaces and quotes, and an empty file', async () => {
    const { host, service } = setup()
    await upload(service, "/home/alma/it's a file.txt", Buffer.from('x'))
    expect(host.files.has("/home/alma/it's a file.txt")).toBe(true)
    await upload(service, '/home/alma/vacio', Buffer.alloc(0))
    expect(host.files.get('/home/alma/vacio')?.length).toBe(0)
  })

  it('moves a file bigger than the stream buffers intact', async () => {
    const { host, service } = setup()
    const big = Buffer.alloc(600 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251
    await upload(service, '/home/alma/grande.bin', big)
    expect(host.files.get('/home/alma/grande.bin')?.equals(big)).toBe(true)
    expect((await download(service, '/home/alma/grande.bin')).equals(big)).toBe(true)
  })

  it('downloads a file and an empty file', async () => {
    const { host, service } = setup()
    host.files.set('/home/alma/f.txt', Buffer.from('contenido'))
    host.files.set('/home/alma/e', Buffer.alloc(0))
    expect((await download(service, '/home/alma/f.txt')).toString()).toBe('contenido')
    expect((await download(service, '/home/alma/e')).length).toBe(0)
    expect(host.commands.at(-1)).toBe("scp -f -- '/home/alma/e'")
  })

  it('reports a missing file on download and a missing folder on upload', async () => {
    const { service } = setup()
    await expect(download(service, '/home/alma/nada')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(upload(service, '/no/existe/f', Buffer.from('x'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('fails an upload that sends more or fewer bytes than announced, and one without a size', async () => {
    const { host, service } = setup()
    await expect(upload(service, '/home/alma/a', Buffer.from('abcdef'), 3)).rejects.toThrow()
    await expect(upload(service, '/home/alma/b', Buffer.from('ab'), 5)).rejects.toThrow()
    const backend = await service.stream()
    const stream = backend.createWriteStream('/home/alma/c', { highWaterMark: 1024, flags: 'w' })
    await expect(pipeline(Readable.from([Buffer.from('x')]), stream)).rejects.toMatchObject({
      code: 'IO_FAILED',
    })
    expect(host.files.has('/home/alma/c')).toBe(false)
  })

  it('stat says ENOENT for a missing file, so the queue can create it', async () => {
    const { service } = setup()
    const backend = await service.stream()
    const error = await new Promise<Error | null | undefined>((resolve) =>
      backend.stat('/home/alma/nada', (e) => resolve(e)),
    )
    expect(error).toMatchObject({ code: 2 })
  })

  it('unlink removes a partial file and never complains about a missing one', async () => {
    const { host, service } = setup()
    host.files.set('/home/alma/parcial', Buffer.from('x'))
    const backend = await service.stream()
    await new Promise<void>((resolve) => backend.unlink('/home/alma/parcial', () => resolve()))
    expect(host.files.has('/home/alma/parcial')).toBe(false)
    await new Promise<void>((resolve) => backend.unlink('/home/alma/parcial', () => resolve()))
    expect(host.commands.at(-1)).toBe("rm -f -- '/home/alma/parcial'")
  })
})
