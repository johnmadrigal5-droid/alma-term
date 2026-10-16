import { EventEmitter } from 'node:events'
import { posix } from 'node:path'
import { Readable, Writable } from 'node:stream'
import type { SftpAttrs, SftpCallback, SftpDirEntry, SftpLike } from '../sftp/sftp-types'

type Node =
  | { kind: 'dir'; mode: number; mtime: number }
  | { kind: 'file'; mode: number; mtime: number; data: Buffer }
  | { kind: 'link'; mode: number; mtime: number; target: string }

const TYPE = { dir: 0o040000, file: 0o100000, link: 0o120000 } as const

/** ssh2 reports SFTP status codes as a numeric `code` on the Error. */
export function sftpError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const NO_SUCH_FILE = 2
const PERMISSION_DENIED = 3
const FAILURE = 4

/** In-memory SFTP server with the subset of ssh2's SFTPWrapper the app uses. */
export class FakeSftp extends EventEmitter implements SftpLike {
  readonly nodes = new Map<string, Node>([['/', { kind: 'dir', mode: 0o755, mtime: 0 }]])
  home = '/home/alma'
  /** Paths (and their children) that answer PERMISSION_DENIED. */
  readonly denied = new Set<string>()
  /** Files that exist but cannot be opened for writing (mode 444). */
  readonly readOnly = new Set<string>()
  /** Fails the next write stream after this many bytes with the given error. */
  writeFault: { afterBytes: number; error: Error } | null = null
  readonly writes: Writable[] = []
  readonly reads: Readable[] = []
  ended = false
  /** Runs right before a write stream opens its file (simulates a racing writer). */
  beforeOpen: ((path: string) => void) | null = null
  /** readdir answers every entry twice, like a hostile server. */
  duplicateNames = false
  /** Write streams ignore destroy() and never close, like a dead connection. */
  hangOnClose = false
  /**
   * Write streams behave like ssh2's: they destroy themselves in _final, never emit 'finish'
   * and emit 'close' by hand once the remote handle is closed.
   */
  ssh2Streams = false

  constructor() {
    super()
    this.mkdirp(this.home)
  }

  mkdirp(path: string): void {
    let current = ''
    for (const part of path.split('/').filter(Boolean)) {
      current += `/${part}`
      if (!this.nodes.has(current)) this.nodes.set(current, { kind: 'dir', mode: 0o755, mtime: 0 })
    }
  }

  file(path: string, content: string | Buffer, mtime = 0): void {
    this.mkdirp(posix.dirname(path))
    this.nodes.set(path, { kind: 'file', mode: 0o644, mtime, data: Buffer.from(content) })
  }

  link(path: string, target: string): void {
    this.nodes.set(path, { kind: 'link', mode: 0o777, mtime: 0, target })
  }

  read(path: string): Buffer | undefined {
    const node = this.nodes.get(path)
    return node?.kind === 'file' ? node.data : undefined
  }

  /** The server killed sftp-server: the channel closes, the SSH session lives on. */
  close(): void {
    this.emit('close')
  }

  private guard(path: string): Error | null {
    for (const d of this.denied)
      if (path === d || path.startsWith(`${d}/`))
        return sftpError(PERMISSION_DENIED, 'Permission denied')
    return null
  }

  private attrs(node: Node): SftpAttrs {
    return {
      mode: TYPE[node.kind] | node.mode,
      size: node.kind === 'file' ? node.data.length : 4096,
      mtime: node.mtime,
    }
  }

  private run<T>(path: string, cb: SftpCallback<T>, fn: () => T): void {
    const denied = this.guard(path)
    queueMicrotask(() => {
      if (denied) return cb(denied)
      try {
        cb(undefined, fn())
      } catch (error) {
        cb(error as Error)
      }
    })
  }

  private runVoid(path: string, cb: SftpCallback<undefined>, fn: () => void): void {
    this.run(path, cb, () => {
      fn()
      return undefined
    })
  }

  private need(path: string): Node {
    const node = this.nodes.get(path)
    if (!node) throw sftpError(NO_SUCH_FILE, 'No such file')
    return node
  }

  readdir(path: string, cb: SftpCallback<SftpDirEntry[]>): void {
    this.run(path, cb, () => {
      if (this.need(path).kind !== 'dir') throw sftpError(FAILURE, 'Not a directory')
      const prefix = path === '/' ? '/' : `${path}/`
      return [...this.nodes]
        .filter(
          ([p]) => p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'),
        )
        .map(([p, node]) => ({ filename: p.slice(prefix.length), attrs: this.attrs(node) }))
        .flatMap((entry) => (this.duplicateNames ? [entry, entry] : [entry]))
    })
  }

