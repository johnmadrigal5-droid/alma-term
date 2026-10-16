import type { RemoteEntry, RemoteKind } from '@alma/protocol'
import { posix } from 'node:path'
import type { RemoteFiles } from '../sftp/remote-files'
import { isEntryName } from '../sftp/remote-path'
import { SftpFailure } from '../sftp/sftp-errors'
import type { TransferBackend } from '../sftp/sftp-types'
import { scpFailure } from './scp-errors'
import { ScpReadStream, ScpWriteStream, type Exec } from './scp-streams'
import { shellQuote } from './shell-quote'

const OUTPUT_LIMIT = 4 * 1024 * 1024
const NO_SUCH_FILE = 2

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const byFolderThenName = (a: RemoteEntry, b: RemoteEntry) =>
  (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name)

/** A path that is safe to put in a command: no NUL, no `..`, not empty. */
function checked(path: string): string {
  if (path === '' || path.includes('\0') || path.split('/').includes('..'))
    throw new SftpFailure({ code: 'INVALID_MESSAGE', message: 'Ruta no válida' })
  return path
}

/**
 * The file browser over plain commands and the scp protocol, for servers without an SFTP
 * subsystem. Every path goes through `shellQuote`; the listing has no size or date (the entries
 * carry zeros and the UI shows a dash).
 */
export class ScpService implements RemoteFiles {
  constructor(private readonly exec: Exec) {}

  private async run(command: string): Promise<string> {
    const channel = await this.exec(command)
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    channel.io.on('data', (c: Buffer) => {
      size += c.length
      if (size <= OUTPUT_LIMIT) out.push(c)
      else channel.close()
    })
    channel.stderr.on('data', (c: Buffer) => err.push(c))
    // Nothing is typed into the command: close its input so it never waits for us.
    channel.io.end()
    const code = await channel.exit
    if (size > OUTPUT_LIMIT)
      throw new SftpFailure({
        code: 'IO_FAILED',
        message: 'La carpeta es demasiado grande para listarla',
      })
    if (code !== 0) throw scpFailure(Buffer.concat(err).toString('utf8'))
    return Buffer.concat(out).toString('utf8')
  }

  async home(): Promise<string> {
    return (await this.run('pwd')).trim() || '/'
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const output = await this.run(`ls -1ApL -- ${shellQuote(checked(path))}`)
    return (
      output
        .split('\n')
        .filter((line) => line !== '')
        .map((line): RemoteEntry => {
          const dir = line.endsWith('/')
          return {
            name: dir ? line.slice(0, -1) : line,
            kind: dir ? 'dir' : 'file',
            size: 0,
            mtimeMs: 0,
            mode: 0,
          }
        })
        // Names a server must never send, as the SFTP side drops them.
        .filter((entry) => isEntryName(entry.name))
        .sort(byFolderThenName)
    )
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const quoted = shellQuote(checked(path))
    const answer = (
      await this.run(
        `if [ -d ${quoted} ]; then echo d; elif [ -e ${quoted} ]; then echo f $(wc -c < ${quoted}); else echo n; fi`,
      )
    ).trim()
    const name = posix.basename(path)
    if (answer === 'n') return null
    if (answer === 'd') return { name, kind: 'dir', size: 0, mtimeMs: 0, mode: 0 }
    const size = Number(answer.split(' ')[1])
    return { name, kind: 'file', size: Number.isFinite(size) ? size : 0, mtimeMs: 0, mode: 0 }
  }

  async mkdir(path: string): Promise<void> {
    await this.run(`mkdir -- ${shellQuote(checked(path))}`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.run(`mv -n -- ${shellQuote(checked(from))} ${shellQuote(checked(to))}`)
  }

  async remove(path: string, kind: RemoteKind): Promise<void> {
    const command = kind === 'dir' ? 'rmdir' : 'rm'
    await this.run(`${command} -- ${shellQuote(checked(path))}`)
  }

  async chmod(path: string, mode: number): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)
      throw new SftpFailure({ code: 'INVALID_MESSAGE', message: 'Permisos no válidos' })
    await this.run(`chmod ${mode.toString(8)} -- ${shellQuote(checked(path))}`)
  }

  async stream(): Promise<TransferBackend> {
    const attrs = async (path: string) => {
      const entry = await this.stat(path)
      if (!entry) throw Object.assign(new Error('No such file'), { code: NO_SUCH_FILE })
      return { mode: entry.kind === 'dir' ? 0o040000 : 0o100000, size: entry.size, mtime: 0 }
    }
    return {
      stat: (path, cb) => {
        attrs(path).then(
          (value) => cb(null, value),
          (error: unknown) => cb(error instanceof Error ? error : new Error(String(error))),
        )
      },
      unlink: (path, cb) => {
        this.run(`rm -f -- ${shellQuote(checked(path))}`).then(
          () => cb(null),
          (error: unknown) => cb(error instanceof Error ? error : new Error(String(error))),
        )
      },
      createReadStream: (path, options) =>
        new ScpReadStream(this.exec, checked(path), options.highWaterMark),
      createWriteStream: (path, options) =>
        new ScpWriteStream(this.exec, checked(path), options.size, options.highWaterMark),
    }
  }

  dispose(): void {}
}
