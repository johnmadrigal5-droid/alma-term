// @vitest-environment node
import { PassThrough, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { describe, expect, it } from 'vitest'
import type { ExecChannel } from '../ssh/connector-types'
import { socketPair } from '../test/fake-tunnel-net'
import { formatHeader } from './scp-protocol'
import { ScpReadStream, type Exec } from './scp-streams'

/** A server that sends one file at once and closes the channel right after the last byte. */
function eagerServer(content: Buffer): Exec {
  return async () => {
    const [io, peer] = socketPair()
    const stderr = new PassThrough()
    let finish: (code: number | null) => void = () => undefined
    const exit = new Promise<number | null>((resolve) => {
      finish = resolve
    })
    const channel: ExecChannel = {
      io,
      stderr,
      exit,
      close: () => {
        io.destroy()
        peer.destroy()
        finish(null)
      },
    }
    let acks = 0
    peer.on('data', () => {
      acks += 1
      if (acks === 1) peer.write(formatHeader(content.length, 'f.bin'))
      if (acks === 2) {
        peer.write(content)
        peer.write(Buffer.from([0]))
        peer.end()
      }
      if (acks === 3) finish(0)
    })
    return channel
  }
}

describe('ScpReadStream', () => {
  it('I1: a finished download is not failed because the channel closed before the consumer drained it', async () => {
    const content = Buffer.alloc(300 * 1024)
    for (let i = 0; i < content.length; i++) content[i] = (i * 7) % 253
    const got: Buffer[] = []
    // A slow consumer and small buffers: the channel is long closed when the last bytes are read.
    const slow = new Writable({
      highWaterMark: 1024,
      write(chunk: Buffer, _encoding, callback) {
        got.push(chunk)
        setTimeout(callback, 1)
      },
    })
    await pipeline(new ScpReadStream(eagerServer(content), '/home/alma/f.bin', 4096), slow)
    expect(Buffer.concat(got).equals(content)).toBe(true)
  }, 30_000)
})
