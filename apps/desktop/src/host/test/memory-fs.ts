import { PassThrough, Readable, Writable } from 'node:stream'
import type { LocalFs } from '../sftp/transfer-queue'

/** Local disk in memory; `controlled` sources let a test decide when bytes arrive. */
export class MemoryFs implements LocalFs {
  readonly files = new Map<string, Buffer>()
  readonly readStreams: Readable[] = []
  /** Open flags of each write stream, by path. */
  readonly flags = new Map<string, string>()
  /** Runs right before a write stream is created (simulates a file that appears first). */
  beforeCreate: ((path: string) => void) | null = null
  private readonly sources = new Map<string, { stream: PassThrough; size: number }>()

  controlled(path: string, size: number): PassThrough {
    const stream = new PassThrough()
    this.sources.set(path, { stream, size })
    return stream
  }

  createReadStream(path: string, options: { highWaterMark: number }): Readable {
    const source = this.sources.get(path)
    if (source) {
      this.readStreams.push(source.stream)
      return source.stream
    }
    const data = this.files.get(path) ?? Buffer.alloc(0)
    let offset = 0
    const stream = new Readable({
      highWaterMark: options.highWaterMark,
      read: () => {
        const chunk = data.subarray(offset, offset + options.highWaterMark)
        offset += chunk.length
        stream.push(chunk.length > 0 ? chunk : null)
      },
    })
    this.readStreams.push(stream)
    return stream
  }

  createWriteStream(path: string, options: { highWaterMark: number; flags: 'w' | 'wx' }): Writable {
    this.beforeCreate?.(path)
    this.flags.set(path, options.flags)
    if (options.flags === 'wx' && this.files.has(path))
      return new Writable({
        construct: (done) =>
          done(Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })),
      })
    this.files.set(path, Buffer.alloc(0))
    const stream: Writable = new Writable({
      construct: (done) => {
        queueMicrotask(() => {
          stream.emit('open')
          done()
        })
      },
      write: (chunk: Buffer, _enc, done) => {
        this.files.set(path, Buffer.concat([this.files.get(path) ?? Buffer.alloc(0), chunk]))
        queueMicrotask(() => done())
      },
    })
    return stream
  }

  async stat(path: string): Promise<{ size: number } | null> {
    const source = this.sources.get(path)
    if (source) return { size: source.size }
    const data = this.files.get(path)
    return data ? { size: data.length } : null
  }

  async rm(path: string): Promise<void> {
    this.files.delete(path)
  }
}
