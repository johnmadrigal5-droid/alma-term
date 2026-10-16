import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { channelAsPty, type ChannelLike } from './channel-pty'

class FakeChannel extends EventEmitter implements ChannelLike {
  readonly stderr = new EventEmitter()
  readonly written: Uint8Array[] = []
  readonly windows: number[][] = []
  closed = 0
  paused = 0
  resumed = 0
  write(data: Uint8Array): boolean {
    this.written.push(data)
    return true
  }
  setWindow(rows: number, cols: number, height: number, width: number): void {
    this.windows.push([rows, cols, height, width])
  }
  close(): void {
    this.closed++
  }
  pause(): void {
    this.paused++
  }
  resume(): void {
    this.resumed++
  }
}

describe('channelAsPty', () => {
  it('forwards stdout and stderr data', () => {
    const ch = new FakeChannel()
    const pty = channelAsPty(ch)
    const seen: string[] = []
    pty.onData((d) => seen.push(Buffer.from(d).toString()))
    ch.emit('data', Buffer.from('out'))
    ch.stderr.emit('data', Buffer.from('err'))
    expect(seen).toEqual(['out', 'err'])
  })
  it('maps resize to setWindow(rows, cols)', () => {
    const ch = new FakeChannel()
    channelAsPty(ch).resize(120, 40)
    expect(ch.windows).toEqual([[40, 120, 0, 0]])
  })
  it('reports the exit code once after close', () => {
    const ch = new FakeChannel()
    const onExit = vi.fn()
    channelAsPty(ch).onExit(onExit)
    ch.emit('exit', 3)
    ch.emit('close')
    ch.emit('close')
    expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitCode: 3 })
  })
  it('reports 0 when the channel closes without exit status', () => {
    const ch = new FakeChannel()
    const onExit = vi.fn()
    channelAsPty(ch).onExit(onExit)
    ch.emit('close')
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 })
  })
  it('kill closes the channel and pause/resume pass through', () => {
    const ch = new FakeChannel()
    const pty = channelAsPty(ch)
    pty.pause()
    pty.resume()
    pty.kill()
    expect([ch.paused, ch.resumed, ch.closed]).toEqual([1, 1, 1])
  })
  it('calls onClosed after the channel closes (to end the connection)', () => {
    const ch = new FakeChannel()
    const onClosed = vi.fn()
    channelAsPty(ch, onClosed)
    ch.emit('close')
    expect(onClosed).toHaveBeenCalledOnce()
  })
})

describe('channelAsPty lost connections', () => {
  it('reports lost instead of a clean exit after markLost', () => {
    const ch = new FakeChannel()
    const onExit = vi.fn()
    const pty = channelAsPty(ch)
    pty.onExit(onExit)
    pty.markLost()
    ch.emit('close')
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, lost: true })
  })
  it('reports a clean close as not lost', () => {
    const ch = new FakeChannel()
    const onExit = vi.fn()
    channelAsPty(ch).onExit(onExit)
    ch.emit('exit', 0)
    ch.emit('close')
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 })
  })
})
