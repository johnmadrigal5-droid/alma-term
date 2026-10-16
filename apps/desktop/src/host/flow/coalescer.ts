import { realScheduler, type Scheduler } from './scheduler'
import { incompleteUtf8TailLength } from './utf8'

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const [first] = chunks
  if (chunks.length === 1 && first) return first
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

// Batches terminal output into windows; sends right away after idle periods and
// never emits a buffer that ends in the middle of a UTF-8 character.
export class Coalescer {
  private chunks: Uint8Array[] = []
  private size = 0
  private timer: unknown = null
  private lastFlushAt = Number.NEGATIVE_INFINITY
  private holdingOnly = false

  constructor(
    private readonly emit: (bytes: Uint8Array) => void,
    private readonly windowMs: number,
    private readonly scheduler: Scheduler = realScheduler,
  ) {}

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.size += chunk.length
    this.holdingOnly = false
    const elapsed = this.scheduler.now() - this.lastFlushAt
    if (elapsed >= this.windowMs) {
      this.flush(true)
      return
    }
    if (this.timer === null) this.schedule(this.windowMs - elapsed)
  }

  dispose(): void {
    this.flush(false)
  }

  private schedule(ms: number): void {
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      this.flush(!this.holdingOnly)
    }, ms)
  }

  private flush(allowHold: boolean): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.size === 0) return
    const all = concat(this.chunks, this.size)
    const tail = allowHold ? incompleteUtf8TailLength(all) : 0
    const cut = all.length - tail
    if (cut > 0) {
      this.emit(all.subarray(0, cut))
      this.lastFlushAt = this.scheduler.now()
    }
    if (tail > 0) {
      this.chunks = [all.slice(cut)]
      this.size = tail
      this.holdingOnly = true
      this.schedule(this.windowMs)
    } else {
      this.chunks = []
      this.size = 0
    }
  }
}
