import { createReadStream, createWriteStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { basename, posix } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  TIMEOUTS,
  TRANSFER,
  type ProtocolError,
  type TransferDirection,
  type TransferEvent,
  type TransferState,
} from '@alma/protocol'
import type { Scheduler } from '../flow/scheduler'
import { mapSftpError, SftpFailure } from './sftp-errors'
import type { SftpAttrs, TransferBackend } from './sftp-types'

/** The local disk as the queue uses it; injectable so tests run in memory. */
export interface LocalFs {
  createReadStream(path: string, options: { highWaterMark: number }): Readable
  createWriteStream(path: string, options: { highWaterMark: number; flags: 'w' | 'wx' }): Writable
  /** null when nothing exists at the path. */
  stat(path: string): Promise<{ size: number } | null>
  rm(path: string): Promise<void>
}

export const nodeFs: LocalFs = {
  createReadStream: (path, options) => createReadStream(path, options),
  createWriteStream: (path, options) => createWriteStream(path, options),
  stat: async (path) => {
    try {
      return { size: (await stat(path)).size }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  },
  rm: (path) => rm(path, { force: true }),
}

/** How long a cleanup may take before it is given up on (a dead connection never answers). */
export const CLEANUP_TIMEOUT_MS = 5_000

export interface TransferJob {
  transferId: string
  sessionId: string
  direction: TransferDirection
  localPath: string
  remotePath: string
  overwrite: boolean
  sftp: () => Promise<TransferBackend>
}

interface TransferQueueDeps {
  local: LocalFs
  scheduler: Scheduler
  send(event: TransferEvent): void
}

interface Active {
  job: TransferJob
  state: TransferState
  bytes: number
  total: number
  /** Set once the streams were created; `opened` once the destination file was opened. */
  streams: {
    read: Readable
    write: Writable
    opened: boolean
    removeDestination: () => Promise<void>
  } | null
  lastProgress: number
  stall: unknown
  /** start() is between its first await and opening the streams. */
  starting: boolean
}

const failure = (code: ProtocolError['code'], message: string) => new SftpFailure({ code, message })

function remoteStat(sftp: TransferBackend, path: string): Promise<SftpAttrs | null> {
  return new Promise((resolve, reject) =>
    sftp.stat(path, (error, attrs) => {
      if (!error) return resolve(attrs ?? null)
      const mapped = mapSftpError(error)
      if (mapped.code === 'ENOENT') resolve(null)
      else reject(new SftpFailure(mapped))
    }),
  )
}

function remoteUnlink(sftp: TransferBackend, path: string): Promise<void> {
  return new Promise((resolve) => sftp.unlink(path, () => resolve()))
}

function closed(stream: Writable): Promise<void> {
  if (stream.closed) return Promise.resolve()
  return new Promise((resolve) => stream.once('close', () => resolve()))
}

/**
 * Moves file bytes between the local disk and SFTP. At most two transfers run at once in
 * 64 KB blocks; progress goes out at most every 200 ms, plus one event per state change.
 * A paused transfer frees its slot; resuming one that already started continues at once.
 */
export class TransferQueue {
  private readonly jobs = new Map<string, Active>()
  /** Cleanups still running (closing streams, removing partial files), by session. */
  private readonly cleaning = new Set<{ sessionId: string; done: Promise<void> }>()

  constructor(private readonly deps: TransferQueueDeps) {}

  has(transferId: string): boolean {
    return this.jobs.has(transferId)
  }

  add(job: TransferJob): void {
    const active: Active = {
      job,
      state: 'queued',
      bytes: 0,
      total: 0,
      streams: null,
      lastProgress: 0,
      stall: null,
      starting: false,
    }
    this.jobs.set(job.transferId, active)
    this.emit(active)
    this.pump()
  }

  pause(transferId: string): void {
    const active = this.jobs.get(transferId)
    if (!active || (active.state !== 'running' && active.state !== 'queued')) return
    active.streams?.read.pause()
    this.clearStall(active)
    this.setState(active, 'paused')
    this.pump()
  }

  resume(transferId: string): void {
    const active = this.jobs.get(transferId)
    if (active?.state !== 'paused') return
    // Still checking: back to running and the pending start() carries on.
    if (!active.streams && active.starting) return this.setState(active, 'running')
    if (!active.streams) {
      this.setState(active, 'queued')
      this.pump()
      return
    }
    this.setState(active, 'running')
    this.armStall(active)
    if (!active.streams.write.writableNeedDrain) active.streams.read.resume()
  }

  cancel(transferId: string): void {
    const active = this.jobs.get(transferId)
    if (active) void this.finish(active, 'cancelled')
  }

  /** Resolves once every transfer of the session released its streams and partial files. */
  async cancelSession(sessionId: string): Promise<void> {
    for (const active of [...this.jobs.values()])
      if (active.job.sessionId === sessionId) void this.finish(active, 'cancelled')
    await Promise.all(
      [...this.cleaning].filter((c) => c.sessionId === sessionId).map((c) => c.done),
    )
  }

  /** The session's connection died: its transfers end in error now, not after the stall timeout. */
  failSession(sessionId: string, error: ProtocolError): void {
    for (const active of [...this.jobs.values()])
      if (active.job.sessionId === sessionId) void this.finish(active, 'error', error)
  }

  dispose(): void {
    for (const active of [...this.jobs.values()]) void this.finish(active, 'cancelled')
  }

  private pump(): void {
    let running = [...this.jobs.values()].filter((a) => a.state === 'running').length
    for (const active of this.jobs.values()) {
      if (running >= TRANSFER.parallel) return
      if (active.state !== 'queued') continue
      running += 1
      this.setState(active, 'running')
      active.starting = true
      void this.start(active)
        .catch((error: unknown) => this.fail(active, error))
        .finally(() => {
          active.starting = false
        })
    }
  }

  private async start(active: Active): Promise<void> {
    const { job } = active
    const sftp = await job.sftp()
    const upload = job.direction === 'upload'
    const source = upload
      ? await this.deps.local.stat(job.localPath)
      : await remoteStat(sftp, job.remotePath)
    if (!source) throw failure('ENOENT', 'No existe el archivo o la carpeta')
    const existing = upload
      ? await remoteStat(sftp, job.remotePath)
      : await this.deps.local.stat(job.localPath)
    if (existing && !job.overwrite) throw failure('EEXIST', 'Ya existe un archivo con ese nombre')
    // Synchronously with the decision below, so resume() never waits on a start that returned.
    active.starting = false
    // Cancelled or paused while the checks above ran: open nothing; resume starts over.
    if (active.state !== 'running') return
    active.total = Math.max(0, Math.trunc(source.size))
    const options = { highWaterMark: TRANSFER.chunkBytes }
    const read = upload
      ? this.deps.local.createReadStream(job.localPath, options)
      : sftp.createReadStream(job.remotePath, options)
    // Exclusive when not overwriting: a file that appeared after the check above is left alone.
    const flags = job.overwrite ? 'w' : 'wx'
    const write = upload
      ? sftp.createWriteStream(job.remotePath, { ...options, flags, size: active.total })
      : this.deps.local.createWriteStream(job.localPath, { ...options, flags })
    const removeDestination = upload
      ? () => remoteUnlink(sftp, job.remotePath)
      : () => this.deps.local.rm(job.localPath)
    const streams = { read, write, opened: false, removeDestination }
    active.streams = streams
    // Only an opened destination was created or truncated by us: a failed open (read-only
    // file, denied folder) must leave whatever was there untouched.
    write.once('open', () => {
      streams.opened = true
    })
    active.lastProgress = this.deps.scheduler.now()
    this.armStall(active)

    const onError = (error: unknown) => this.fail(active, error)
    read.on('error', onError)
    write.on('error', onError)
    read.on('data', (chunk: Buffer) => {
      active.bytes += chunk.length
      this.armStall(active)
      const now = this.deps.scheduler.now()
      if (now - active.lastProgress >= TRANSFER.progressMs) {
        active.lastProgress = now
        this.emit(active)
      }
      if (!write.write(chunk)) read.pause()
    })
    write.on('drain', () => {
      if (active.state === 'running') read.resume()
    })
    let readEnded = false
    read.on('end', () => {
      readEnded = true
      write.end()
    })
    // 'close' and not 'finish': ssh2's write stream destroys itself in _final and only emits
    // 'close', once the remote handle is closed. A cancel or error changed the state first.
    // ssh2 may emit 'close' twice (Node's own and its manual emit); the second finds the job gone.
    write.on('close', () => {
      if (!readEnded || (active.state !== 'running' && active.state !== 'paused')) return
      this.clearStall(active)
      this.setState(active, 'done')
      this.jobs.delete(job.transferId)
      this.pump()
    })
  }

  private fail(active: Active, error: unknown): void {
    let mapped = error instanceof SftpFailure ? error.toProtocol() : mapSftpError(error)
    // An exclusive open that OpenSSH refuses answers a bare "Failure": with overwrite off, that
    // means something took the name since the existence check.
    const { job, streams } = active
    if (
      mapped.code === 'IO_FAILED' &&
      job.direction === 'upload' &&
      !job.overwrite &&
      streams &&
      !streams.opened
    )
      mapped = { code: 'EEXIST', message: 'Ya existe un archivo con ese nombre' }
    void this.finish(active, 'error', mapped)
  }

  private async finish(active: Active, state: 'cancelled' | 'error', error?: ProtocolError) {
    if (!this.jobs.has(active.job.transferId) || active.state === 'done') return
    this.jobs.delete(active.job.transferId)
    this.clearStall(active)
    const streams = active.streams
    active.state = state
    this.emit(active, error)
    this.pump()
    if (!streams) return
    streams.read.destroy()
    streams.write.destroy()
    const work = closed(streams.write)
      .then(() => (streams.opened ? streams.removeDestination() : undefined))
      .catch(() => undefined)
    // On a dead connection neither the close nor the unlink ever answers: stop waiting.
    let timer: unknown
    const giveUp = new Promise<void>((resolve) => {
      timer = this.deps.scheduler.setTimeout(resolve, CLEANUP_TIMEOUT_MS)
    })
    const cleanup = {
      sessionId: active.job.sessionId,
      done: Promise.race([work, giveUp]).then(() => this.deps.scheduler.clearTimeout(timer)),
    }
    this.cleaning.add(cleanup)
    await cleanup.done
    this.cleaning.delete(cleanup)
  }

  private armStall(active: Active): void {
    this.clearStall(active)
    active.stall = this.deps.scheduler.setTimeout(
      () => this.fail(active, failure('TRANSFER_STALLED', 'La transferencia no avanza')),
      TIMEOUTS.transferStallMs,
    )
  }

  private clearStall(active: Active): void {
    if (active.stall !== null) this.deps.scheduler.clearTimeout(active.stall)
    active.stall = null
  }

  private setState(active: Active, state: TransferState): void {
    active.state = state
    this.emit(active)
  }

  private emit(active: Active, error?: ProtocolError): void {
    const { job } = active
    this.deps.send({
      type: 'event.transfer',
      transferId: job.transferId,
      sessionId: job.sessionId,
      direction: job.direction,
      name: job.direction === 'upload' ? basename(job.localPath) : posix.basename(job.remotePath),
      state: active.state,
      bytes: active.bytes,
      total: active.total,
      ...(error ? { error } : {}),
    })
  }
}
