import type { PtyExit, PtyLike } from '../pty-types'

// Subset of ssh2's ClientChannel used by the terminal session.
export interface ChannelLike {
  on(event: 'data', listener: (data: Buffer) => void): unknown
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'close', listener: () => void): unknown
  stderr: { on(event: 'data', listener: (data: Buffer) => void): unknown }
  write(data: Uint8Array): boolean
  setWindow(rows: number, cols: number, height: number, width: number): void
  close(): void
  pause(): void
  resume(): void
}

export interface ChannelPty extends PtyLike {
  /** The connection under the channel dropped: the next close is reported as lost. */
  markLost(): void
}

export function channelAsPty(channel: ChannelLike, onClosed?: () => void): ChannelPty {
  const dataListeners = new Set<(data: Uint8Array) => void>()
  const exitListeners = new Set<(event: PtyExit) => void>()
  let exitCode: number | null = null
  let closed = false
  let lost = false
  const emitData = (data: Buffer) => {
    for (const l of dataListeners) l(data)
  }
  channel.on('data', emitData)
  channel.stderr.on('data', emitData)
  channel.on('exit', (code) => {
    exitCode = code
  })
  channel.on('close', () => {
    if (closed) return
    closed = true
    const event: PtyExit = lost ? { exitCode: exitCode ?? 0, lost } : { exitCode: exitCode ?? 0 }
    for (const l of exitListeners) l(event)
    onClosed?.()
  })
  return {
    onData: (listener) => {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit: (listener) => {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write: (data) => {
      channel.write(data)
    },
    resize: (cols, rows) => channel.setWindow(rows, cols, 0, 0),
    kill: () => channel.close(),
    pause: () => channel.pause(),
    resume: () => channel.resume(),
    markLost: () => {
      lost = true
    },
  }
}
