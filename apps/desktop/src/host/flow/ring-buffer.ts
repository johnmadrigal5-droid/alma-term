// Fixed-size circular buffer holding the newest `capacity` bytes of output.
export class ByteRing {
  private readonly buf: Uint8Array
  private start = 0
  private length = 0

  constructor(readonly capacity: number) {
    this.buf = new Uint8Array(capacity)
  }

  append(chunk: Uint8Array): void {
    if (chunk.length >= this.capacity) {
      this.buf.set(chunk.subarray(chunk.length - this.capacity))
      this.start = 0
      this.length = this.capacity
      return
    }
    const end = (this.start + this.length) % this.capacity
    const first = Math.min(chunk.length, this.capacity - end)
    this.buf.set(chunk.subarray(0, first), end)
    this.buf.set(chunk.subarray(first), 0)
    const overflow = Math.max(0, this.length + chunk.length - this.capacity)
    this.length = Math.min(this.capacity, this.length + chunk.length)
    this.start = (this.start + overflow) % this.capacity
  }

  snapshot(): Uint8Array {
    const out = new Uint8Array(this.length)
    const first = Math.min(this.length, this.capacity - this.start)
    out.set(this.buf.subarray(this.start, this.start + first))
    out.set(this.buf.subarray(0, this.length - first), first)
    return out
  }
}
