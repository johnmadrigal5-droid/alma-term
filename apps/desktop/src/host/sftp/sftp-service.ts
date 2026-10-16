import type { RemoteEntry, RemoteKind } from '@alma/protocol'
import { posix } from 'node:path'
import { isEntryName } from './remote-path'
import type { RemoteFiles } from './remote-files'
import { mapSftpError, SftpFailure } from './sftp-errors'
import type { SftpAttrs, SftpCallback, SftpLike } from './sftp-types'

const S_IFMT = 0o170000
const KINDS: Record<number, RemoteKind> = { 0o040000: 'dir', 0o100000: 'file', 0o120000: 'link' }

function toEntry(name: string, attrs: SftpAttrs): RemoteEntry {
  return {
    name,
    kind: KINDS[attrs.mode & S_IFMT] ?? 'other',
    size: Math.max(0, Math.trunc(attrs.size)),
    mtimeMs: Math.max(0, Math.trunc(attrs.mtime)) * 1000,
    mode: attrs.mode & 0o7777,
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function byFolderThenName(a: RemoteEntry, b: RemoteEntry): number {
  const rank = (e: RemoteEntry) => (e.kind === 'dir' ? 0 : 1)
  return rank(a) - rank(b) || collator.compare(a.name, b.name)
}

function call<T = undefined>(fn: (cb: SftpCallback<T>) => void, op?: 'rmdir'): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((error, value) =>
      error ? reject(new SftpFailure(mapSftpError(error, op))) : resolve(value as T),
    ),
  )
}

/**
 * One lazy SFTP channel over a session's SSH connection. If the server closes the channel
 * (sftp-server killed) the next call opens a new one; the shell is not affected.
 */
export class SftpService implements RemoteFiles {
  private channel: Promise<SftpLike> | null = null
  private disposed = false

  constructor(private readonly open: () => Promise<SftpLike>) {}

  /** The live channel, for transfers that stream over it. */
  stream(): Promise<SftpLike> {
    if (this.disposed)
      return Promise.reject(
        new SftpFailure({ code: 'SESSION_NOT_FOUND', message: 'La sesión se cerró' }),
      )
    if (this.channel) return this.channel
    const opening = this.open().then(
      (sftp) => {
        const forget = () => {
          if (this.channel === opening) this.channel = null
        }
        sftp.on('close', forget)
        // ssh2 drops its own listener once ready: an unhandled 'error' would kill the host.
        sftp.on('error', forget)
        return sftp
      },
      (error: unknown) => {
        if (this.channel === opening) this.channel = null
        // ssh2 says this when the server refuses the sftp subsystem. A busy server (MaxSessions)
        // or a dropped channel says something else and may work next time, so it must not read
        // as "no SFTP" (which switches the connection to scp for good).
        if (error instanceof Error && /unable to start subsystem/i.test(error.message))
          throw new SftpFailure({
            code: 'SFTP_UNAVAILABLE',
            message: 'El servidor no ofrece SFTP; el explorador de archivos no está disponible',
          })
        throw new SftpFailure({
          code: 'IO_FAILED',
          message: 'No se pudo abrir el canal SFTP; inténtalo de nuevo',
        })
      },
    )
    this.channel = opening
    return opening
  }

  async home(): Promise<string> {
    const sftp = await this.stream()
    return call<string>((cb) => sftp.realpath('.', cb))
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const sftp = await this.stream()
    const seen = new Set<string>()
    const list = await call<{ filename: string; attrs: SftpAttrs }[]>((cb) =>
      sftp.readdir(path, cb),
    )
    return (
      list
        // Also drops names no SFTP server may send ("a/b", NUL): they could address other paths.
        .filter((e) => isEntryName(e.filename))
        // A hostile server can repeat a name; rows and their errors are keyed by name.
        .filter((e) => !seen.has(e.filename) && Boolean(seen.add(e.filename)))
        .map((e) => toEntry(e.filename, e.attrs))
        .sort(byFolderThenName)
    )
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const sftp = await this.stream()
    try {
      return toEntry(posix.basename(path), await call<SftpAttrs>((cb) => sftp.stat(path, cb)))
    } catch (error) {
      if (error instanceof SftpFailure && error.code === 'ENOENT') return null
      throw error
    }
  }

  async mkdir(path: string): Promise<void> {
    const sftp = await this.stream()
    await call((cb) => sftp.mkdir(path, cb))
  }

  async rename(from: string, to: string): Promise<void> {
    const sftp = await this.stream()
    await call((cb) => sftp.rename(from, to, cb))
  }

  async remove(path: string, kind: RemoteKind): Promise<void> {
    const sftp = await this.stream()
    if (kind === 'dir') await call((cb) => sftp.rmdir(path, cb), 'rmdir')
    else await call((cb) => sftp.unlink(path, cb))
  }

  async chmod(path: string, mode: number): Promise<void> {
    const sftp = await this.stream()
    await call((cb) => sftp.chmod(path, mode, cb))
  }

  dispose(): void {
    this.disposed = true
    const channel = this.channel
    this.channel = null
    void channel?.then(
      (sftp) => sftp.end(),
      () => undefined,
    )
  }
}