  stat(path: string, cb: SftpCallback<SftpAttrs>): void {
    this.run(path, cb, () => {
      let node = this.need(path)
      if (node.kind === 'link') node = this.need(node.target)
      return this.attrs(node)
    })
  }

  lstat(path: string, cb: SftpCallback<SftpAttrs>): void {
    this.run(path, cb, () => this.attrs(this.need(path)))
  }

  mkdir(path: string, cb: SftpCallback<undefined>): void {
    this.runVoid(path, cb, () => {
      if (this.nodes.has(path)) throw sftpError(FAILURE, 'Failure')
      this.need(posix.dirname(path))
      this.nodes.set(path, { kind: 'dir', mode: 0o755, mtime: 0 })
    })
  }

  rename(from: string, to: string, cb: SftpCallback<undefined>): void {
    this.runVoid(from, cb, () => {
      if (this.nodes.has(to)) throw sftpError(FAILURE, 'Failure')
      for (const [p, node] of [...this.nodes])
        if (p === from || p.startsWith(`${from}/`)) {
          this.nodes.delete(p)
          this.nodes.set(to + p.slice(from.length), node)
        }
    })
  }

  unlink(path: string, cb: SftpCallback<undefined>): void {
    this.runVoid(path, cb, () => {
      if (this.need(path).kind === 'dir') throw sftpError(FAILURE, 'Failure')
      this.nodes.delete(path)
    })
  }

  rmdir(path: string, cb: SftpCallback<undefined>): void {
    this.runVoid(path, cb, () => {
      if (this.need(path).kind !== 'dir') throw sftpError(FAILURE, 'Failure')
      if ([...this.nodes.keys()].some((p) => p.startsWith(`${path}/`)))
        throw sftpError(FAILURE, 'Failure')
      this.nodes.delete(path)
    })
  }

  chmod(path: string, mode: number, cb: SftpCallback<undefined>): void {
    this.runVoid(path, cb, () => {
      this.need(path).mode = mode & 0o7777
    })
  }

  realpath(path: string, cb: SftpCallback<string>): void {
    this.run(path, cb, () => (path === '.' ? this.home : posix.normalize(path)))
  }

  createReadStream(path: string, options: { highWaterMark: number }): Readable {
    const denied = this.guard(path)
    const node = this.nodes.get(path)
    let offset = 0
    const stream = new Readable({
      highWaterMark: options.highWaterMark,
      read: (size) => {
        if (denied) return stream.destroy(denied)
        if (node?.kind !== 'file') return stream.destroy(sftpError(NO_SUCH_FILE, 'No such file'))
        const chunk = node.data.subarray(offset, offset + Math.min(size, options.highWaterMark))
        offset += chunk.length
        stream.push(chunk.length > 0 ? chunk : null)
      },
    })
    this.reads.push(stream)
    return stream
  }

  createWriteStream(
    path: string,
    options: { highWaterMark?: number; mode?: number; flags?: 'w' | 'wx' },
  ): Writable {
    const denied = this.guard(path)
    const fault = this.writeFault
    this.writeFault = null
    let written = 0
    const ssh2 = this.ssh2Streams
    const stream: Writable = new Writable({
      highWaterMark: options.highWaterMark,
      emitClose: !ssh2,
      // Like SFTP OPEN with flags "w": fails before touching the file, else truncates it.
      construct: (done) => {
        queueMicrotask(() => {
          this.beforeOpen?.(path)
          this.beforeOpen = null
          if (denied) return done(denied)
          // OpenSSH answers O_EXCL on an existing file with a bare SSH_FX_FAILURE (SFTP v3).
          if (options.flags === 'wx' && this.nodes.has(path))
            return done(sftpError(FAILURE, 'Failure'))
          if (this.readOnly.has(path))
            return done(sftpError(PERMISSION_DENIED, 'Permission denied'))
          if (!this.nodes.has(posix.dirname(path)))
            return done(sftpError(NO_SUCH_FILE, 'No such file'))
          this.nodes.set(path, {
            kind: 'file',
            mode: options.mode ?? 0o644,
            mtime: 0,
            data: Buffer.alloc(0),
          })
          stream.emit('open')
          done()
        })
      },
      final: (done) => {
        if (!ssh2) return done()
        stream.destroy()
        done()
        setTimeout(() => stream.emit('close'), 1)
      },
      write: (chunk: Buffer, _enc, done) => {
        if (fault && written + chunk.length > fault.afterBytes) return done(fault.error)
        written += chunk.length
        const node = this.nodes.get(path)
        if (node?.kind === 'file') node.data = Buffer.concat([node.data, chunk])
        queueMicrotask(() => done())
      },
    })
    if (this.hangOnClose) stream.destroy = () => stream
    this.writes.push(stream)
    return stream
  }

  end(): void {
    this.ended = true
  }
}
