import type { Readable, Writable } from 'node:stream'

export type SftpCallback<T> = (error: Error | null | undefined, value?: T) => void

/** The fields of ssh2's Stats the app reads; `mode` carries the file type bits. */
export interface SftpAttrs {
  mode: number
  size: number
  /** Seconds since the epoch, as SFTP v3 sends it. */
  mtime: number
}

export interface SftpDirEntry {
  filename: string
  attrs: SftpAttrs
}

/** The subset of ssh2's SFTPWrapper the app uses, so tests can run against a fake. */
export interface SftpLike {
  readdir(path: string, cb: SftpCallback<SftpDirEntry[]>): void
  stat(path: string, cb: SftpCallback<SftpAttrs>): void
  lstat(path: string, cb: SftpCallback<SftpAttrs>): void
  mkdir(path: string, cb: SftpCallback<undefined>): void
  rename(from: string, to: string, cb: SftpCallback<undefined>): void
  unlink(path: string, cb: SftpCallback<undefined>): void
  rmdir(path: string, cb: SftpCallback<undefined>): void
  chmod(path: string, mode: number, cb: SftpCallback<undefined>): void
  realpath(path: string, cb: SftpCallback<string>): void
  createReadStream(path: string, options: { highWaterMark: number }): Readable
  createWriteStream(
    path: string,
    options: { highWaterMark?: number; mode?: number; flags?: 'w' | 'wx'; size?: number },
  ): Writable
  end(): void
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

/** What the transfer queue needs of a remote side: SFTP, or the scp fallback. */
export type TransferBackend = Pick<
  SftpLike,
  'stat' | 'unlink' | 'createReadStream' | 'createWriteStream'
>
