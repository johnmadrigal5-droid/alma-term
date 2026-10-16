import { Readable, Writable } from 'node:stream'
import { SftpFailure } from '../sftp/sftp-errors'
import type { ExecChannel } from '../ssh/connector-types'
import { mapScpMessage, scpFailure } from './scp-errors'
import { AckReader, formatHeader, ScpSourceParser, type AckResult } from './scp-protocol'
import { shellQuote } from './shell-quote'

export type Exec = (command: string) => Promise<ExecChannel>

const ZERO = Uint8Array.of(0)

/** Acknowledgements as promises, in the order the peer sends them. */
class Acks {
  private readonly reader = new AckReader()
  private readonly queue: AckResult[] = []
  private waiter: { resolve(result: AckResult): void; reject(error: Error): void } | null = null
  private ended: Error | null = null

  constructor(private readonly channel: ExecChannel) {
    channel.io.on('data', (chunk: Buffer) => {
      for (const result of this.reader.feed(chunk)) {
        const waiter = this.waiter
        if (waiter) {
          this.waiter = null
          waiter.resolve(result)
        } else this.queue.push(result)
      }
    })
    const end = () => {
      this.ended = new Error('El servidor cerró el canal')
      this.waiter?.reject(this.ended)
      this.waiter = null
    }
    channel.io.once('close', end)
    channel.io.once('end', end)
  }

  /** Resolves on a zero byte; a server error line becomes a typed failure. */
  async next(): Promise<void> {
    const result = this.queue.shift() ?? (await this.wait())
    if (!result.ok) throw scpFailure(result.message)
  }

  private wait(): Promise<AckResult> {
    if (this.ended) return Promise.reject(this.ended)
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
const basenameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

async function stderrOf(channel: ExecChannel): Promise<string> {
  const chunks: Buffer[] = []
  channel.stderr.on('data', (c: Buffer) => chunks.push(c))
  await channel.exit.catch(() => null)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Upload by scp (`scp -t`): the header carries the size, so the caller must give it. Ends when
 * the server confirmed the file and the command exited; the stream emits 'open' once the server
 * accepted the header.
 */
export class ScpWriteStream extends Writable {
  private channel: ExecChannel | null = null
  private acks: Acks | null = null
  private written = 0

  constructor(
    private readonly exec: Exec,
    private readonly remotePath: string,
    private readonly size: number | undefined,
    highWaterMark?: number,
  ) {
    super({
      ...(highWaterMark !== undefined ? { highWaterMark } : {}),
      construct: (callback) => {
        this.open().then(() => callback(), callback)
      },
    })
  }

  private async open(): Promise<void> {
    if (this.size === undefined)
      throw new SftpFailure({ code: 'IO_FAILED', message: 'SCP necesita conocer el tamaño' })
    const channel = await this.exec(`scp -t -- ${shellQuote(dirnameOf(this.remotePath))}`)
    this.channel = channel
    const acks = new Acks(channel)
    this.acks = acks
    try {
      await acks.next()
      channel.io.write(formatHeader(this.size, basenameOf(this.remotePath)))
      await acks.next()
    } catch (error) {
      const said = await Promise.race([
        stderrOf(channel),
        new Promise<string>((r) => setTimeout(() => r(''), 200)),
      ])
      channel.close()
      // The server's own words say more than "the channel closed".
      throw said.trim() !== '' ? scpFailure(said) : error
    }
    this.emit('open')
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.written += chunk.length
    if (this.size !== undefined && this.written > this.size)
      return callback(
        new SftpFailure({ code: 'IO_FAILED', message: 'Se enviaron más bytes de los anunciados' }),
      )
    const io = this.channel?.io
    if (!io) return callback(new Error('Canal SCP no abierto'))
    if (io.write(chunk)) callback()
    else io.once('drain', () => callback())
  }

  override _final(callback: (error?: Error | null) => void): void {
    const run = async () => {
      if (this.written !== this.size)
        throw new SftpFailure({
          code: 'IO_FAILED',
          message: 'La subida terminó antes de enviar todos los bytes',
        })
      const io = this.channel?.io
      if (!io || !this.acks) throw new Error('Canal SCP no abierto')
      io.write(ZERO)
      await this.acks.next()
      io.end()
      await this.channel?.exit
    }
    run().then(() => callback(), callback)
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.channel?.close()
    callback(error)
  }
}

/**
 * Download by scp (`scp -f`): reads the one file the server announces and gives its bytes.
 * Anything else (a directory, a name that is not a plain file name) fails the stream.
 */
export class ScpReadStream extends Readable {
  private channel: ExecChannel | null = null
  private readonly parser = new ScpSourceParser()
  /** The server sent the whole file: closing the channel after that is the normal end. */
  private sourceDone = false

  constructor(
    private readonly exec: Exec,
    private readonly remotePath: string,
    highWaterMark?: number,
  ) {
    super(highWaterMark !== undefined ? { highWaterMark } : {})
  }

  override _construct(callback: (error?: Error | null) => void): void {
    this.exec(`scp -f -- ${shellQuote(this.remotePath)}`).then((channel) => {
      this.channel = channel
      const io = channel.io
      io.on('data', (chunk: Buffer) => this.onData(chunk))
      io.once('close', () => {
        // The command ended before the file did: say what the server complained about.
        if (!this.sourceDone && !this.readableEnded && !this.destroyed)
          void stderrOf(channel).then((said) =>
            this.destroy(
              said.trim() !== ''
                ? scpFailure(said)
                : new SftpFailure({ code: 'IO_FAILED', message: 'El servidor cerró el canal' }),
            ),
          )
      })
      io.write(ZERO)
      callback()
    }, callback)
  }

  override _read(): void {
    this.channel?.io.resume()
  }

  private onData(chunk: Buffer): void {
    const io = this.channel?.io
    if (!io) return
    for (const event of this.parser.feed(chunk)) {
      if (event.type === 'header') {
        io.write(ZERO)
      } else if (event.type === 'data') {
        if (!this.push(Buffer.from(event.bytes))) io.pause()
      } else if (event.type === 'end') {
        this.sourceDone = true
        io.write(ZERO)
        this.push(null)
      } else {
        this.destroy(new SftpFailure(mapScpMessage(event.message)))
        return
      }
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.channel?.close()
    callback(error)
  }
}
